import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';
import Modal from '../components/Modal';
import { exportarConciliacaoExcel, exportarConciliacaoPdf, formatarMoeda } from '../utils/conciliacaoExport';

// Conciliação: confronta o PDF dos Holerites emitido pela contabilidade com o que está lançado
// no sistema (Pagamentos Antecipados) no mês de apuração do topo.
//
// Matriz De-Para conferida (4 itens, tolerância R$ 0,00):
//   Vale  → código 953 (Adiantamento com ded. IR)
//   INSS  → código 91005
//   Taxa  → código 441 (Taxa assistencial)
//   Pagto → SALÁRIO LÍQUIDO do recibo
//
// Vale Extra e Vale Ex RH não existem no holerite: quando lançados, a pessoa entra numa lista
// de ALERTA (os 4 itens bateram, mas há valor adicional a justificar).

const CARTOES = [
  { chave: 'total_analisado', rotulo: 'Analisados', cor: '#2563eb' },
  { chave: 'total_ok', rotulo: '100% conferidos', cor: '#16a34a' },
  { chave: 'total_divergentes', rotulo: 'Com divergência', cor: '#dc2626' },
  { chave: 'total_com_alerta', rotulo: 'Vale Extra / Ex RH', cor: '#d97706' },
  { chave: 'total_nao_encontrados', rotulo: 'Não encontrados', cor: '#64748b' }
];

