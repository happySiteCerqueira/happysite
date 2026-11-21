import { rotuloMes } from './util';

// Alerta discreto no topo do Centro de Custo: DCTF e/ou DAS ainda não lançados no período. Sem eles
// o custo (e portanto a margem) está parcial. O botão leva a Pagamentos → Cadastrar, no mês pendente.
export default function PendenciaImpostos({ pendencias, onIrParaCadastrar }) {
  if (!pendencias || pendencias.length === 0) return null;
  const unico = pendencias.length === 1;
  const detalhe = p => `${rotuloMes(p.mes)}: ${p.falta.join(' e ')}`;

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12,
      background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#92400e'
    }}>
      <span>
        ⚠️ <strong>{unico ? 'Pendência no mês' : 'Pendência no período'}:</strong> DCTF e/ou DAS ainda não foram lançados
        {unico ? '' : ` (${pendencias.map(detalhe).join(' · ')})`} — a margem exibida é parcial.
        {unico && <> Faltando: <strong>{pendencias[0].falta.join(' e ')}</strong>.</>}
      </span>
      {onIrParaCadastrar && (
        <button className="btn-secondary btn-sm" onClick={() => onIrParaCadastrar(pendencias[0].mes)}>
          Lançar em Pagamentos → Cadastrar
        </button>
      )}
    </div>
  );
}
