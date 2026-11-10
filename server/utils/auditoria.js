const db = require('../db/database');

// Trilha de auditoria. O campo "detalhes" guarda um JSON em texto — por isso qualquer payload
// pode ser gravado nele, inclusive o estado completo do registro.
//
// IMPORTANTE: auditoria nunca pode derrubar a operação principal. Se a gravação do log falhar,
// o erro é apenas registrado no console e o fluxo continua normalmente.

// Campos que jamais devem ir para o log, mesmo que venham dentro do objeto.
const CAMPOS_SENSIVEIS = ['senha', 'senha_hash', 'nova_senha', 'senha_atual', 'token', 'assinatura'];

// Remove campos sensíveis e corta valores gigantes (ex: imagem de assinatura em base64),
// que incharia a tabela sem agregar nada à investigação.
function limpar(valor) {
  if (valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map(limpar);
  if (typeof valor === 'object' && !(valor instanceof Date)) {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      if (CAMPOS_SENSIVEIS.includes(chave.toLowerCase())) { saida[chave] = '[omitido]'; continue; }
      saida[chave] = limpar(v);
    }
    return saida;
  }
  if (typeof valor === 'string' && valor.length > 2000) {
    return valor.slice(0, 2000) + `... [truncado, ${valor.length} caracteres]`;
  }
  return valor;
}

// Compara o estado anterior com o novo e devolve só o que de fato mudou.
// É o que permite ler o log rapidamente: em vez de dois objetos grandes, mostra "campo X: de A
// para B". Só considera campos presentes no payload novo (um PUT parcial não deve acusar como
// alteração tudo aquilo que nem foi enviado).
function calcularMudancas(antes, depois) {
  if (!antes || !depois) return null;
  const mudancas = {};
  for (const chave of Object.keys(depois)) {
    if (CAMPOS_SENSIVEIS.includes(chave.toLowerCase())) continue;
    const valorAntes = antes[chave];
    const valorDepois = depois[chave];
    // Normaliza para texto: o banco devolve número/data onde o formulário manda string.
    const a = valorAntes instanceof Date ? valorAntes.toISOString() : valorAntes;
    const d = valorDepois instanceof Date ? valorDepois.toISOString() : valorDepois;
    if (String(a ?? '') !== String(d ?? '')) {
      mudancas[chave] = { de: limpar(valorAntes ?? null), para: limpar(valorDepois ?? null) };
    }
  }
  return Object.keys(mudancas).length ? mudancas : null;
}

// Registro simples (mantém a assinatura usada em todas as rotas já existentes).
//   registrar(usuarioId, 'EDITAR', 'obras', 12, { ...payload })
async function registrar(usuarioId, acao, entidade, entidadeId, detalhes) {
  try {
    const conteudo = typeof detalhes === 'string'
      ? detalhes
      : JSON.stringify(limpar(detalhes || {}));
    await db.run(
      'INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?,?,?,?,?)',
      usuarioId || null, acao, entidade || null, entidadeId || null, conteudo
    );
  } catch (e) {
    console.error('Erro ao registrar auditoria:', e.message);
  }
}

// Registro com SNAPSHOT: grava o estado ANTES da alteração junto com os dados novos enviados.
// É o que permite reconstruir manualmente um registro alterado ou excluído por engano.
//
// Uso típico (sempre ANTES de executar o UPDATE/DELETE):
//   const atual = await db.get('SELECT * FROM obras WHERE id = ?', id);
//   await registrarSnapshot(req, 'EDITAR', 'obras', id, atual, req.body);
//
// Estrutura gravada em "detalhes":
//   { antes: {...}, depois: {...}, mudancas: { campo: { de, para } }, contexto: {...} }
async function registrarSnapshot(req, acao, entidade, entidadeId, antes, depois, contexto) {
  const payload = {
    antes: antes ? limpar(antes) : null,
    depois: depois !== undefined ? limpar(depois) : null,
    mudancas: calcularMudancas(antes, depois)
  };
  if (contexto) payload.contexto = limpar(contexto);

  // Guarda também quem fez e de onde — útil quando duas pessoas usam o mesmo perfil.
  if (req) {
    payload.contexto = {
      ...(payload.contexto || {}),
      usuario_nome: req.usuario?.nome,
      perfil: req.usuario?.perfil,
      ip: req.headers?.['x-forwarded-for'] || req.ip || null,
      metodo: req.method,
      rota: req.originalUrl
    };
  }

  await registrar(req?.usuario?.id, acao, entidade, entidadeId, payload);
}

module.exports = { registrar, registrarSnapshot, calcularMudancas };