function rotuloMes(mes) {
  if (!mes) return '-';
  const [ano, m] = mes.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(m) - 1]}/${ano}`;
}

function nomeComFuncao(item) {
  const funcao = (item.funcao || '').trim();
  return funcao ? `${item.nome} (${funcao})` : item.nome;
}

// Colunas preenchidas pela importação automática. São as ÚNICAS que o holerite conhece —
// Vale Extra, Vale Ex RH e Adiantamento são lançamentos internos e nunca vêm do PDF.
// A coluna do banco chama-se `fgts` mas é exibida como INSS em todo o sistema (ver
// ROTULOS_PAGAMENTO em utils/medicaoExport.js).
const COLUNAS_IMPORT = [
  { coluna: 'vale', rotulo: 'Vale (953)' },
  { coluna: 'fgts', rotulo: 'INSS (91005)' },
  { coluna: 'taxa', rotulo: 'Taxa (441)' },
  { coluna: 'pagto', rotulo: 'Pagto (Líquido)' }
];

// modoFixo="importar" é usado em Financeiro > Gastos > Dados: mostra só a importação do PDF,
// sem o título. `mesExterno` permite à tela chamadora definir a competência da importação
// (independente do mês de apuração do topo). Sem as props, a tela é a Conciliação (conferência).
export default function Conciliacao({ modoFixo = null, onImportado = null, mesExterno = null }) {
  // Usa a Data de Apuração global (seletor no topo), como as demais telas do ciclo mensal.
  const { mes: mesGlobal } = useApuracao();
  const mes = mesExterno || mesGlobal;
  const [previa, setPrevia] = useState(null);
  const [arquivoHolerite, setArquivoHolerite] = useState(null);
  const [arquivoMedicao, setArquivoMedicao] = useState(null);
  const [usarPdfMedicao, setUsarPdfMedicao] = useState(false);
  const [relatorio, setRelatorio] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('divergencias');
  const [detalhe, setDetalhe] = useState(null);
  const inputHolerite = useRef(null);
  const inputMedicao = useRef(null);

  // --- Modo de trabalho da tela -----------------------------------------------------------
  // 'conferir' = compara o PDF com o que já está lançado (tela Conciliação);
  // 'importar' = lê o PDF e preenche o Holerite (Gastos → Dados, via modoFixo).
  const [modo] = useState(modoFixo || 'conferir');
  const [arquivoImport, setArquivoImport] = useState(null);
  const [propostaImport, setPropostaImport] = useState(null);
  const [selecionados, setSelecionados] = useState({});
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState(null);
  const inputImport = useRef(null);

  // Ao trocar o mês de apuração o relatório anterior deixa de fazer sentido: é descartado para
  // não deixar na tela números de uma competência diferente da que está selecionada no topo.
  useEffect(() => {
    setRelatorio(null);
    setErro('');
    // A proposta de importação também é de um mês específico: descartada junto, para ninguém
    // gravar em Novembro valores lidos enquanto Outubro estava selecionado.
    setPropostaImport(null);
    setResultadoImport(null);
    setSelecionados({});
    api.get('/conciliacao/previa', { params: { mes } })
      .then(res => setPrevia(res.data))
      .catch(() => setPrevia(null));
  }, [mes]);

  // Passo 1 da importação: envia o PDF e recebe a proposta do que será gravado (nada é
  // persistido ainda). As linhas já vêm com a sugestão de marcação vinda do servidor.
  async function gerarPropostaImportacao() {
    if (!arquivoImport) {
      setErro('Selecione o PDF dos Holerites para importar.');
      return;
    }
    setImportando(true);
    setErro('');
    setResultadoImport(null);

    const dados = new FormData();
    dados.append('holerite', arquivoImport);
    dados.append('mes_ciclo', mes);

    try {
      const res = await api.post('/conciliacao/importar/previa', dados, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPropostaImport(res.data);
      const marcados = {};
      res.data.itens.forEach(item => { marcados[item.colaborador_id] = item.sugerido; });
      setSelecionados(marcados);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível ler o PDF para importação.');
    } finally {
      setImportando(false);
    }
  }

  // Passo 2: grava apenas as linhas marcadas. Depois recarrega a prévia do mês para os
  // contadores do topo refletirem os lançamentos recém-criados.
  async function confirmarImportacao() {
    const itens = propostaImport.itens
      .filter(item => selecionados[item.colaborador_id] && !item.bloqueado)
      .map(item => ({ colaborador_id: item.colaborador_id, valores: item.valores }));

    if (itens.length === 0) {
      setErro('Marque pelo menos um colaborador para importar.');
      return;
    }

    setImportando(true);
    setErro('');
    try {
      const res = await api.post('/conciliacao/importar/confirmar', { mes_ciclo: mes, itens });
      setResultadoImport(res.data);
      setPropostaImport(null);
      setSelecionados({});
      if (inputImport.current) inputImport.current.value = '';
      setArquivoImport(null);
      const atualizada = await api.get('/conciliacao/previa', { params: { mes } });
      setPrevia(atualizada.data);
      if (onImportado) onImportado();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível gravar a importação.');
    } finally {
      setImportando(false);
    }
  }

  function alternarTodos(marcar) {
    const novos = {};
    propostaImport.itens.forEach(item => {
      novos[item.colaborador_id] = marcar && !item.bloqueado;
    });
    setSelecionados(novos);
  }

  const totalSelecionado = propostaImport
    ? propostaImport.itens.filter(i => selecionados[i.colaborador_id] && !i.bloqueado).length
    : 0;

  async function processar() {
    if (!arquivoHolerite) {
      setErro('Selecione o PDF dos Holerites emitido pela contabilidade.');
      return;
    }
    if (usarPdfMedicao && !arquivoMedicao) {
      setErro('Você escolheu conferir um PDF de Medição avulso, mas não selecionou o arquivo.');
      return;
    }

    setProcessando(true);
    setErro('');
    const dados = new FormData();
    dados.append('holerite', arquivoHolerite);
    dados.append('mes_ciclo', mes);
    if (usarPdfMedicao && arquivoMedicao) dados.append('medicao', arquivoMedicao);

    try {
      const res = await api.post('/conciliacao/processar', dados, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setRelatorio(res.data);
      setAba(res.data.divergentes.length > 0 ? 'divergencias' : 'ok');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível processar a conciliação.');
    } finally {
      setProcessando(false);
    }
  }

  function limpar() {
    setRelatorio(null);
    setArquivoHolerite(null);
    setArquivoMedicao(null);
    setUsarPdfMedicao(false);
    setErro('');
    if (inputHolerite.current) inputHolerite.current.value = '';
    if (inputMedicao.current) inputMedicao.current.value = '';
  }

  const resumo = relatorio ? relatorio.resumo : null;

  return (
    <div>
      {!modoFixo && (
        <>
      <h2>🧮 Conciliação de Folha</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: -6 }}>
        Confronta o PDF dos <strong>Holerites</strong> da contabilidade com os lançamentos de
        Holerite do sistema em <strong>{rotuloMes(mes)}</strong>. Conferidos:
        Vale (953), INSS (91005), Taxa (441) e Pagto (Salário Líquido).
        Para <strong>importar</strong> o PDF e preencher o Holerite, use{' '}
        <strong>Financeiro → Pagamentos → Dados</strong>.
      </p>
        </>
      )}
      {modo === 'conferir' && (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex-col gap-2">
            <label style={{ fontWeight: 600 }}>1. PDF dos Holerites (obrigatório)</label>
            <input
              type="file"
              accept="application/pdf"
              ref={inputHolerite}
              onChange={e => setArquivoHolerite(e.target.files[0] || null)}
            />
          </div>

          <button className="btn-primary" onClick={processar} disabled={processando}>
            {processando ? 'Processando...' : '🔍 Conciliar'}
          </button>

          {relatorio && (
            <button className="btn-secondary" onClick={limpar} disabled={processando}>
              ↺ Nova conciliação
            </button>
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={usarPdfMedicao}
              onChange={e => setUsarPdfMedicao(e.target.checked)}
            />{' '}
            Conferir um <strong>PDF de Medição Detalhada avulso</strong> em vez dos lançamentos do mês
          </label>

          {usarPdfMedicao && (
            <div style={{ marginTop: 8 }}>
              <input
                type="file"
                accept="application/pdf"
                ref={inputMedicao}
                onChange={e => setArquivoMedicao(e.target.files[0] || null)}
              />
              <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>
                ⚠️ Com esta opção marcada o banco <strong>não</strong> é consultado: o confronto usa
                exatamente o arquivo enviado. Use apenas para conferir um documento externo.
              </div>
            </div>
          )}

          {!usarPdfMedicao && previa && (
            <div style={{ fontSize: 12, color: previa.total_colaboradores > 0 ? '#166534' : '#b91c1c', marginTop: 6 }}>
              {previa.total_colaboradores > 0
                ? `✔ ${previa.total_colaboradores} colaborador(es) CLT com lançamento em ${rotuloMes(mes)} serão confrontados.`
                : `Nenhum lançamento de Pagamento Antecipado em ${rotuloMes(mes)}. Lance os valores ou envie um PDF de Medição avulso.`}
            </div>
          )}
        </div>

        {erro && (
          <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>
        )}
      </div>
      )}

      {modo === 'importar' && (
        <PainelImportacao
          mes={mes}
          inputRef={inputImport}
          onArquivo={setArquivoImport}
          proposta={propostaImport}
          selecionados={selecionados}
          setSelecionados={setSelecionados}
          totalSelecionado={totalSelecionado}
          processando={importando}
          erro={erro}
          resultado={resultadoImport}
          onGerar={gerarPropostaImportacao}
          onConfirmar={confirmarImportacao}
          onAlternarTodos={alternarTodos}
          onCancelar={() => { setPropostaImport(null); setSelecionados({}); setErro(''); }}
        />
      )}

      {modo === 'conferir' && !relatorio && !processando && (
        <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>
          Selecione o PDF dos Holerites e clique em <strong>Conciliar</strong> para comparar os
          valores com o que está lançado no sistema.
        </div>
      )}

      {modo === 'conferir' && relatorio && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {CARTOES.map(cartao => (
              <div
                key={cartao.chave}
                className="card"
                style={{ flex: '1 1 150px', minWidth: 150, borderTop: `3px solid ${cartao.cor}` }}
              >
                <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{cartao.rotulo}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: cartao.cor, lineHeight: 1.2 }}>
                  {resumo[cartao.chave]}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Competência <strong>{rotuloMes(relatorio.mes_ciclo || mes)}</strong> ·{' '}
                {relatorio.fonte_sistema === 'PDF_MEDICAO'
                  ? 'lado Sistema vindo do PDF de Medição enviado'
                  : 'lado Sistema vindo dos lançamentos do mês'}{' '}
                · {relatorio.diagnostico.holerite.total_colaboradores} recibo(s) lidos em{' '}
                {relatorio.diagnostico.holerite.total_paginas} página(s)
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-secondary btn-sm" onClick={() => exportarConciliacaoPdf(relatorio, relatorio.mes_ciclo || mes, true)}>
                  🖨️ Imprimir
                </button>
                <button className="btn-secondary btn-sm" onClick={() => exportarConciliacaoPdf(relatorio, relatorio.mes_ciclo || mes)}>
                  📄 Relatório PDF
                </button>
                <button className="btn-success btn-sm" onClick={() => exportarConciliacaoExcel(relatorio, relatorio.mes_ciclo || mes)}>
                  📊 Exportar Excel
                </button>
              </div>
            </div>

            {relatorio.avisos.length > 0 && (
              <ul style={{ fontSize: 12, color: '#b45309', margin: '10px 0 0', paddingLeft: 18 }}>
                {relatorio.avisos.map((aviso, i) => <li key={i}>{aviso}</li>)}
              </ul>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { chave: 'divergencias', rotulo: `❌ Divergências (${relatorio.divergentes.length})` },
              { chave: 'alertas', rotulo: `⚠️ Vale Extra / Ex RH (${relatorio.ok_com_alerta.length})` },
              { chave: 'ok', rotulo: `✅ Conferidos (${relatorio.ok.length})` },
              { chave: 'nao_encontrados', rotulo: `🔎 Não encontrados (${relatorio.nao_encontrados.length})` }
            ].map(item => (
              <button
                key={item.chave}
                className={aba === item.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                onClick={() => setAba(item.chave)}
              >
                {item.rotulo}
              </button>
            ))}
          </div>

          {aba === 'divergencias' && (
            <ListaDivergencias itens={relatorio.divergentes} onDetalhar={setDetalhe} />
          )}
          {aba === 'alertas' && <ListaAlertas itens={relatorio.ok_com_alerta} onDetalhar={setDetalhe} />}
          {aba === 'ok' && <ListaOk itens={relatorio.ok} onDetalhar={setDetalhe} />}
          {aba === 'nao_encontrados' && <ListaNaoEncontrados itens={relatorio.nao_encontrados} />}
        </>
      )}

      {detalhe && <ModalDetalhe item={detalhe} onFechar={() => setDetalhe(null)} />}
    </div>
  );
}

// Painel da importação automática: lê o PDF dos Holerites e preenche os Pagamentos
// Antecipados do mês, poupando a digitação dos 4 valores de cada colaborador.
//
// Fluxo deliberado em DOIS PASSOS — nada é gravado sem o usuário conferir e confirmar:
//   1. "Ler holerite"        → mostra a proposta, linha a linha, com o valor atual ao lado;
//   2. "Importar marcados"   → grava só o que ficou marcado.
function PainelImportacao({
  mes, inputRef, onArquivo, proposta, selecionados, setSelecionados,
  totalSelecionado, processando, erro, resultado, onGerar, onConfirmar, onAlternarTodos, onCancelar
}) {
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
          Lê o PDF dos Holerites e preenche automaticamente <strong>Vale</strong>,{' '}
          <strong>INSS</strong>, <strong>Taxa</strong> e <strong>Pagto</strong> do Holerite de{' '}
          <strong>{rotuloMes(mes)}</strong>. Você confere tudo antes de gravar, e a edição manual
          continua disponível na tabela do Holerite.
        </div>

        {!proposta && (
          <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="flex-col gap-2">
              <label style={{ fontWeight: 600 }}>PDF dos Holerites</label>
              <input
                type="file"
                accept="application/pdf"
                ref={inputRef}
                onChange={e => onArquivo(e.target.files[0] || null)}
              />
            </div>
            <button className="btn-primary" onClick={onGerar} disabled={processando}>
              {processando ? 'Lendo...' : '📄 Ler holerite'}
            </button>
          </div>
        )}

        {erro && (
          <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>
        )}
      </div>

      {resultado && <ResultadoImportacao resultado={resultado} mes={mes} />}

      {proposta && (
        <PropostaImportacao
          proposta={proposta}
          selecionados={selecionados}
          setSelecionados={setSelecionados}
          totalSelecionado={totalSelecionado}
          processando={processando}
          onConfirmar={onConfirmar}
          onAlternarTodos={onAlternarTodos}
          onCancelar={onCancelar}
        />
      )}
    </>
  );
}

// Tabela de revisão da importação: cada linha mostra o valor que será gravado e, quando já
// havia lançamento, o valor atual entre parênteses — para o usuário ver exatamente o que muda.
function PropostaImportacao({
  proposta, selecionados, setSelecionados, totalSelecionado, processando,
  onConfirmar, onAlternarTodos, onCancelar
}) {
  const { itens, sem_cadastro: semCadastro, diagnostico } = proposta;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {diagnostico.total_recibos} recibo(s) lidos em {diagnostico.total_paginas} página(s) ·{' '}
            {diagnostico.total_cruzados} cruzado(s) com o cadastro
            {diagnostico.total_sem_cadastro > 0 && ` · ${diagnostico.total_sem_cadastro} sem cadastro`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary btn-sm" onClick={() => onAlternarTodos(true)} disabled={processando}>
              Marcar todos
            </button>
            <button className="btn-secondary btn-sm" onClick={() => onAlternarTodos(false)} disabled={processando}>
              Desmarcar todos
            </button>
            <button className="btn-secondary btn-sm" onClick={onCancelar} disabled={processando}>
              ✕ Cancelar
            </button>
            <button className="btn-success" onClick={onConfirmar} disabled={processando || totalSelecionado === 0}>
              {processando ? 'Gravando...' : `✔ Importar ${totalSelecionado} marcado(s)`}
            </button>
          </div>
        </div>
      </div>

      {itens.length === 0
        ? <Vazio texto="Nenhum colaborador do PDF foi reconhecido no cadastro do sistema." />
        : (
          <TabelaProposta
            itens={itens}
            selecionados={selecionados}
            setSelecionados={setSelecionados}
            processando={processando}
          />
        )}

      {semCadastro.length > 0 && <ListaSemCadastro itens={semCadastro} />}
    </>
  );
}

// Situação de cada linha da proposta, em texto curto e com cor — é o que orienta o usuário
// sobre o que vai acontecer se ele deixar a linha marcada.
function SituacaoItem({ item }) {
  if (item.bloqueado) return <span style={{ color: '#b91c1c' }}>🔒 {item.motivo_bloqueio}</span>;
  if (item.match_aproximado) return <span style={{ color: '#b45309' }}>⚠️ Confira o nome</span>;
  if (!item.houve_mudanca) return <span style={{ color: '#6b7280' }}>Já está igual</span>;
  if (item.ja_tinha_lancamento) return <span style={{ color: '#b45309' }}>Vai substituir</span>;
  return <span style={{ color: '#166534' }}>Novo lançamento</span>;
}

function TabelaProposta({ itens, selecionados, setSelecionados, processando }) {
  return (
    <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th>Colaborador</th>
            {COLUNAS_IMPORT.map(c => <th key={c.coluna}>{c.rotulo}</th>)}
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(item => (
            <tr key={item.colaborador_id} style={{ opacity: item.bloqueado ? 0.55 : 1 }}>
              <td>
                <input
                  type="checkbox"
                  checked={!!selecionados[item.colaborador_id] && !item.bloqueado}
                  disabled={item.bloqueado || processando}
                  onChange={e => setSelecionados(anterior => ({
                    ...anterior,
                    [item.colaborador_id]: e.target.checked
                  }))}
                />
              </td>
              <td>
                {nomeComFuncao(item)}
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Holerite pág. {item.pagina_holerite}
                  {item.match_aproximado && ` · por semelhança (${item.score_match}%) com "${item.nome_holerite}"`}
                </div>
              </td>
              {COLUNAS_IMPORT.map(c => {
                const novo = item.valores[c.coluna];
                const velho = item.anteriores[c.coluna];
                const mudou = novo !== velho;
                return (
                  <td key={c.coluna} style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: mudou ? 700 : 400, color: mudou ? '#15803d' : '#111827' }}>
                      {formatarMoeda(novo)}
                    </span>
                    {/* Só mostra o valor anterior quando ele realmente vai ser substituído. */}
                    {mudou && item.ja_tinha_lancamento && (
                      <div style={{ fontSize: 11, color: '#b45309' }}>era {formatarMoeda(velho)}</div>
                    )}
                  </td>
                );
              })}
              <td style={{ fontSize: 11 }}><SituacaoItem item={item} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
        ℹ️ <strong>Vale Extra</strong>, <strong>Vale Ex RH</strong> e <strong>Adiantamento</strong>{' '}
        não existem no holerite e <strong>não são alterados</strong> pela importação — continuam
        como foram lançados manualmente.
      </div>
    </div>
  );
}

// Recibos lidos no PDF que não têm colaborador correspondente no cadastro. Não são importados:
// a importação só preenche pessoas que já existem no sistema, nunca cria cadastro sozinha.
function ListaSemCadastro({ itens }) {
  return (
    <div className="card" style={{ borderLeft: '4px solid #d97706' }}>
      <strong style={{ fontSize: 14 }}>
        ⚠️ {itens.length} recibo(s) sem colaborador correspondente no cadastro
      </strong>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
        Estes não serão importados. Cadastre a pessoa (ou corrija a grafia do nome em Cadastro) e
        leia o PDF novamente.
      </div>
      <table>
        <thead>
          <tr>
            <th>Nome no holerite</th>
            <th>CPF</th>
            <th>Pág.</th>
            <th>Pagto (Líquido)</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={indice}>
              <td>{item.nome}</td>
              <td>{item.cpf || '-'}</td>
              <td>{item.pagina}</td>
              <td>{formatarMoeda(item.pagto)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Confirmação pós-gravação: diz quantos entraram e lista o que foi ignorado (e por quê).
function ResultadoImportacao({ resultado, mes }) {
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #16a34a' }}>
      <strong style={{ fontSize: 14, color: '#166534' }}>
        ✅ {resultado.total_aplicados} lançamento(s) importado(s) em {rotuloMes(mes)}
      </strong>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
        Os valores já estão em <strong>Pagamentos Antecipados</strong> e podem ser ajustados
        manualmente a qualquer momento.
      </div>

      {resultado.ignorados && resultado.ignorados.length > 0 && (
        <ul style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0', paddingLeft: 18 }}>
          {resultado.ignorados.map((item, indice) => (
            <li key={indice}>{item.nome || `Colaborador ${item.colaborador_id}`}: {item.motivo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Aviso padrão para as listas vazias (evita a tela "sumir" quando não há ocorrências).
function Vazio({ texto }) {
  return <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>{texto}</div>;
}

// Cartão de divergência: destaca em VERMELHO apenas os campos que não bateram. Os itens
// conferidos ficam de fora da tabela de propósito — quem está conferindo quer ver o problema,
// não a lista inteira (o detalhe completo fica disponível no modal "Ver os 4 itens").
function ListaDivergencias({ itens, onDetalhar }) {
  if (itens.length === 0) {
    return <Vazio texto="✅ Nenhuma divergência encontrada nos 4 itens confrontados." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {itens.map((item, indice) => (
        <div key={indice} className="card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div className="flex gap-4" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{nomeComFuncao(item)}</strong>
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              Holerite pág. {item.pagina_holerite}
              {item.match_aproximado ? ` · cruzado por semelhança (${item.score_match}%) com "${item.nome_holerite}"` : ''}
            </span>
            <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onDetalhar(item)}>
              Ver os 4 itens
            </button>
          </div>

          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Campo divergente</th>
                <th>Sistema</th>
                <th>Holerite</th>
                <th>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {item.itens_divergentes.map(divergencia => (
                <tr key={divergencia.chave}>
                  <td style={{ color: '#b91c1c', fontWeight: 700 }}>{divergencia.rotulo}</td>
                  <td style={{ color: '#b91c1c', fontWeight: 700 }}>{formatarMoeda(divergencia.valor_sistema)}</td>
                  <td style={{ color: '#b91c1c', fontWeight: 700 }}>{formatarMoeda(divergencia.valor_holerite)}</td>
                  <td style={{ color: '#b91c1c', fontWeight: 700 }}>{formatarMoeda(divergencia.diferenca)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {item.tem_lancamento_extra && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 8, fontWeight: 600 }}>
              ⚠️ Também há lançamento adicional — Vale Extra: {formatarMoeda(item.vale_extra)} ·
              Vale Ex RH: {formatarMoeda(item.vale_ex_rh)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Os 4 itens bateram, mas existe Vale Extra e/ou Vale Ex RH lançado — valores que não têm
// contrapartida no holerite e por isso precisam de justificativa.
function ListaAlertas({ itens, onDetalhar }) {
  if (itens.length === 0) {
    return <Vazio texto="Nenhum colaborador conciliado possui Vale Extra ou Vale Ex RH lançado." />;
  }

  return (
    <div className="card">
      <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8, fontWeight: 600 }}>
        ⚠️ {itens.length} colaborador(es) com os 4 itens conferidos, mas com lançamento adicional
        no sistema que não aparece no holerite.
      </div>
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Vale Extra</th>
            <th>Vale Ex RH</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={indice}>
              <td>{nomeComFuncao(item)}</td>
              <td style={{ color: item.vale_extra < 0 ? '#16a34a' : '#b45309', fontWeight: 700 }}>
                {formatarMoeda(item.vale_extra)}
              </td>
              <td style={{ color: item.vale_ex_rh < 0 ? '#16a34a' : '#b45309', fontWeight: 700 }}>
                {formatarMoeda(item.vale_ex_rh)}
              </td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => onDetalhar(item)}>Ver os 4 itens</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaOk({ itens, onDetalhar }) {
  if (itens.length === 0) return <Vazio texto="Nenhum colaborador ficou totalmente conciliado." />;

  function valorDe(item, chave) {
    const encontrado = item.itens.find(i => i.chave === chave);
    return encontrado ? encontrado.valor_sistema : 0;
  }

  return (
    <div className="card">
      <div style={{ fontSize: 12, color: '#166534', marginBottom: 8, fontWeight: 600 }}>
        ✅ {itens.length} colaborador(es) com os 4 itens batendo exatamente com o holerite.
      </div>
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Vale (953)</th>
            <th>INSS (91005)</th>
            <th>Taxa (441)</th>
            <th>Pagto (Líquido)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={indice}>
              <td>{nomeComFuncao(item)}</td>
              <td>{formatarMoeda(valorDe(item, 'vale'))}</td>
              <td>{formatarMoeda(valorDe(item, 'inss'))}</td>
              <td>{formatarMoeda(valorDe(item, 'taxa'))}</td>
              <td>{formatarMoeda(valorDe(item, 'pagto'))}</td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => onDetalhar(item)}>Detalhes</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaNaoEncontrados({ itens }) {
  if (itens.length === 0) {
    return <Vazio texto="Todos os colaboradores foram cruzados entre o sistema e o PDF de holerites." />;
  }

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Situação</th>
            <th>CPF</th>
            <th>Valor de referência</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={indice}>
              <td>{item.nome}</td>
              <td style={{ fontSize: 12, color: item.origem === 'SISTEMA' ? '#b45309' : '#64748b' }}>
                {item.origem_rotulo}
              </td>
              <td>{item.cpf || '-'}</td>
              <td>{formatarMoeda(item.valor_referencia)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Modal com os 4 itens confrontados do colaborador, divergentes ou não.
function ModalDetalhe({ item, onFechar }) {
  return (
    <Modal titulo={`🧮 ${nomeComFuncao(item)}`} onFechar={onFechar} largura="min(640px, 96vw)">
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        Holerite: <strong>{item.nome_holerite}</strong> (pág. {item.pagina_holerite})
        {item.cpf ? ` · CPF ${item.cpf}` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Sistema</th>
            <th>Holerite</th>
            <th>Diferença</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {item.itens.map(linha => {
            const estilo = { color: linha.ok ? '#111827' : '#b91c1c', fontWeight: linha.ok ? 400 : 700 };
            return (
              <tr key={linha.chave}>
                <td style={estilo}>{linha.rotulo}</td>
                <td style={estilo}>{formatarMoeda(linha.valor_sistema)}</td>
                <td style={estilo}>{formatarMoeda(linha.valor_holerite)}</td>
                <td style={estilo}>{formatarMoeda(linha.diferenca)}</td>
                <td>{linha.ok ? '✅' : '❌'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {item.tem_lancamento_extra && (
        <div style={{ marginTop: 12, fontSize: 13, color: '#b45309' }}>
          ⚠️ <strong>Lançamentos adicionais no sistema</strong> (não existem no holerite) —
          Vale Extra: {formatarMoeda(item.vale_extra)} · Vale Ex RH: {formatarMoeda(item.vale_ex_rh)}
        </div>
      )}
    </Modal>
  );
}

