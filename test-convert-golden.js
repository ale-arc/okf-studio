// test-convert-golden.js — snapshots golden do caminho de texto PDF->MD.
// Compara a conversão das PDFs de sample-library/pdf-test com *.golden.md.
// Para regravar após mudança intencional: UPDATE_GOLDEN=1 node test-convert-golden.js
const fs = require('fs');
const path = require('path');
const { convert } = require('./src/convert/index.js');

const dir = path.join(__dirname, 'sample-library', 'pdf-test');
const update = process.env.UPDATE_GOLDEN === '1';

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  if (!files.length) { console.error('sem PDFs em', dir); process.exit(1); }
  let fail = 0;
  for (const f of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const res = await convert(bytes, 'pdf', {});
    const md = res.markdown || '';
    const gPath = path.join(dir, f.replace(/\.pdf$/, '.golden.md'));
    if (update || !fs.existsSync(gPath)) {
      fs.writeFileSync(gPath, md);
      console.log('golden gravado:', path.basename(gPath), '(' + md.length + ' chars)');
      continue;
    }
    // normaliza EOL na leitura: git/checkout pode converter LF->CRLF (core.autocrlf)
    // e isso não é uma divergência de conteúdo real.
    const want = fs.readFileSync(gPath, 'utf8').replace(/\r\n/g, '\n');
    if (md === want) { console.log('OK', f); continue; }
    fail++;
    let i = 0;
    while (i < Math.min(md.length, want.length) && md[i] === want[i]) i++;
    console.error('FAIL ' + f + ': diverge no char ' + i);
    console.error('  golden:', JSON.stringify(want.slice(Math.max(0, i - 40), i + 40)));
    console.error('  atual :', JSON.stringify(md.slice(Math.max(0, i - 40), i + 40)));
  }
  if (fail) { console.error(fail + ' golden(s) divergiram — revise o diff; UPDATE_GOLDEN=1 para regravar'); process.exit(1); }
  console.log('GOLDEN OK');
})().catch(e => { console.error(e); process.exit(1); });
