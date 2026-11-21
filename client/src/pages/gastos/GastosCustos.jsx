import { useState } from 'react';
import { useApuracao } from '../../context/ApuracaoContext';
import { rotuloMes } from './formatacao';
import GastosResumo from './GastosResumo';
import GastosDetalhado from './GastosDetalhado';
import GastosDados from './GastosDados';

// Financeiro > Gastos. Três sub-abas sobre o mesmo mês de apuração (seletor global do topo):
//   Cadastrar → importação dos PDFs (Caju, VT, Ponto, Holerite, Café) e vínculos De-Para (chave 'dados');
//   Resumo    → custo consolidado por obra;
//   Detalhado → custo por colaborador, com rateio entre obras e lançamento de extras.
//
// O Café é custo DIRETO da obra (empresa terceirizada); VA, VT, Holerite e Extras são custo do
// colaborador e chegam às obras pelo rateio do ponto eletrônico.
const SUBABAS = [
  { chave: 'dados', rotulo: '📥 Cadastrar' },
  { chave: 'resumo', rotulo: '📊 Resumo' },
  { chave: 'detalhado', rotulo: '👷 Detalhado' }
];

export default function GastosCustos({ renderLancamentos }) {
  const { mes, setMes } = useApuracao();
  const [aba, setAba] = useState('resumo');

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12 }}>Competência</label>
            <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SUBABAS.map(s => (
              <button key={s.chave} className={aba === s.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                onClick={() => setAba(s.chave)}>
                {s.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          Custos de <strong>{rotuloMes(mes)}</strong> que abatem a receita das obras no Centro de Custo.
        </div>
      </div>

      {aba === 'resumo' && <GastosResumo mes={mes} />}
      {aba === 'detalhado' && <GastosDetalhado mes={mes} />}
      {aba === 'dados' && <GastosDados mesGlobal={mes} renderLancamentos={renderLancamentos} />}
    </div>
  );
}
