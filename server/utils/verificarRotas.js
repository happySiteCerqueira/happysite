const fs = require('fs');
const path = require('path');

// Confere se todo arquivo .js dentro de server/routes/ está de fato registrado no server.js
// através de um app.use(...). Isso existe porque já aconteceu de uma rota inteira (EPI) ser
// removida acidentalmente do server.js durante uma edição, sem ninguém perceber — o arquivo da
// rota continuava existindo e funcionando perfeitamente sozinho, mas o Express nunca a expunha,
// então o site parecia "ter perdido os dados" quando na verdade só faltava essa uma linha.
//
// Se alguma rota estiver "órfã" (arquivo existe, mas nenhum app.use aponta para ele), o servidor
// AVISA no log e, propositalmente, RECUSA A SUBIR (process.exit) — é preferível o deploy falhar
// de forma clara do que publicar silenciosamente uma versão do site com um módulo inteiro fora
// do ar. Isso faz o Render manter automaticamente a versão anterior (que funcionava) no ar.
function verificarRotasRegistradas(server_js_path, routes_dir) {
  const conteudoServer = fs.readFileSync(server_js_path, 'utf-8');

  const arquivosRota = fs.readdirSync(routes_dir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''));

  const faltando = arquivosRota.filter(nome => {
    // Aceita tanto require('./routes/nome') quanto require("./routes/nome") ou variações de espaço
    const padrao = new RegExp(`require\\(['"]\\./routes/${nome}['"]\\)`);
    return !padrao.test(conteudoServer);
  });

  return faltando;
}

module.exports = { verificarRotasRegistradas };
