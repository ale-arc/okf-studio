'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;

const doc = (relPath, fm, body) => ({ relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '# x') });

// Biblioteca com vários problemas plantados.
const docs = [
  // a cita b (existe) e cita um inexistente -> 1 link quebrado
  doc('projeto/a.md', { type: 'Projeto', title: 'Atlas', description: 'd', tags: ['x'] },
      '# Atlas\nVer [b](/processo/b.md) e [fantasma](/nada/zzz.md).'),
  // b: sem ninguém citando -> órfão; sem description e sem tags
  doc('processo/b.md', { type: 'Processo', title: 'Onboarding' }, '# Onboarding'),
  // c e d têm o MESMO título "Atlas" -> duplicado; c usa "referencia" (slug = referencia)
  doc('referencia/c.md', { type: 'referencia', title: 'Atlas', description: 'd', tags: ['y'] }, '# c'),
  // d usa "Referência" -> mesmo slug que "referencia" -> tipo inconsistente
  doc('referencia/d.md', { type: 'Referência', title: 'Atlas', description: 'd', tags: ['z'] }, '# d'),
  // reservados são ignorados
  doc('index.md', { okf_version: '0.1' }, '# Índice'),
  doc('log.md', {}, '# Histórico'),
];

const h = OKF.health(docs);

// 1) Links quebrados
assert.strictEqual(h.brokenLinks.length, 1, 'um link quebrado');
assert.strictEqual(h.brokenLinks[0].where, 'projeto/a.md');
assert.ok(h.brokenLinks[0].target.includes('zzz'), 'aponta o alvo quebrado');

// 2) Órfãos: b (ninguém cita), c, d (ninguém cita). a é citado por ninguém também -> órfão.
//    a cita b, então b NÃO é órfão. Quem tem backlink de entrada: b. Órfãos: a, c, d.
const orphanPaths = h.orphans.map(o => o.where).sort();
assert.deepStrictEqual(orphanPaths, ['projeto/a.md', 'referencia/c.md', 'referencia/d.md']);

// 3) Tipos inconsistentes: slug "referencia" com rótulos {referencia, Referência}
assert.strictEqual(h.inconsistentTypes.length, 1, 'um slug inconsistente');
assert.strictEqual(h.inconsistentTypes[0].slug, 'referencia');
assert.deepStrictEqual(h.inconsistentTypes[0].variants.slice().sort(), ['Referência', 'referencia']);
assert.ok(h.inconsistentTypes[0].variants.includes(h.inconsistentTypes[0].canonical));

// 4) Títulos duplicados: "Atlas" aparece em a, c, d (3)
const dup = h.duplicateTitles.find(d => d.title === 'Atlas');
assert.ok(dup, 'duplicado Atlas');
assert.strictEqual(dup.items.length, 3);

// 5) Sem descrição / sem tags: só b
assert.deepStrictEqual(h.noDescription.map(x => x.where), ['processo/b.md']);
assert.deepStrictEqual(h.noTags.map(x => x.where), ['processo/b.md']);

// 6) counts coerentes
assert.strictEqual(h.counts.brokenLinks, 1);
assert.strictEqual(h.counts.orphans, 3);
assert.strictEqual(h.counts.inconsistentTypes, 1);
assert.strictEqual(h.counts.duplicateTitles, 1);

// 7) Não muta a entrada
const before = JSON.stringify(docs);
OKF.health(docs);
assert.strictEqual(JSON.stringify(docs), before, 'health não muta docs');

// 8) Biblioteca saudável -> tudo zero
const clean = [
  doc('projeto/a.md', { type: 'Projeto', title: 'A', description: 'd', tags: ['x'] }, '# A\n[B](/projeto/b.md)'),
  doc('projeto/b.md', { type: 'Projeto', title: 'B', description: 'd', tags: ['x'] }, '# B\n[A](/projeto/a.md)'),
];
const hc = OKF.health(clean);
assert.strictEqual(hc.brokenLinks.length, 0);
assert.strictEqual(hc.orphans.length, 0);
assert.strictEqual(hc.inconsistentTypes.length, 0);
assert.strictEqual(hc.duplicateTitles.length, 0);

console.log('test-health OK');
