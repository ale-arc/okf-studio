// test-templates.js — testes das partes puras de templates.js (sem Electron)
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const T = require('./templates.js');

let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }
function throws(fn, msg) { n++; let t = false; try { fn(); } catch (e) { t = true; } if (!t) { fail++; console.error('FAIL (esperava erro):', msg); } }

// DEFAULTS: 6 itens, nomes únicos
ok(Array.isArray(T.DEFAULTS) && T.DEFAULTS.length === 6, 'DEFAULTS tem 6 modelos');
ok(new Set(T.DEFAULTS.map(d => d.name)).size === 6, 'nomes de DEFAULTS são únicos');
ok(T.DEFAULTS.some(d => d.name === 'Em branco'), 'inclui "Em branco"');

// Cada default parseia; só "Em branco" sem type
for (const d of T.DEFAULTS) {
  const p = OKF.parse(d.content);
  if (d.name === 'Em branco') ok(!p.frontmatter.type, '"Em branco" sem type');
  else ok(!!p.frontmatter.type, d.name + ' tem type');
}

// sanitizeName
ok(T.sanitizeName('Projeto') === 'Projeto', 'aceita nome simples');
ok(T.sanitizeName('  Notas de reunião  ') === 'Notas de reunião', 'apara espaços');
throws(() => T.sanitizeName(''), 'rejeita vazio');
throws(() => T.sanitizeName('   '), 'rejeita só-espaços');
throws(() => T.sanitizeName('a/b'), 'rejeita barra');
throws(() => T.sanitizeName('a\\b'), 'rejeita contra-barra');
throws(() => T.sanitizeName('x:y'), 'rejeita dois-pontos');
throws(() => T.sanitizeName('x*?'), 'rejeita curinga');

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('TEMPLATES OK');
