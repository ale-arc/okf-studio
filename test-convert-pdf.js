const fs = require('fs');
const path = require('path');
const { convert } = require('./src/convert/index.js');

async function testPdfDir() {
  const dir = path.join(__dirname, 'sample-library', 'pdf-test');
  if (!fs.existsSync(dir)) return console.log('Dir não existe:', dir);
  
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  let pass = 0;
  for (const f of files) {
    console.log(`\nTesting ${f}...`);
    const buf = fs.readFileSync(path.join(dir, f));
    const bytes = new Uint8Array(buf);
    try {
      const res = await convert(bytes, 'pdf', {
        onStatus: s => console.log('  Status:', s),
        onProgress: p => process.stdout.write(`\r  Progress: ${Math.round(p * 100)}%`)
      });
      console.log();
      
      const md = res.markdown || '';
      console.log(`  Markdown length: ${md.length} chars`);
      console.log(`  Images extracted: ${res.images ? res.images.length : 0}`);
      if (res.meta) console.log(`  Meta:`, res.meta);
      
      if (md.length === 0) {
        console.error(`  FAIL: Empty markdown for ${f}`);
      } else {
        pass++;
        console.log(`  SUCCESS for ${f}`);
        fs.writeFileSync(path.join(dir, f.replace('.pdf', '.md')), md);
      }
    } catch (e) {
      console.error(`  ERROR converting ${f}:`, e);
    }
  }
  console.log(`\nPassed ${pass}/${files.length}`);
}

testPdfDir();
