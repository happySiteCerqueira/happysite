// Modelos pré-cadastrados de advertência disciplinar.
//
// Cada entrada traz o motivo (usado como resumo), o enquadramento legal e um texto-base para o
// campo "Discriminação dos fatos". Os trechos entre [colchetes] são lacunas que o usuário deve
// completar com os dados concretos do caso — a tela destaca isso e impede salvar se sobrar
// alguma lacuna por preencher, evitando que um documento com "[data]" literal vire um termo
// oficial entregue ao colaborador.
//
// IMPORTANTE: o código (chave) de cada modelo é gravado no banco junto com o texto final já
// preenchido. Guardamos os dois de propósito: o texto, porque é o que vale juridicamente no dia
// da aplicação; e o código/artigo, para permitir estatísticas por tipo de infração depois.
export const MODELOS_ADVERTENCIA = [
  {
    codigo: 'FALTA_INJUSTIFICADA',
    numero: '01',
    rotulo: 'Falta Injustificada ao Serviço',
    artigo: 'Art. 482, "e" (desídia) da CLT',
    texto: 'No dia [data], o colaborador não compareceu à jornada normal de trabalho no canteiro de obras, deixando de apresentar atestado médico hábil ou qualquer justificativa legal para a sua ausência, violando as cláusulas contratuais e gerando desfalque na execução das tarefas da equipe.'
  },
  {
    codigo: 'ATRASO',
    numero: '02',
    rotulo: 'Atrasos Injustificados / Reincidentes',
    artigo: 'Art. 482, "e" (desídia) da CLT',
    texto: 'No dia [data], o colaborador iniciou suas atividades com atraso de [X minutos/horas], comparecendo às [horário] sem apresentar qualquer motivo legítimo, desrespeitando o horário de início da jornada e as orientações previamente estipuladas pela empresa.'
  },
  {
    codigo: 'ABANDONO_POSTO',
    numero: '03',
    rotulo: 'Abandono do Posto de Trabalho Durante o Expediente',
    artigo: 'Art. 482, "e" e "h" da CLT',
    texto: 'No dia [data], o colaborador ausentou-se deliberadamente de seu posto de trabalho e da frente de serviço designada às [horário], sem autorização da liderança ou justificativa plausível, permanecendo fora de sua área produtiva e comprometendo o andamento das atividades e o cronograma da obra.'
  },
  {
    codigo: 'INSUBORDINACAO',
    numero: '04',
    rotulo: 'Descumprimento de Ordens e Instruções / Insubordinação',
    artigo: 'Art. 482, "h" (insubordinação) da CLT',
    texto: 'No dia [data], às [horário], o colaborador recusou-se expressamente a executar a determinação direta emitida por seu superior hierárquico ([nome/função do encarregado ou mestre]), referente à atividade de [descrever a tarefa], ato que configura clara insubordinação funcional.'
  },
  {
    codigo: 'EPI',
    numero: '05',
    rotulo: 'Recusa ou Uso Incorreto de EPI / Normas de Segurança',
    artigo: 'Art. 158, parágrafo único, "b", da CLT c/c NR-06 e NR-18',
    texto: 'No dia [data], às [horário], o colaborador foi flagrado em área operacional sem a devida utilização do Equipamento de Proteção Individual obrigatório ([especificar: cinto de segurança com talabarte / capacete / óculos / calçado de proteção]), desatendendo às ordens de serviço, aos treinamentos recebidos e às normas de segurança da obra.'
  },
  {
    codigo: 'OFENSA_VERBAL',
    numero: '06',
    rotulo: 'Ato Lesivo da Honra, Ofensa Verbal ou Xingamento',
    artigo: 'Art. 482, "j" e "k" da CLT',
    texto: 'No dia [data], por volta de [horário], o colaborador dirigiu palavras ofensivas, de baixo calão e desrespeitosas contra [nome do colega ou líder], provocando perturbação no ambiente de trabalho e quebrando a disciplina, o respeito mútuo e a urbanidade exigidos no canteiro.'
  },
  {
    codigo: 'EMBRIAGUEZ',
    numero: '07',
    rotulo: 'Embriaguez em Serviço ou Ingestão de Bebida Alcoólica',
    artigo: 'Art. 482, "f" (embriaguez em serviço) da CLT',
    texto: 'No dia [data], às [horário], constatou-se que o colaborador apresentou-se no canteiro de obras sob visíveis indícios e sintomas de ingestão alcoólica, expondo a integridade física própria e de terceiros a perigo evidente em ambiente de construção civil.'
  },
  {
    codigo: 'CELULAR_PESSOAL',
    numero: '08',
    rotulo: 'Uso Indevido ou Excessivo de Celular Pessoal no Canteiro',
    artigo: 'Art. 482, "e" e "h" da CLT',
    texto: 'No dia [data], por volta de [horário], o colaborador foi flagrado reiteradas vezes utilizando telefone celular particular (redes sociais, mensagens ou jogos) durante o horário de trabalho e em área de circulação operacional, desrespeitando o regulamento interno da obra e negligenciando os deveres de sua função.'
  },
  {
    codigo: 'CELULAR_CORPORATIVO',
    numero: '09',
    rotulo: 'Uso Incorreto ou Omissão no Uso de Celular Corporativo',
    artigo: 'Art. 482, "h" e "e" da CLT',
    texto: 'No dia [data], o colaborador deixou de portar e manter em funcionamento o aparelho celular funcional fornecido pela empresa para comunicação operacional no canteiro, inviabilizando contatos de emergência e o alinhamento das rotinas de trabalho pelas quais responde.'
  },
  {
    codigo: 'DANO_FERRAMENTA',
    numero: '10',
    rotulo: 'Mau Uso, Negligência ou Danificação de Ferramentas / Equipamentos',
    artigo: 'Art. 482, "e" (desídia / negligência) da CLT',
    texto: 'No dia [data], constatou-se que o colaborador operou com manifesta negligência e desatenção o equipamento/ferramenta [descrever o equipamento], ocasionando danos materiais e paralisação desnecessária da frente de trabalho, em desacordo com os procedimentos operacionais repassados.'
  }
];

// Código reservado para "nenhum dos modelos acima": libera a escrita livre do motivo e do texto.
export const MODELO_OUTRO = 'OUTRO';

export function buscarModelo(codigo) {
  return MODELOS_ADVERTENCIA.find(m => m.codigo === codigo) || null;
}

// Devolve as lacunas [assim] ainda não preenchidas no texto. A tela usa isso para avisar antes
// de salvar: um termo entregue ao colaborador com "[data]" literal seria constrangedor e, pior,
// frágil se o documento for questionado judicialmente depois.
export function lacunasPendentes(texto) {
  return String(texto || '').match(/\[[^\]]+\]/g) || [];
}
