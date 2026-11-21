import { useEffect, useState } from 'react';
import api from '../../api/api';
import { moeda, rotuloMes } from './formatacao';
import { interpretarTextoCaju, lerImagensCaju } from '../../utils/cajuOcr';
import PainelPrevia, { BlocoPendencias } from './PainelPrevia';
import EditorCaju from './EditorCaju';
import Conciliacao from '../Conciliacao';
import ImpostosCard from './ImpostosCard';
import CustosAdmissaoCard from './CustosAdmissaoCard';
import { useAuth } from '../../context/AuthContext';

// Aba Dados: porta de entrada dos PDFs. Cada card tem a PRÓPRIA competência de referência,
// independente do filtro global — um relatório pago no fim de um mês costuma se referir ao mês
// seguinte — e exige a confirmação explícita dela antes de ler o arquivo. Reimportar o mesmo
// tipo/mês pede confirmação para substituir o lote anterior (nunca soma).
const CARTOES = [
  {
    tipo: 'CAJU', titulo: '🍽️ Caju (VA)',
    descricao: 'Extrai apenas o Auxílio Alimentação (Fixo + Flexível). A Mobilidade é ignorada. Chave: CPF. A leitura (OCR) roda no seu navegador.'
  },
  {
    tipo: 'VT', titulo: '🚌 Vale Transporte (VT)',
    descricao: 'Considera só as linhas com Status PAGO e soma as modalidades (Bilhete + PIX…) de cada colaborador.'
  },
  {
    tipo: 'PONTO', titulo: '🕒 Ponto Eletrônico (iFractal)',
    descricao: 'Batidas “Liberado” viram dias por obra (endereço → obra) e definem o % de rateio de cada colaborador.'
  },
  {
    tipo: 'CAFE', titulo: '☕ Café (Por Obra)', pendente: true,
    descricao: 'Custo direto por obra, pago à empresa terceirizada.'
  }
];

// Tipos de holerite do card de importação (Férias e 13º são gravados à parte do salário).
const TIPOS_HOLERITE = [
  { chave: 'SALARIO', rotulo: 'Salário (Padrão)' },
  { chave: 'FERIAS', rotulo: 'Férias' },
  { chave: 'DECIMO_TERCEIRO', rotulo: '13º Salário' }
];

