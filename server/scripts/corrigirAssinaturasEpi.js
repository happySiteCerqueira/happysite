u // Script de correção retroativa (execução única): verifica todas as assinaturas já salvas
// em epi_retiradas e, para aquelas que estão praticamente em branco (poucos pixels desenhados),
// remove o valor do campo "assinatura" (marca como NULL), corrigindo o selo "Assinado digitalmente"
// exibido no histórico do EPI. Usa a mesma lógica de limiar mínimo do componente AssinaturaCanvas.jsx.
//
// Uso: node scripts/corrigirAssinaturasEpi.js
//      node scripts/corrigirAssinaturasEpi.js --dry-run   (apenas lista o que seria corrigido, sem alterar nada)

const { PNG } = require('pngjs');
const db = require('../db/database');

const LIMITE_MINIMO_PIXELS = 40;

function possuiTracoSuficiente(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const { data, width, height } = png;
  let pixelsDesenhados = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
    if (a > 0 && (r < 250 || g < 250 || b < 250)) {
      pixelsDesenhados++;
      if (pixelsDesenhados >= LIMITE_MINIMO_PIXELS) return true;
    }
  }
  return false;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await db.pronto;

  const retiradas = await db.all(
    `SELECT id, assinatura FROM epi_retiradas WHERE assinatura IS NOT NULL`
  );

  console.log(`Encontradas ${retiradas.length} retiradas com assinatura preenchida. Analisando...`);

  let corrigidas = 0;
  let erros = 0;

  for (const r of retiradas) {
    try {
      const base64 = String(r.assinatura).split(',')[1] || '';
      if (!base64) {
        console.log(`Retirada #${r.id}: formato inesperado, pulando.`);
        continue;
      }
      const buffer = Buffer.from(base64, 'base64');
      const assinado = possuiTracoSuficiente(buffer);

      if (!assinado) {
        corrigidas++;
        console.log(`Retirada #${r.id}: assinatura praticamente em branco -> ${dryRun ? '(dry-run, não alterado)' : 'corrigindo para NULL'}`);
        if (!dryRun) {
          await db.run('UPDATE epi_retiradas SET assinatura = NULL WHERE id = ?', r.id);
        }
      }
    } catch (e) {
      erros++;
      console.error(`Retirada #${r.id}: erro ao processar imagem ->`, e.message);
    }
  }

  console.log('---');
  console.log(`Total analisadas: ${retiradas.length}`);
  console.log(`Corrigidas (assinatura em branco): ${corrigidas}`);
  console.log(`Erros ao processar: ${erros}`);
  console.log(dryRun ? 'Modo dry-run: nada foi alterado no banco.' : 'Correção aplicada com sucesso no banco.');

  process.exit(0);
}

main().catch(e => {
  console.error('Erro fatal ao executar correção:', e);
  process.exit(1);
});
