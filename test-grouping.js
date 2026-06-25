'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const G = OKF.auto.groupConcepts;

const doc = (relPath, fm, body) => ({ relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '# x') });

// modo Tipo: agrupa por type; sem type -> "Sem tipo" (especial por último)
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'Atlas' }),
    doc('processo/b.md', { type: 'Processo', title: 'Onboarding' }),
    doc('x/c.md', { title: 'Solto' }),
  ];
  const g = G(docs, 'type');
  assert.deepStrictEqual(g.map(x => x.label), ['Processo', 'Projeto', 'Sem tipo']);
  assert.strictEqual(g.find(x => x.label === 'Projeto').items[0].title, 'Atlas');
}

// modo Tag: multi-tag duplica; sem tag -> "Sem tag"
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'A', tags: ['alpha', 'beta'] }),
    doc('p/b.md', { type: 'Projeto', title: 'B', tags: ['alpha'] }),
    doc('p/c.md', { type: 'Projeto', title: 'C' }),
  ];
  const g = G(docs, 'tag');
  assert.deepStrictEqual(g.find(x => x.label === 'alpha').items.map(i => i.title), ['A', 'B']);
  assert.deepStrictEqual(g.find(x => x.label === 'beta').items.map(i => i.title), ['A']);
  assert.deepStrictEqual(g.find(x => x.label === 'Sem tag').items.map(i => i.title), ['C']);
  assert.strictEqual(g[g.length - 1].label, 'Sem tag');
}

// reservados -> grupo Sistema (flag system, por último)
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'A' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
    { relPath: 'log.md', name: 'log.md', content: '# Log' },
  ];
  const g = G(docs, 'type');
  const sys = g.find(x => x.system);
  assert.ok(sys, 'grupo Sistema existe');
  assert.strictEqual(sys.label, 'Sistema');
  assert.strictEqual(sys.key, OKF.auto.SYSTEM_GROUP_KEY);
  assert.strictEqual(sys.items.length, 2);
  assert.strictEqual(g[g.length - 1].system, true);
}

// modo Lista: um grupo sem label (itens por título) + Sistema ao fim
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'Bravo' }),
    doc('p/b.md', { type: 'Processo', title: 'Alfa' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
  ];
  const g = G(docs, 'flat');
  const all = g.find(x => !x.system);
  assert.strictEqual(all.label, '');
  assert.deepStrictEqual(all.items.map(i => i.title), ['Alfa', 'Bravo']);
  assert.ok(g.find(x => x.system), 'Sistema presente em Lista');
}

console.log('test-grouping OK');