export default function GastosDados({ mesGlobal, renderLancamentos }) {
  // O Holerite usa o módulo "Conciliação" no backend (rota /conciliacao/importar): só mostra o
  // card a quem tem essa permissão.
  const { temAcessoSubaba } = useAuth();
  const podeImportarHolerite = temAcessoSubaba('conciliacao');
  const [holeriteAberto, setHoleriteAberto] = useState(false);
  const [tipoHolerite, setTipoHolerite] = useState('SALARIO');
  const [mesHolerite, setMesHolerite] = useState(mesGlobal);
  useEffect(() => { setMesHolerite(mesGlobal); }, [mesGlobal]);
  const [previa, setPrevia] = useState(null);
  const [editorCaju, setEditorCaju] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [versao, setVersao] = useState(0);
  const [pendenciasPonto, setPendenciasPonto] = useState(null);

  function aposConfirmar(resultado) {
    const dias = previa?.lote.tipo === 'PONTO';
    setMensagem(`✔ Importação confirmada: ${resultado.total_registros} registro(s), ${dias ? `${moeda(resultado.total_valor)} dias` : `R$ ${moeda(resultado.total_valor)}`}.`);
    setPrevia(null);
    setVersao(v => v + 1);
  }

  return (
    <div>
      {mensagem && (
        <div className="card" style={{ marginBottom: 12, color: '#166534', fontWeight: 600, fontSize: 13 }}>{mensagem}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {CARTOES.map(c => (
          <CartaoImportacao key={c.tipo} cartao={c} mesInicial={mesGlobal} versao={versao}
            onPrevia={p => { setMensagem(''); setEditorCaju(null); setPendenciasPonto(null); setPrevia(p); }}
            onCajuLido={d => { setMensagem(''); setPrevia(null); setPendenciasPonto(null); setEditorCaju(d); }}
            onPendenciasPonto={p => { setMensagem(''); setPrevia(null); setEditorCaju(null); setPendenciasPonto(p); }} />
        ))}
        {podeImportarHolerite && (
          <div className="card">
            <h4 style={{ margin: '0 0 6px' }}>📄 Holerite (contabilidade)</h4>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
              PDF de holerites da contabilidade. Preenche Vale (953), INSS (91005), Taxa (441) e Pagto
              (líquido) de cada colaborador, depois de você conferir a prévia. Escolha o tipo antes de enviar:
              Férias e 13º são gravados à parte e <strong>não sobrescrevem</strong> o salário do mês.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {TIPOS_HOLERITE.map(t => (
                <button key={t.chave} className={tipoHolerite === t.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  style={{ borderRadius: 999 }} onClick={() => setTipoHolerite(t.chave)}>
                  {t.rotulo}
                </button>
              ))}
            </div>
            <div className="flex-col gap-2">
              <label style={{ fontSize: 12 }}>Mês/Ano de referência desta importação</label>
              <input type="month" value={mesHolerite}
                onChange={e => { if (e.target.value) { setMesHolerite(e.target.value); setHoleriteAberto(false); } }} />
              <button className="btn-primary btn-sm" onClick={() => setHoleriteAberto(v => !v)}>
                {holeriteAberto ? '▲ Fechar importação' : `📄 Importar PDF de holerites (${TIPOS_HOLERITE.find(t => t.chave === tipoHolerite).rotulo})`}
              </button>
            </div>
          </div>
        )}
        <ImpostosCard mesGlobal={mesGlobal} />
        <CustosAdmissaoCard />
      </div>

      {holeriteAberto && podeImportarHolerite && (
        <div style={{ marginBottom: 16 }}>
          <Conciliacao modoFixo="importar" mesExterno={mesHolerite} tipoHolerite={tipoHolerite}
            onImportado={() => setMensagem(`✔ Holerite de ${TIPOS_HOLERITE.find(t => t.chave === tipoHolerite).rotulo} (${rotuloMes(mesHolerite)}) importado.`)} />
        </div>
      )}

      {editorCaju && (
        <EditorCaju dados={editorCaju} onCancelar={() => setEditorCaju(null)}
          onPrevia={p => { setEditorCaju(null); setPrevia(p); }} />
      )}
      {previa && (
        <PainelPrevia previa={previa} onAtualizar={setPrevia} onFechar={() => setPrevia(null)} onConfirmado={aposConfirmar} />
      )}
      {pendenciasPonto && (
        <PendenciasPonto dados={pendenciasPonto} onFechar={() => setPendenciasPonto(null)}
          onAtualizado={d => { setPendenciasPonto({ ...d, mes: pendenciasPonto.mes }); setVersao(v => v + 1); }} />
      )}

      {!previa && !editorCaju && !pendenciasPonto && (
        <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>
          <strong>Vínculos pendentes (De-Para)</strong>
          <div style={{ marginTop: 6 }}>
            Depois de ler um PDF, aparecem aqui os colaboradores não encontrados no cadastro e as ruas do ponto
            que ainda não pertencem a nenhuma obra. Os vínculos ficam salvos para os próximos meses.
          </div>
        </div>
      )}

      {renderLancamentos && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            ☕ Lançamentos diretos por obra (Café e outros)
          </summary>
          {renderLancamentos(mesGlobal)}
        </details>
      )}
    </div>
  );
}

// Pendências do Ponto JÁ importado: permite vincular nomes/ruas novos e refazer o rateio a
// partir das batidas gravadas, sem reenviar o PDF.
function PendenciasPonto({ dados, onFechar, onAtualizado }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function aplicar(vinculos) {
    setSalvando(true); setErro(''); setAviso('');
    try {
      const { data } = await api.post('/gastos-importacao/PONTO/recalcular', { mes_referencia: dados.mes, ...vinculos });
      setAviso(`Rateio refeito para ${data.colaboradores_com_rateio} colaborador(es).`);
      onAtualizado(data);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível refazer o rateio.');
    } finally {
      setSalvando(false);
    }
  }

  const semPendencias = dados.colaboradores_pendentes.length === 0 && dados.ruas_pendentes.length === 0;
  return (
    <div className="card" style={{ marginBottom: 16, borderTop: '3px solid #2563eb' }}>
      <div className="flex gap-4" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>🔗 Pendências do Ponto — {rotuloMes(dados.mes)}</h4>
        <button className="btn-secondary btn-sm" onClick={onFechar}>Fechar</button>
      </div>
      {semPendencias && <div style={{ fontSize: 13, color: '#166534', margin: '10px 0' }}>✔ Nenhuma pendência: todos os nomes e ruas estão vinculados.</div>}
      <div style={{ marginTop: 10 }}>
        <BlocoPendencias pendentes={dados.colaboradores_pendentes} ruasPendentes={dados.ruas_pendentes}
          salvando={salvando} rotuloBotao="Vincular e refazer o rateio" onSalvar={aplicar} />
      </div>
      {aviso && <div style={{ color: '#166534', fontSize: 13, fontWeight: 600 }}>{aviso}</div>}
      {erro && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
    </div>
  );
}

function CartaoImportacao({ cartao, mesInicial, versao, onPrevia, onCajuLido, onPendenciasPonto }) {
  const [mesRef, setMesRef] = useState(mesInicial);
  const [arquivo, setArquivo] = useState(null);
  const [confirmouMes, setConfirmouMes] = useState(false);
  const [lote, setLote] = useState(null);
  const [processando, setProcessando] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => { setMesRef(mesInicial); }, [mesInicial]);

  useEffect(() => {
    if (!mesRef) return;
    api.get('/gastos-custos/importacoes', { params: { mes: mesRef } })
      .then(res => setLote(res.data.lotes.find(l => l.tipo === cartao.tipo) || null))
      .catch(() => setLote(null));
  }, [mesRef, cartao.tipo, versao]);

  const pendente = !!cartao.pendente;
  const formatoTotal = l => (cartao.tipo === 'PONTO' ? `${moeda(l.total_valor)} dias` : `R$ ${moeda(l.total_valor)}`);

  async function ler() {
    if (!arquivo) { setErro('Selecione o PDF.'); return; }
    if (!confirmouMes) { setErro(`Confirme que o arquivo é da competência ${rotuloMes(mesRef)}.`); return; }
    setErro('');
    const form = new FormData();
    form.append('mes_referencia', mesRef);
    form.append('arquivo', arquivo);
    try {
      if (cartao.tipo === 'CAJU') {
        setProcessando('Abrindo o PDF...');
        const { data } = await api.post('/gastos-importacao/CAJU/imagens', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        let texto = data.texto;
        if (data.tipo === 'imagens') {
          texto = await lerImagensCaju(data.imagens.map(i => i.dataUrl), (n, total) => setProcessando(`Lendo página ${n} de ${total} (OCR)...`));
        }
        const lido = interpretarTextoCaju(texto);
        if (lido.linhas.length === 0) throw new Error('Não consegui ler nenhuma linha do relatório do Caju neste PDF.');
        onCajuLido({ ...lido, mes: mesRef, arquivo_nome: arquivo.name, arquivo_hash: data.arquivo_hash });
      } else {
        setProcessando('Lendo o PDF...');
        const { data } = await api.post(`/gastos-importacao/${cartao.tipo}/previa`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        onPrevia(data);
      }
    } catch (e) {
      setErro(e.response?.data?.erro || e.message || 'Não foi possível ler o PDF.');
    } finally {
      setProcessando('');
    }
  }

  async function abrirPendencias() {
    setErro('');
    try {
      const { data } = await api.get('/gastos-importacao/PONTO/pendencias', { params: { mes_referencia: mesRef } });
      onPendenciasPonto({ ...data, mes: mesRef });
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível carregar as pendências.');
    }
  }

  return (
    <div className="card" style={{ opacity: pendente ? 0.75 : 1 }}>
      <h4 style={{ margin: '0 0 6px' }}>{cartao.titulo}</h4>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{cartao.descricao}</div>

      <div className="flex-col gap-2">
        <label style={{ fontSize: 12 }}>Mês/Ano de referência desta importação</label>
        <input type="month" value={mesRef} disabled={pendente}
          onChange={e => { if (e.target.value) { setMesRef(e.target.value); setConfirmouMes(false); } }} />
        <input type="file" accept="application/pdf" disabled={pendente || !!processando}
          onChange={e => { setArquivo(e.target.files[0] || null); setConfirmouMes(false); setErro(''); }} />
        {!pendente && arquivo && (
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={confirmouMes} onChange={e => setConfirmouMes(e.target.checked)} />{' '}
            Confirmo: este arquivo é de <strong>{rotuloMes(mesRef)}</strong>
          </label>
        )}
        {!pendente && (
          <button className="btn-primary btn-sm" disabled={!arquivo || !!processando} onClick={ler}>
            {processando || '📄 Ler PDF'}
          </button>
        )}
      </div>

      {pendente && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#b45309', fontWeight: 700 }}>⏳ Parser pendente de layout PDF</div>
      )}
      {erro && <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}

      <div style={{ marginTop: 8, fontSize: 12, color: lote ? '#166534' : '#6b7280' }}>
        {lote
          ? `✔ Lote ativo em ${rotuloMes(mesRef)}: ${lote.total_registros} registro(s), ${formatoTotal(lote)}`
          : `Nenhum lote ativo em ${rotuloMes(mesRef)}.`}
      </div>
      {cartao.tipo === 'PONTO' && lote && (
        <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={abrirPendencias}>🔗 Pendências / refazer rateio</button>
      )}
    </div>
  );
}
