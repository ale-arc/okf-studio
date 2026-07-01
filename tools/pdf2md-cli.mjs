// tools/pdf2md-cli.mjs — harness de diagnóstico (DEV-only, não empacotado).
// Replica o caminho de TEXTO do app em DUAS passagens:
//   pdf.js (Node) -> normItems -> stripRunningHeadersFooters -> reconstructMarkdown.
// Uso: node tools/pdf2md-cli.mjs "<entrada.pdf>" "<saida.md>"
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { reconstructMarkdown, stripRunningHeadersFooters } = require('../src/convert/reconstruct.js');
// normItems compartilhado com o app (mesma normalização, sem drift)
const { normItems } = require('../src/convert/index.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('uso: node tools/pdf2md-cli.mjs <in.pdf> <out.md>'); process.exit(2); }

const data = new Uint8Array(readFileSync(inPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

// passagem 1: classificar páginas
const pageInfo = [];
let textPages = 0, scannedPages = 0;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const text = tc.items.map(i => i.str).join('').trim();
  if (text.length >= 10) { textPages++; pageInfo.push({ type: 'text', items: normItems(tc, viewport), height: viewport.height }); }
  else { scannedPages++; pageInfo.push({ type: 'ocr' }); }
}
// remover cabeçalho/rodapé entre as páginas de texto
const txt = pageInfo.filter(pi => pi.type === 'text');
const stripped = stripRunningHeadersFooters(txt.map(pi => ({ items: pi.items, height: pi.height })));
let ti = 0;
for (const pi of pageInfo) if (pi.type === 'text') { pi.items = stripped[ti].items; ti++; }
// passagem 2: gerar markdown
const parts = pageInfo.map(pi => pi.type === 'text' ? reconstructMarkdown(pi.items) : '<!-- [página escaneada: OCR não roda no harness] -->');
const md = parts.filter(Boolean).join('\n\n');
writeFileSync(outPath, md, 'utf8');
console.error(`OK ${doc.numPages} págs (texto=${textPages}, escaneadas=${scannedPages}) -> ${outPath} (${md.length} chars)`);
