// test-auto.js — testes do núcleo OKF.auto (puro, sem DOM)
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const A = OKF.auto;

let n = 0, fail = 0;
function eq(got, exp, msg) {
  n++;
  const G = JSON.stringify(got), E = JSON.stringify(exp);
  if (G !== E) { fail++; console.error('FAIL:', msg, '\n   got: ' + G + '\n   exp: ' + E); }
}
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }

// doc fake: relPath + content
function doc(relPath, fm, body) {
  return { relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '') };
}

// ---- Task 1: helpers básicos ----
eq(A.headingFor('projetos'), 'Projetos', 'headingFor capitaliza');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas' })), 'Projeto Atlas', 'titleOf usa frontmatter');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto' })), 'atlas', 'titleOf cai para nome do arquivo');
eq(A.descOf(doc('x.md', { type: 'X', description: 'Desc.' })), 'Desc.', 'descOf usa frontmatter');
eq(A.bulletFor(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas', description: 'Migração.' })),
   '* [Projeto Atlas](/projetos/atlas.md) - Migração.', 'bulletFor com descrição');
eq(A.bulletFor(doc('a.md', { type: 'X', title: 'A' })), '* [A](/a.md)', 'bulletFor sem descrição');

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('AUTO OK');
