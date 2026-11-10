// Modelos padrão de advertência disciplinar, usados UMA ÚNICA VEZ como seed da tabela
// advertencia_modelos (ver server/db/database.js).
//
// A partir do seed, a lista passa a viver no banco: o usuário pode cadastrar motivos novos
// (pela opção "Outro" na tela) e esses passam a aparecer para todos. Por isso este arquivo
// NÃO é a fonte de verdade em tempo de execução — alterá-lo depois do primeiro start não muda
// nada no sistema já instalado.
//
// Os marcadores {colaborador}, {data} e {hora} são substituídos automaticamente pelos dados do
// formulário no momento em que o motivo é escolhido (interpolação em tempo real na tela).
const MODELOS_ADVERTENCIA_PADRAO = [
  {
    motivo: 'Falta Injustificada ao Serviço',
    artigo_clt: 'Art. 482, "e" (desídia) da CLT',
    texto_base: 'No dia {data}, o(a) colaborador(a) {colaborador} não compareceu à jornada normal de trabalho no canteiro de obras, deixando de apresentar atestado médico hábil ou qualquer justificativa legal para a sua ausência, violando as cláusulas contratuais e gerando desfalque na execução das tarefas da equipe.'
  },
  {
    motivo: 'Atrasos Injustificados / Reincidentes',
    artigo_clt: 'Art. 482, "e" (desídia) da CLT',
    texto_base: 'No dia {data}, o(a) colaborador(a) {colaborador} iniciou suas atividades com atraso, comparecendo às {hora} sem apresentar qualquer motivo legítimo, desrespeitando o horário de início da jornada e as orientações previamente estipuladas pela empresa.'
  },
  {
    motivo: 'Abandono do Posto de Trabalho Durante o Expediente',
    artigo_clt: 'Art. 482, "e" e "h" da CLT',
    texto_base: 'No dia {data}, o(a) colaborador(a) {colaborador} ausentou-se deliberadamente de seu posto de trabalho e da frente de serviço designada às {hora}, sem autorização da liderança ou justificativa plausível, permanecendo fora de sua área produtiva e comprometendo o andamento das atividades e o cronograma da obra.'
  },
  {
    motivo: 'Descumprimento de Ordens e Instruções / Insubordinação',
    artigo_clt: 'Art. 482, "h" (insubordinação) da CLT',
    texto_base: 'No dia {data}, às {hora}, o(a) colaborador(a) {colaborador} recusou-se expressamente a executar a determinação direta emitida por seu superior hierárquico, referente à atividade que lhe foi designada, ato que configura clara insubordinação funcional.'
  },
  {
    motivo: 'Recusa ou Uso Incorreto de EPI / Normas de Segurança',
    artigo_clt: 'Art. 158, parágrafo único, "b", da CLT c/c NR-06 e NR-18',
    texto_base: 'No dia {data}, às {hora}, o(a) colaborador(a) {colaborador} foi flagrado(a) em área operacional sem a devida utilização do Equipamento de Proteção Individual obrigatório, desatendendo às ordens de serviço, aos treinamentos recebidos e às normas de segurança da obra.'
  },
  {
    motivo: 'Ato Lesivo da Honra, Ofensa Verbal ou Xingamento',
    artigo_clt: 'Art. 482, "j" e "k" da CLT',
    texto_base: 'No dia {data}, por volta de {hora}, o(a) colaborador(a) {colaborador} dirigiu palavras ofensivas, de baixo calão e desrespeitosas a colega de trabalho, provocando perturbação no ambiente de trabalho e quebrando a disciplina, o respeito mútuo e a urbanidade exigidos no canteiro.'
  },
  {
    motivo: 'Embriaguez em Serviço ou Ingestão de Bebida Alcoólica',
    artigo_clt: 'Art. 482, "f" (embriaguez em serviço) da CLT',
    texto_base: 'No dia {data}, às {hora}, constatou-se que o(a) colaborador(a) {colaborador} apresentou-se no canteiro de obras sob visíveis indícios e sintomas de ingestão alcoólica, expondo a integridade física própria e de terceiros a perigo evidente em ambiente de construção civil.'
  },
  {
    motivo: 'Uso Indevido ou Excessivo de Celular Pessoal no Canteiro',
    artigo_clt: 'Art. 482, "e" e "h" da CLT',
    texto_base: 'No dia {data}, por volta de {hora}, o(a) colaborador(a) {colaborador} foi flagrado(a) reiteradas vezes utilizando telefone celular particular (redes sociais, mensagens ou jogos) durante o horário de trabalho e em área de circulação operacional, desrespeitando o regulamento interno da obra e negligenciando os deveres de sua função.'
  },
  {
    motivo: 'Uso Incorreto ou Omissão no Uso de Celular Corporativo',
    artigo_clt: 'Art. 482, "h" e "e" da CLT',
    texto_base: 'No dia {data}, o(a) colaborador(a) {colaborador} deixou de portar e manter em funcionamento o aparelho celular funcional fornecido pela empresa para comunicação operacional no canteiro, inviabilizando contatos de emergência e o alinhamento das rotinas de trabalho pelas quais responde.'
  },
  {
    motivo: 'Mau Uso, Negligência ou Danificação de Ferramentas / Equipamentos',
    artigo_clt: 'Art. 482, "e" (desídia / negligência) da CLT',
    texto_base: 'No dia {data}, constatou-se que o(a) colaborador(a) {colaborador} operou com manifesta negligência e desatenção equipamento/ferramenta da empresa, ocasionando danos materiais e paralisação desnecessária da frente de trabalho, em desacordo com os procedimentos operacionais repassados.'
  }
];

module.exports = { MODELOS_ADVERTENCIA_PADRAO };
