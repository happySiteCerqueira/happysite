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

export default function Conciliacao() {
  // Usa a Data de Apuração global (seletor no topo), como as demais telas do ciclo mensal.
  const { mes } = useApuracao();
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

  // Ao trocar o mês de apuração o relatório anterior deixa de fazer sentido: é descartado para
  // não deixar na tela números de uma competência diferente da que está selecionada no topo.
  useEffect(() => {
    setRelatorio(null);
    setErro('');
    api.get('/conciliacao/previa', { params: { mes } })
      .then(res => setPrevia(res.data))
      .catch(() => setPrevia(null));
  }, [mes]);

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
      <h2>🧮 Conciliação de Folha</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: -6 }}>
        Confronta o PDF dos <strong>Holerites</strong> da contabilidade com os lançamentos de
        Pagamento Antecipado do sistema em <strong>{rotuloMes(mes)}</strong>. Conferidos:
        Vale (953), INSS (91005), Taxa (441) e Pagto (Salário Líquido).
      </p>

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

      {!relatorio && !processando && (
        <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>
          Selecione o PDF dos Holerites e clique em <strong>Conciliar</strong> para comparar os
          valores com o que está lançado no sistema.
        </div>
      )}

      {relatorio && (
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

