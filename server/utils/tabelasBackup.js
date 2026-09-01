// Lista única e compartilhada de tabelas incluídas em qualquer backup (manual ou automático).
// IMPORTANTE: sempre que uma tabela nova for criada em server/db/database.js, ela também precisa
// ser adicionada aqui — caso contrário o backup passa a ignorar esses dados silenciosamente (foi
// o que aconteceu antes com as tabelas de EPI, que tinham ficado de fora desta lista).
// A ordem importa: respeita a ordem de dependências (chaves estrangeiras) para inserção; a
// exclusão (usada ao restaurar um backup) é feita na ordem reversa desta lista.
const TABELAS_BACKUP = [
  'usuarios', 'colaboradores', 'obras', 'servicos_padrao', 'obra_servicos',
  'obra_servico_pessoas', 'obra_servico_grupos', 'obra_servico_grupo_membros', 'colaborador_precos',
  'obra_servico_celulas', 'obra_servico_quantidades', 'obra_apto_rotulos',
  'pagamentos_antecipados', 'diarias', 'medicoes', 'financeiro_receitas',
  'epi_itens', 'epi_retiradas', 'epi_retirada_itens', 'epi_movimentos',
  'perfil_permissoes', 'auditoria'
];

module.exports = { TABELAS_BACKUP };
