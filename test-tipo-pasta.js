const fs = require('fs'), assert = require('assert');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const A = OKF.auto;

// --- Task 1: slugify / folderForType / pathForConcept ---
assert.strictEqual(A.slugify('Referência'), 'referencia');
assert.strictEqual(A.slugify('  Projeto  Atlas '), 'projeto-atlas');
assert.strictEqual(A.slugify('IN_SPU 98/060325'), 'in-spu-98-060325');
assert.strictEqual(A.slugify('***'), '');
assert.strictEqual(A.folderForType('Referência'), 'referencia');
assert.strictEqual(A.folderForType('   '), 'sem-tipo');

const taken = new Set(['referencia/in-spu-98.md']);
assert.strictEqual(A.pathForConcept('Referência', 'IN SPU 98', new Set()), 'referencia/in-spu-98.md');
assert.strictEqual(A.pathForConcept('Referência', 'IN SPU 98', taken), 'referencia/in-spu-98-2.md');
assert.strictEqual(A.pathForConcept('Tabela', '', new Set()), 'tabela/conceito.md');

console.log('Task 1 OK');

// --- Task 2: typeLabelLookup / canonicalType ---
const docsT2 = [
  { relPath: 'referencia/a.md', content: '---\ntype: Referência\n---\n# A' },
  { relPath: 'tabela/b.md', content: '---\ntype: Tabela\n---\n# B' },
];
const lk = A.typeLabelLookup(docsT2);
assert.strictEqual(lk.get('referencia'), 'Referência');
assert.strictEqual(A.canonicalType('referência', docsT2), 'Referência'); // reaproveita rótulo
assert.strictEqual(A.canonicalType('Processo', docsT2), 'Processo');     // novo, mantém
console.log('Task 2 OK');

// --- Task 3: rootListing agrupa por tipo, rótulo acentuado ---
const docsT3 = [
  { relPath: 'referencia/a.md', name: 'a.md', content: '---\ntype: Referência\ntitle: Conceito A\n---\n# A' },
  { relPath: 'referencia/b.md', name: 'b.md', content: '---\ntype: Referência\ntitle: Conceito B\n---\n# B' },
  { relPath: 'tabela/c.md', name: 'c.md', content: '---\ntype: Tabela\ntitle: Tabela C\n---\n# C' },
  { relPath: 'd.md', name: 'd.md', content: '---\ntitle: Sem Tipo D\n---\n# D' },
];
const listing = A.rootListing(docsT3);
assert.ok(listing.includes('## Referência'), 'tem seção Referência com acento');
assert.ok(listing.includes('## Tabela'), 'tem seção Tabela');
assert.ok(listing.includes('## Sem tipo'), 'conceito sem type cai em Sem tipo');
assert.ok(listing.indexOf('Conceito A') < listing.indexOf('## Tabela'), 'A está sob Referência');
console.log('Task 3 OK');

// --- Task 4: regressão item 3 — link em index.md fora do bloco gerenciado ---
const docsT4 = [
  { relPath: 'index.md', name: 'index.md',
    content: '---\nokf_version: "0.1"\n---\n\n# Lib\n\n* [Velho](/referencia/velho.md) - desc\n' },
  { relPath: 'referencia/velho.md', name: 'velho.md',
    content: '---\ntype: Referência\ntitle: Velho\n---\n# Velho' },
];
const changes = A.rewriteRenameLinks(docsT4, 'referencia/velho.md', 'tabela/velho.md');
const idx = changes.find(c => c.relPath === 'index.md');
assert.ok(idx, 'index.md deve estar entre as mudanças (não mais pulado)');
assert.ok(idx.newContent.includes('/tabela/velho.md'), 'link do index aponta para o novo caminho');
assert.ok(!idx.newContent.includes('/referencia/velho.md'), 'link antigo não permanece');
console.log('Task 4 OK');

// --- Task 5: moveTargetForType / planReorg ---
assert.strictEqual(A.moveTargetForType('referencia/velho.md', 'Tabela'), 'tabela/velho.md');
assert.strictEqual(A.moveTargetForType('a/b/x.md', 'Referência'), 'referencia/x.md');

const docsT5 = [
  { relPath: 'misc/atlas.md', name: 'atlas.md', content: '---\ntype: Projeto\ntitle: Atlas\n---\n# Atlas' },
  { relPath: 'projeto/aurora.md', name: 'aurora.md', content: '---\ntype: Projeto\ntitle: Aurora\n---\n# Aurora' },
  { relPath: 'index.md', name: 'index.md', content: '# i' },
];
const plan = A.planReorg(docsT5);
assert.strictEqual(plan.length, 1);
assert.strictEqual(plan[0].from, 'misc/atlas.md');
assert.strictEqual(plan[0].to, 'projeto/atlas.md');
assert.strictEqual(plan[0].title, 'Atlas');
console.log('Task 5 OK');
