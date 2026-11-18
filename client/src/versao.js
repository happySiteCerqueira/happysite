// ===========================================================================================
// NÚMERO DE VERSÃO DO SISTEMA — fonte única de verdade
// ===========================================================================================
//
// POR QUÊ: o sistema está em produção e em ampliação ao mesmo tempo. Ter o número à vista em
// cada tela permite saber exatamente qual versão está no ar e, se algo quebrar, identificar
// para qual ponto voltar.
//
// COMO ATUALIZAR: ao concluir qualquer alteração — por menor que seja — incremente o último
// número (2.111 → 2.112 → 2.113...) e registre a mudança em VERSOES.md, na raiz do projeto.
//
// ⚠️ Este arquivo é o ÚNICO lugar onde a versão deve ser escrita. O rodapé do menu lateral lê
// daqui; qualquer outro ponto que precise do número deve importar esta constante, nunca
// repetir o valor — duas cópias acabariam divergindo.
export const VERSAO_SISTEMA = '2.118';
