import { formatarMoeda } from './util';

// Avisos que impedem leituras erradas do relatório. São a parte mais importante da tela:
// sem eles, uma obra sem custo lançado pareceria altamente lucrativa.
export default function AvisosCentroCusto({ avisos }) {
  const semObra = avisos.receitas_sem_obra_cadastrada || [];
  const semCusto = avisos.obras_sem_custo || [];
  const diariasSoltas = avisos.diarias_sem_obra || { qtd: 0, valor: 0 };
  const temDiariasSoltas = diariasSoltas.qtd > 0;
  const folhaSolta = avisos.folha_sem_obra || { valor: 0, pessoas: 0, gastos: 0 };
  const temFolhaSolta = folhaSolta.valor > 0;
  const temGastosSoltos = (folhaSolta.gastos || 0) > 0;
  if (semObra.length === 0 && semCusto.length === 0 && !temDiariasSoltas && !temFolhaSolta && !temGastosSoltos) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #d97706', fontSize: 12 }}>
      {temGastosSoltos && (
        <div style={{ marginBottom: 8 }}>
          🧾 <strong>Gastos sem obra definida:</strong> {formatarMoeda(folhaSolta.gastos)}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            Custos que não têm obra para abater: lançamentos diretos feitos sem escolher a obra, admissão
            de quem está sem obra no cadastro e impostos sem base de rateio. Abra{' '}
            <strong>Financeiro → Pagamentos</strong> e informe a obra para o valor abater a receita dela.
          </div>
        </div>
      )}
      {temFolhaSolta && (
        <div style={{ marginBottom: 8 }}>
          💰 <strong>Pagamento sem obra definida:</strong> {formatarMoeda(folhaSolta.valor)} de{' '}
          {folhaSolta.pessoas} pessoa(s).
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            São custos de colaboradores (holerite acima da produção, VA, VT, Extras) que não têm{' '}
            <strong>ponto eletrônico</strong> no mês e estão <strong>sem “Obra atual”</strong> no
            cadastro. O valor aparece como <strong>“Sem obra definida”</strong>.
            Importe o ponto em <strong>Financeiro → Pagamentos → Cadastrar</strong>, ajuste o rateio no
            Detalhado, ou informe a obra de cada pessoa em <strong>Prestadores</strong>.
          </div>
        </div>
      )}
      {temDiariasSoltas && (
        <div style={{ marginBottom: (semObra.length > 0 || semCusto.length > 0) ? 8 : 0 }}>
          ⚠️ <strong>Diárias sem obra definida:</strong> {formatarMoeda(diariasSoltas.valor)} em{' '}
          {diariasSoltas.qtd} lançamento(s).
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            Esse valor foi pago mas não está rateado em nenhuma obra, então <strong>não entra</strong>{' '}
            no custo de nenhuma linha. Para incluí-lo, abra <strong>Diárias</strong> e informe a obra do lançamento.
          </div>
        </div>
      )}
      {semObra.length > 0 && (
        <div style={{ marginBottom: semCusto.length > 0 ? 8 : 0 }}>
          ⚠️ <strong>Receita com obra não cadastrada:</strong> {semObra.join(', ')}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            O nome lançado na Receita não bate com nenhuma obra do cadastro, então o custo dessa
            obra não pôde ser cruzado. Confira a grafia do nome no lançamento.
          </div>
        </div>
      )}
      {semCusto.length > 0 && (
        <div>
          ⚠️ <strong>Obra com entrada mas sem custo lançado:</strong> {semCusto.join(', ')}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            O saldo aparece como lucro total porque ainda não há custo registrado no período — não
            significa que a obra não teve custo.
          </div>
        </div>
      )}
    </div>
  );
}
