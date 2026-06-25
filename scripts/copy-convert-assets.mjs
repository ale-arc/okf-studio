// scripts/copy-convert-assets.mjs — copia assets de runtime de pdf.js/tesseract para renderer/vendor/.
import { mkdirSync, copyFileSync, existsSync, createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import https from 'node:https';
import path from 'node:path';

const require = createRequire(import.meta.url);
const VENDOR = path.resolve('renderer/vendor');
mkdirSync(VENDOR, { recursive: true });

function copy(from, toName) {
  if (!existsSync(from)) { console.error('AVISO: não encontrado: ' + from); return false; }
  copyFileSync(from, path.join(VENDOR, toName));
  console.log('copiado:', toName);
  return true;
}

// pdf.js worker
const pdfDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
copy(path.join(pdfDir, 'legacy/build/pdf.worker.min.mjs'), 'pdf.worker.min.mjs');

// tesseract worker + core SIMD
const tjsDir = path.dirname(require.resolve('tesseract.js/package.json'));
copy(path.join(tjsDir, 'dist/worker.min.js'), 'tesseract-worker.min.js');
const coreDir = path.dirname(require.resolve('tesseract.js-core/package.json'));
copy(path.join(coreDir, 'tesseract-core-simd.wasm.js'), 'tesseract-core.wasm.js');
copy(path.join(coreDir, 'tesseract-core-simd.wasm'), 'tesseract-core.wasm');

// dados de idioma (offline) — não-fatal
const TESS = path.join(VENDOR, 'tessdata');
mkdirSync(TESS, { recursive: true });
function download(url, dest) {
  return new Promise((resolve) => {
    if (existsSync(dest)) { console.log('já existe:', path.basename(dest)); return resolve(true); }
    const f = createWriteStream(dest);
    https.get(url, (r) => {
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        // segue redirect (github raw -> objects)
        https.get(r.headers.location, (r2) => { r2.pipe(f); f.on('finish', () => f.close(() => resolve(true))); })
          .on('error', (e) => { console.error('AVISO download:', e.message); resolve(false); });
        return;
      }
      if (r.statusCode !== 200) { console.error('AVISO download status', r.statusCode, url); return resolve(false); }
      r.pipe(f); f.on('finish', () => f.close(() => { console.log('baixado:', path.basename(dest)); resolve(true); }));
    }).on('error', (e) => { console.error('AVISO download:', e.message); resolve(false); });
  });
}
for (const lang of ['por', 'eng']) {
  await download('https://github.com/naptha/tessdata/raw/gh-pages/4.0.0_fast/' + lang + '.traineddata.gz',
    path.join(TESS, lang + '.traineddata.gz'));
}

console.log('copy-convert-assets: concluído');
