const db = require('../db/database');

// Recálculo automático dos valores já lançados.
//
// Por que isso existe: o valor de uma marcação é gravado no momento em que a célula é marcada
// (quantidade x valor unitário daquele instante). Se depois alguém altera o valor unitário do
// serviço, o preço específico de um colaborador ou a quantidade da célula, as marcações antigas
// continuariam com o valor velho — e a Medição mostraria um número desatualizado.
//
// Antes isso era corrigido só quando alguém lembrava de clicar em "Atualizar tudo". Agora é
// disparado automaticamente pelas próprias ações que causam a defasagem.
//
// REGRAS IMPORTANTES:
//  - Meses com medição já PAGA nunca são alterados (preserva o histórico do que foi liquidado).
//  - Célula com mais de uma pessoa = execução compartilhada: quantidade e valor são RATEADOS
//    entre os executores (vale para grupo cadastrado e para equipe avulsa).

// Verifica quais colaboradores/meses já foram pagos, para não recalcular esses lançamentos.
async function carregarMesesPagos(exec) {
  const pagos = await exec.all("SELECT DISTINCT colaborador_id, mes_ciclo FROM medicoes WHERE status = 'PAGO'");
  return (colaboradorId, mes) => pagos.some(m => m.colaborador_id === colaboradorId && m.mes_ciclo === mes);
}

// Recalcula todas as marcações de UM serviço. Recebe "exec" (db ou uma transação já aberta),
// para poder ser chamada tanto isoladamente quanto dentro de outra operação.
async function recalcularServico(exec, servicoId) {
  const servico = await exec.get('SELECT * FROM obra_servicos WHERE id = ?', servicoId);
  if (!servico) return 0;

  const celulas = await exec.all('SELECT * FROM obra_servico_celulas WHERE obra_servico_id = ?', servicoId);
  if (celulas.length === 0) return 0;

  const ehMesPago = await carregarMesesPagos(exec);

  const quantidadesCadastradas = await exec.all('SELECT * FROM obra_servico_quantidades WHERE obra_servico_id = ?', servicoId);
  const qtdPorCelula = {};
  quantidadesCadastradas.forEach(q => { qtdPorCelula[q.celula_key] = q.quantidade; });

  const precosEspecificos = await exec.all('SELECT * FROM colaborador_precos WHERE obra_servico_id = ?', servicoId);
  const precoPorColaborador = {};
  precosEspecificos.forEach(p => { precoPorColaborador[p.colaborador_id] = p.valor_unitario; });

  // Agrupa por (célula, mês): marcações compartilhadas gravam uma linha por pessoa, mas o valor
  // e a quantidade pertencem à célula como um todo.
  const grupos = {};
  celulas.forEach(c => {
    const chave = `${c.celula_key}|${c.mes_ciclo}`;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(c);
  });

  let atualizadas = 0;

  for (const chave of Object.keys(grupos)) {
    const linhas = grupos[chave];
    const [celulaKey, mesCiclo] = chave.split('|');

    // Preserva meses já pagos (basta um dos envolvidos ter recebido).
    if (linhas.some(l => ehMesPago(l.colaborador_id, mesCiclo))) continue;

    // Quantidade atual da célula; se nunca foi cadastrada, mantém a que está na marcação.
    // Em execução compartilhada a quantidade gravada é a parte de cada um — por isso a base
    // de comparação é a SOMA das partes, não a de uma linha só.
    const qtdGravadaTotal = linhas.reduce((acc, l) => acc + (Number(l.quantidade) || 0), 0);
    const qtdAtual = qtdPorCelula[celulaKey] !== undefined ? qtdPorCelula[celulaKey] : qtdGravadaTotal;

    const execucaoCompartilhada = !!linhas[0].grupo_id || linhas.length > 1;

    if (execucaoCompartilhada) {
      const valorTotal = qtdAtual * (servico.valor_unitario || 0);
      const valorPorMembro = valorTotal / linhas.length;
      const qtdPorMembro = qtdAtual / linhas.length;
      for (const linha of linhas) {
        await exec.run('UPDATE obra_servico_celulas SET quantidade = ?, valor = ? WHERE id = ?',
          qtdPorMembro, valorPorMembro, linha.id);
        atualizadas++;
      }
    } else {
      for (const linha of linhas) {
        const valorUnitario = precoPorColaborador[linha.colaborador_id] !== undefined
          ? precoPorColaborador[linha.colaborador_id]
          : (servico.valor_unitario || 0);
        await exec.run('UPDATE obra_servico_celulas SET quantidade = ?, valor = ? WHERE id = ?',
          qtdAtual, qtdAtual * valorUnitario, linha.id);
        atualizadas++;
      }
    }
  }

  return atualizadas;
}

// Recalcula os totais das diárias usando o valor de diária ATUAL do cadastro da pessoa.
async function recalcularDiariasDoColaborador(exec, colaboradorId) {
  const ehMesPago = await carregarMesesPagos(exec);
  const pessoa = await exec.get('SELECT valor_diaria FROM colaboradores WHERE id = ?', colaboradorId);
  if (!pessoa) return 0;

  const diarias = await exec.all('SELECT * FROM diarias WHERE colaborador_id = ? AND quantidade > 0', colaboradorId);
  let atualizadas = 0;
  for (const d of diarias) {
    if (ehMesPago(d.colaborador_id, d.mes_ciclo)) continue;
    const valorUnitario = pessoa.valor_diaria || 0;
    await exec.run('UPDATE diarias SET valor_unitario_usado = ?, total = ?, atualizado_em = NOW() WHERE id = ?',
      valorUnitario, d.quantidade * valorUnitario, d.id);
    atualizadas++;
  }
  return atualizadas;
}

// Versões "dispare e esqueça": usadas nas rotas para não atrasar a resposta ao usuário.
// Qualquer falha é apenas registrada no log — nunca derruba a operação principal.
function recalcularServicoEmSegundoPlano(servicoId) {
  recalcularServico(db, servicoId)
    .then(n => { if (n > 0) console.log(`[recálculo automático] Serviço ${servicoId}: ${n} marcação(ões) atualizada(s).`); })
    .catch(e => console.error('[recálculo automático] Falha ao recalcular serviço:', e.message));
}

function recalcularDiariasEmSegundoPlano(colaboradorId) {
  recalcularDiariasDoColaborador(db, colaboradorId)
    .then(n => { if (n > 0) console.log(`[recálculo automático] Diárias do colaborador ${colaboradorId}: ${n} atualizada(s).`); })
    .catch(e => console.error('[recálculo automático] Falha ao recalcular diárias:', e.message));
}

module.exports = {
  recalcularServico,
  recalcularDiariasDoColaborador,
  recalcularServicoEmSegundoPlano,
  recalcularDiariasEmSegundoPlano
};
