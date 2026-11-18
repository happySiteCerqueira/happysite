// Apoio às importações de PDF do módulo Gastos (Caju, VT, Ponto): vínculo De-Para com o cadastro.
const db = require('../db/database');
const { normalizarNome, normalizarCpf } = require('./parserHolerite');
const { normalizarRua } = require('./parserPonto');
const { similaridade } = require('./conciliadorFolha');

// Abaixo disto a semelhança de nome nem é sugerida; nunca é aplicada automaticamente (nomes
// curtos como "GIVALDO" ou dois "AILTON" diferentes tornariam o vínculo automático perigoso).
const LIMIAR_SUGESTAO = 70;

async function carregarCadastro() {
  const linhas = await db.all('SELECT id, nome, documento, ativo, obra_id FROM colaboradores ORDER BY ativo DESC, nome');
  return linhas.map(c => ({
    id: c.id, nome: c.nome, nome_normalizado: normalizarNome(c.nome),
    cpf: normalizarCpf(c.documento), ativo: c.ativo, obra_id: c.obra_id
  }));
}

async function carregarAliases(origem) {
  const linhas = await db.all('SELECT nome_normalizado, colaborador_id FROM colaborador_aliases WHERE origem = ?', origem);
  return new Map(linhas.map(l => [l.nome_normalizado, l.colaborador_id]));
}

// Cruza itens extraídos do PDF (cada um com nome e, opcionalmente, cpf) com o cadastro.
// Ordem: CPF → De-Para salvo → nome normalizado exato. O que sobra vira "pendente", com
// sugestões por semelhança para o usuário escolher.
async function resolverColaboradores(origem, itens) {
  const [cadastro, aliases] = await Promise.all([carregarCadastro(), carregarAliases(origem)]);
  const porId = new Map(cadastro.map(c => [c.id, c]));
  const porCpf = new Map();
  const porNome = new Map();
  for (const c of cadastro) {
    if (c.cpf && !porCpf.has(c.cpf)) porCpf.set(c.cpf, c);
    // A lista vem com ativos primeiro: em homônimos o ativo prevalece.
    if (!porNome.has(c.nome_normalizado)) porNome.set(c.nome_normalizado, c);
  }

  const vinculados = [];
  const pendentes = [];
  for (const item of itens) {
    const chaveNome = item.nome_normalizado || normalizarNome(item.nome);
    const cpf = normalizarCpf(item.cpf);
    let achado = null;
    let via = null;
    if (cpf && porCpf.has(cpf)) { achado = porCpf.get(cpf); via = 'CPF'; }
    else if (aliases.has(chaveNome) && porId.has(aliases.get(chaveNome))) { achado = porId.get(aliases.get(chaveNome)); via = 'DE_PARA'; }
    else if (porNome.has(chaveNome)) { achado = porNome.get(chaveNome); via = 'NOME'; }

    if (achado) {
      vinculados.push({ item, colaborador_id: achado.id, colaborador_nome: achado.nome, via });
    } else {
      const sugestoes = cadastro
        .map(c => ({ id: c.id, nome: c.nome, ativo: c.ativo, score: Math.round(similaridade(chaveNome, c.nome_normalizado)) }))
        .filter(s => s.score >= LIMIAR_SUGESTAO)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      pendentes.push({ item, chave: chaveNome, sugestoes });
    }
  }
  return { vinculados, pendentes };
}

// Resolve cada logradouro do ponto para uma obra. Ordem:
//   1. De-Para salvo (obra_enderecos_alias) para a rua + cidade;
//   2. De-Para salvo sem cidade (vale para qualquer cidade);
//   3. endereço cadastrado da obra, comparando SÓ o nome da rua (número e complemento ignorados).
// Se mais de uma obra casar, a rua fica pendente (ambígua) em vez de chutar. Uma obra com cidade
// cadastrada diferente da cidade do ponto não casa — "Rua Q" existe em mais de uma cidade.
async function resolverRuas(pares) {
  const [aliases, obras] = await Promise.all([
    db.all('SELECT obra_id, rua_normalizada, cidade_normalizada FROM obra_enderecos_alias'),
    db.all('SELECT id, nome, endereco, cidade FROM obras')
  ]);
  const nomeObra = new Map(obras.map(o => [o.id, o.nome]));
  const porAlias = new Map(aliases.map(a => [`${a.rua_normalizada}|${a.cidade_normalizada}`, a.obra_id]));
  const obrasPorRua = new Map();
  for (const o of obras) {
    const chave = normalizarRua(o.endereco);
    if (!chave) continue;
    if (!obrasPorRua.has(chave)) obrasPorRua.set(chave, []);
    obrasPorRua.get(chave).push({ id: o.id, cidade: normalizarNome(o.cidade).toLowerCase() });
  }

  const resultado = new Map();
  for (const { rua_normalizada: rua, cidade_normalizada: cidade } of pares) {
    const chave = `${rua}|${cidade}`;
    let obraId = porAlias.get(chave) || porAlias.get(`${rua}|`);
    let via = obraId ? 'DE_PARA' : null;
    if (!obraId) {
      const candidatas = (obrasPorRua.get(rua) || []).filter(o => !o.cidade || !cidade || o.cidade === cidade);
      if (candidatas.length === 1) { obraId = candidatas[0].id; via = 'CADASTRO'; }
    }
    resultado.set(chave, obraId ? { obra_id: obraId, obra_nome: nomeObra.get(obraId), via } : null);
  }
  return resultado;
}

module.exports = { carregarCadastro, resolverColaboradores, resolverRuas };
