// Garante que todo require('./X') do processo principal está no build.files,
// para o app EMPACOTADO não quebrar com "Cannot find module". Roda antes do dist.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const files = (pkg.build && pkg.build.files) || [];

function globToRe(g) {
  let s = g.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // escapa especiais de regex (mantém * e /)
  s = s.replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  return new RegExp('^' + s + '$');
}
const matchers = files.map(globToRe);
const covered = (rel) => matchers.some((re) => re.test(rel));

const entries = ['main.js', 'preload.js'];
const missing = [];
for (const entry of entries) {
  const src = readFileSync(entry, 'utf8');
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let rel = path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1].replace(/\\/g, '/')));
    if (!/\.[a-z0-9]+$/i.test(rel)) rel += '.js';
    if (!covered(rel)) missing.push(`${entry}: require('${m[1]}') → '${rel}' não está em build.files`);
  }
}

if (missing.length) {
  console.error('ERRO: módulos do processo principal ausentes do build.files (quebraria o app empacotado):\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log('check-package-files: OK (' + entries.join('/') + ' — todos os require locais estão no build.files)');
