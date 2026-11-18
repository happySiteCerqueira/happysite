import { useMemo, useState } from 'react';
import api from '../../api/api';
import { cpfValido } from '../../utils/cajuOcr';
import { moeda } from './formatacao';

// Revisão do que o OCR leu no relatório do Caju, ANTES de ir ao servidor. Tudo é editável: o
// OCR pode errar um dígito, e a conferência abaixo (CPF e soma × total do cabeçalho) existe
// justamente para o erro aparecer aqui e não nos custos das obras.
export default function EditorCaju({ dados, onPrevia, onCancelar }) {
  const [linhas, setLinhas] = useState(dados.linhas);
  const [totalCab, setTotalCab] = useState(dados.cabecalho.valor_total ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const somaVa = useMemo(() => linhas.reduce((s, l) => s + (Number(l.va_fixo) || 0) + (Number(l.va_flex) || 0), 0), [linhas]);
  const somaMob = useMemo(() => linhas.reduce((s, l) => s + (Number(l.mobilidade_fixo) || 0) + (Number(l.mobilidade_flex) || 0), 0), [linhas]);
  const lido = Math.round((somaVa + somaMob) * 100) / 100;
  const confere = totalCab !== '' && Math.abs(lido - Number(totalCab)) < 0.01;

  function alterar(idx, campo, valor) {
    setLinhas(linhas.map((l, i) => (i === idx ? { ...l, [campo]: valor, revisar: false } : l)));
  }

  async function gerarPrevia() {
    setSalvando(true); setErro('');
    try {
      const { data } = await api.post('/gastos-importacao/CAJU/previa', {
        mes_referencia: dados.mes,
        arquivo_nome: dados.arquivo_nome,
        arquivo_hash: dados.arquivo_hash,
        cabecalho: { id_relatorio: dados.cabecalho.id_relatorio, valor_total: totalCab === '' ? null : Number(totalCab) },
        linhas: linhas.map(l => ({
          nome: l.nome, cpf: l.cpf,
          va_fixo: Number(l.va_fixo) || 0, va_flex: Number(l.va_flex) || 0,
          mobilidade: (Number(l.mobilidade_fixo) || 0) + (Number(l.mobilidade_flex) || 0)
        }))
      });
      onPrevia(data);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível gerar a prévia.');
    } finally {
      setSalvando(false);
    }
  }

  const campoValor = (l, idx, campo) => (
    <input type="number" step="0.01" value={l[campo]} style={{ width: 90 }} onChange={e => alterar(idx, campo, e.target.value)} />
  );

  return (
    <div className="card" style={{ marginBottom: 16, borderTop: '3px solid #7c3aed' }}>
      <h4 style={{ margin: '0 0 6px' }}>🔎 Revisão da leitura (OCR) — Caju</h4>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        Só o <strong>Auxílio Alimentação</strong> (Fixo + Flexível) é importado. A <strong>Mobilidade</strong> é lida apenas
        para conferir o total do relatório e depois descartada. Corrija qualquer valor lido errado.
      </div>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Valor total do relatório (cabeçalho)</label>
          <input type="number" step="0.01" value={totalCab} style={{ width: 150 }} onChange={e => setTotalCab(e.target.value)} />
        </div>
        <div style={{ fontSize: 13 }}>
          Lido: VA <strong>R$ {moeda(somaVa)}</strong> + Mobilidade <strong>R$ {moeda(somaMob)}</strong> = <strong>R$ {moeda(lido)}</strong>{' '}
          <span style={{ fontWeight: 700, color: confere ? '#166534' : '#b91c1c' }}>
            {confere ? '✔ confere com o cabeçalho' : '✖ diferente do cabeçalho — revise as linhas'}
          </span>
        </div>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Nome</th><th>CPF</th><th>VA Fixo</th><th>VA Flex</th><th>Mob. Fixo</th><th>Mob. Flex</th><th></th></tr>
          </thead>
          <tbody>
            {linhas.map((l, idx) => {
              const cpfOk = cpfValido(l.cpf);
              return (
                <tr key={idx} style={l.revisar || !cpfOk ? { background: '#fffbeb' } : undefined}>
                  <td><input value={l.nome} style={{ minWidth: 200 }} onChange={e => alterar(idx, 'nome', e.target.value)} /></td>
                  <td><input value={l.cpf} style={{ width: 120, borderColor: cpfOk ? undefined : '#dc2626' }} onChange={e => alterar(idx, 'cpf', e.target.value.replace(/\D/g, ''))} /></td>
                  <td>{campoValor(l, idx, 'va_fixo')}</td>
                  <td>{campoValor(l, idx, 'va_flex')}</td>
                  <td style={{ color: '#9ca3af' }}>{campoValor(l, idx, 'mobilidade_fixo')}</td>
                  <td style={{ color: '#9ca3af' }}>{campoValor(l, idx, 'mobilidade_flex')}</td>
                  <td>
                    {!cpfOk && <span title="CPF inválido" style={{ color: '#dc2626', fontSize: 11 }}>CPF?</span>}
                    {l.revisar && <span style={{ color: '#b45309', fontSize: 11 }}> revisar</span>}
                    <button className="btn-secondary btn-sm" title="Remover linha" onClick={() => setLinhas(linhas.filter((_, i) => i !== idx))}>🗑️</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {erro && <div style={{ marginTop: 8, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
      <div className="flex gap-2" style={{ marginTop: 12 }}>
        <button className="btn-primary" disabled={salvando || linhas.length === 0} onClick={gerarPrevia}>
          {salvando ? 'Gerando...' : '📋 Gerar prévia'}
        </button>
        <button className="btn-secondary" disabled={salvando} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
