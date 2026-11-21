const crypto = require('crypto');

const TAMANHO_MINIMO = 10;
const TAMANHO_MAXIMO = 72; // limite do bcrypt: o que passar disso seria ignorado

const SENHAS_COMUNS = new Set([
  'senha', 'senha123', 'senha1234', 'senha12345', 'senha123456', 'admin', 'admin123', 'admin1234',
  'admin12345', 'administrador', 'happysite', 'happysite123', 'cerqueira', 'cerqueira123',
  'cerqueira1234', 'cerqueiraengenharia', 'mudar123', 'mudar1234', 'trocar123', 'trocar1234',
  'abc123', 'abcd1234', 'abc12345', 'qwerty123', 'qwerty1234', 'qwertyuiop', 'password',
  'password1', 'password123', '123456789', '1234567890', '12345678910', '0123456789', '1q2w3e4r5t',
  'q1w2e3r4t5', 'brasil123', 'brasil1234'
]);

// Devolve uma mensagem de erro (string) se a senha não atender à política, ou null se estiver ok.
function validarSenha(senha, login) {
  if (typeof senha !== 'string') return 'Informe a senha.';
  if (senha.length < TAMANHO_MINIMO) return `A senha deve ter pelo menos ${TAMANHO_MINIMO} caracteres.`;
  if (senha.length > TAMANHO_MAXIMO) return `A senha deve ter no máximo ${TAMANHO_MAXIMO} caracteres.`;
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve ter letras e números.';
  const minuscula = senha.toLowerCase();
  if (SENHAS_COMUNS.has(minuscula)) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(senha)) return 'Essa senha é muito simples. Escolha outra.';
  if (login && login.length >= 3 && minuscula.includes(String(login).toLowerCase())) {
    return 'A senha não pode conter o seu login.';
  }
  return null;
}

// Senha provisória aleatória (sem caracteres ambíguos como 0/O e 1/l), sempre com letras e números.
function gerarSenhaProvisoria() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const numeros = '23456789';
  const todos = letras + numeros;
  let senha = '';
  for (let i = 0; i < 12; i++) senha += todos[crypto.randomInt(todos.length)];
  // Garante ao menos um número e uma letra para passar na própria política.
  senha = letras[crypto.randomInt(letras.length)] + numeros[crypto.randomInt(numeros.length)] + senha.slice(2);
  return senha;
}

module.exports = { validarSenha, gerarSenhaProvisoria, TAMANHO_MINIMO };
