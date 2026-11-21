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
  // 'diaria_obras' guarda o rateio das diárias por obra. Estava faltando aqui e, por isso, o
  // backup ignorava esse rateio em silêncio: ao restaurar, as diárias voltavam sem obra e o
  // custo sumia do relatório de saúde financeira. Fica logo após 'diarias', que é a sua origem.
  'pagamentos_antecipados', 'diarias', 'diaria_obras', 'medicoes',
  'financeiro_receitas', 'financeiro_gastos',
  // Gastos por colaborador rateados por obra (VA, VT, Extras, Ponto). 'gastos_lotes' vem antes
  // das tabelas que o referenciam. Sem isto o backup ignoraria o rateio e os De-Para em silêncio.
  'gastos_lotes', 'gastos_colaborador_itens', 'ponto_eventos', 'gastos_rateio_mensal',
  'gastos_extras', 'colaborador_aliases', 'obra_enderecos_alias',
  // Férias/13º (holerite complementar) e DCTF/DAS mensais (v2.130).
  'holerite_complementar', 'gastos_impostos',
  'epi_itens', 'epi_retiradas', 'epi_retirada_itens', 'epi_movimentos',
  'aso_historico',
  // Custo de admissão configurável (corte de vigência) e custos de ASO periódico (renovação).
  'config_custos_admissao', 'custos_aso_periodico',
  'advertencia_modelos', 'advertencias',
  'agenda_eventos', 'agenda_evento_usuarios', 'agenda_evento_perfis', 'agenda_lembretes',
  'perfil_permissoes', 'auditoria'
];

module.exports = { TABELAS_BACKUP };
