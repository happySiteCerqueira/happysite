const express = require('express');
const fs = require('fs');
const path = require('path');
const { autenticar, permitir } = require('../utils/auth');

const router = express.Router();

// Manuais do sistema — exclusivo do ADM.
//
// POR QUÊ: reúne num só lugar tudo o que é preciso para entender e dar manutenção no sistema.
// A ideia é poder baixar os arquivos e colar em qualquer chat de IA, em qualquer PC, sem
// depender do histórico de nenhuma conversa anterior.
//
// permitir('ADM'): os manuais descrevem a infraestrutura (IP do servidor, caminho das
// credenciais, estrutura do banco). Não devem ficar à vista de todos os perfis.
router.use(autenticar, permitir('ADM'));

// ⚠️ ONDE OS ARQUIVOS FICAM — ponto que já quebraria em produção se fosse ignorado:
//
// A imagem Docker final só recebe "server" e "client/dist" (ver Dockerfile). Os .md da raiz do
// projeto NÃO existem dentro do container. Por isso o Dockerfile os copia para server/manuais/.
//
// Em desenvolvimento, porém, eles continuam na raiz do projeto. A busca abaixo tenta os dois
// caminhos, nessa ordem, para a tela funcionar igual nos dois ambientes.
const PASTA_PRODUCAO = path.join(__dirname, '..', 'manuais');
const PASTA_DESENVOLVIMENTO = path.join(__dirname, '..', '..');

// Lista fixa: só estes arquivos podem ser lidos. É também a proteção contra path traversal —
// o cliente envia uma CHAVE (ex: "conexao"), nunca um caminho de arquivo.
const MANUAIS = [
  {
    chave: 'conexao',
    arquivo: 'MANUAL_DE_CONEXAO.md',
    titulo: 'Manual de Conexão',
    descricao: 'Como assumir a manutenção do sistema do zero: instalação, acesso ao servidor, '
      + 'regras, armadilhas conhecidas e o fluxo completo de alteração até o deploy.',
    icone: '🔌'
  },
  {
    chave: 'sistema',
    arquivo: 'MANUAL_DO_SISTEMA.md',
    titulo: 'Manual do Sistema',
    descricao: 'Como cada módulo funciona por dentro: telas, regras de negócio, cálculos e '
      + 'estrutura do banco de dados.',
    icone: '📘'
  },
  {
    chave: 'versoes',
    arquivo: 'VERSOES.md',
    titulo: 'Histórico de Versões',
    descricao: 'O que mudou em cada versão e como voltar a uma anterior.',
    icone: '🏷️'
  }
];

// Devolve o caminho real do arquivo, ou null se não existir em nenhum dos dois locais.
function caminhoDoManual(nomeArquivo) {
  const emProducao = path.join(PASTA_PRODUCAO, nomeArquivo);
  if (fs.existsSync(emProducao)) return emProducao;
  const emDesenvolvimento = path.join(PASTA_DESENVOLVIMENTO, nomeArquivo);
  if (fs.existsSync(emDesenvolvimento)) return emDesenvolvimento;
  return null;
}

// Lista os manuais disponíveis, já com o tamanho e a data da última alteração — assim a tela
// mostra de imediato se algum ficou para trás.
router.get('/', (req, res) => {
  const lista = MANUAIS.map(m => {
    const caminho = caminhoDoManual(m.arquivo);
    if (!caminho) return { ...m, disponivel: false };
    const info = fs.statSync(caminho);
    return {
      ...m,
      disponivel: true,
      tamanho_kb: Math.round((info.size / 1024) * 10) / 10,
      atualizado_em: info.mtime
    };
  });
  res.json(lista);
});

// Conteúdo de um manual, para exibir na tela sem precisar baixar.
router.get('/:chave', (req, res) => {
  const manual = MANUAIS.find(m => m.chave === req.params.chave);
  if (!manual) return res.status(404).json({ erro: 'Manual não encontrado' });

  const caminho = caminhoDoManual(manual.arquivo);
  if (!caminho) return res.status(404).json({ erro: `Arquivo ${manual.arquivo} não encontrado no servidor.` });

  res.json({ ...manual, conteudo: fs.readFileSync(caminho, 'utf8') });
});

// Download do arquivo .md.
router.get('/:chave/download', (req, res) => {
  const manual = MANUAIS.find(m => m.chave === req.params.chave);
  if (!manual) return res.status(404).json({ erro: 'Manual não encontrado' });

  const caminho = caminhoDoManual(manual.arquivo);
  if (!caminho) return res.status(404).json({ erro: `Arquivo ${manual.arquivo} não encontrado no servidor.` });

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${manual.arquivo}"`);
  res.send(fs.readFileSync(caminho, 'utf8'));
});

module.exports = router;
