// CERQUEIRA é o centro administrativo da empresa (obras.eh_matriz): aparece nos lançamentos
// financeiros e no cadastro de colaboradores, com este rótulo, e não nas telas de engenharia.
export function rotuloObra(obra) {
  return obra && obra.eh_matriz ? '🏢 CERQUEIRA (Matriz / Adm)' : (obra ? obra.nome : '');
}

// Parâmetros para listar as obras INCLUINDO a CERQUEIRA (telas financeiras e de cadastro de pessoas).
export const COM_MATRIZ = { params: { matriz: 1 } };
