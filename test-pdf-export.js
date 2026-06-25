// test-pdf-export.js — roda com `electron test-pdf-export.js`. Gera um PDF e valida o cabeçalho.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderPdf } = require('./convert-pdf.js');

app.whenReady().then(async () => {
  let code = 0;
  try {
    const md = '# Teste\n\nParágrafo.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    const buf = await renderPdf({ markdown: md, frontmatter: { title: 'Teste', type: 'reference' } });
    const head = buf.slice(0, 5).toString('latin1');
    if (head !== '%PDF-') { console.error('FAIL: buffer não começa com %PDF- (got: ' + head + ')'); code = 1; }
    if (buf.length < 1000) { console.error('FAIL: PDF muito pequeno (' + buf.length + ' bytes)'); code = 1; }
    const out = path.join(os.tmpdir(), 'okf-test-' + process.pid + '.pdf');
    fs.writeFileSync(out, buf);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) { console.error('FAIL: arquivo PDF não gravado'); code = 1; }
    fs.rmSync(out, { force: true });
    if (!code) console.log('PDF EXPORT OK (' + buf.length + ' bytes)');
  } catch (e) {
    console.error('FAIL:', e); code = 1;
  }
  app.exit(code);
});
