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

// favoritos: grupo "★ Favoritos" primeiro; item duplicado no grupo normal
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'Atlas' }),
    doc('projeto/b.md', { type: 'Projeto', title: 'Bravo' }),
  ];
  const g = G(docs, 'type', new Set(['projeto/a.md']));
  assert.strictEqual(g[0].favorites, true);
  assert.strictEqual(g[0].key, OKF.auto.FAVORITES_GROUP_KEY);
  assert.deepStrictEqual(g[0].items.map(i => i.title), ['Atlas']);
  assert.deepStrictEqual(g.find(x => x.label === 'Projeto').items.map(i => i.title), ['Atlas', 'Bravo']);
}

// sem favoritos -> nenhum grupo Favoritos (e compat sem o 3º argumento)
{
  const docs = [doc('p/a.md', { type: 'Projeto', title: 'A' })];
  assert.ok(!G(docs, 'type', new Set()).some(x => x.favorites));
  assert.ok(!G(docs, 'type').some(x => x.favorites));
}

// reservado no set de favoritos é ignorado
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'A' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
  ];
  assert.ok(!G(docs, 'type', new Set(['index.md'])).some(x => x.favorites));
}

// favoritos no modo Lista: grupo "★ Favoritos" no topo, item também na lista plana
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'A' }),
    doc('p/b.md', { type: 'Processo', title: 'B' }),
  ];
  const g = G(docs, 'flat', new Set(['p/a.md']));
  assert.strictEqual(g[0].favorites, true);
  assert.deepStrictEqual(g[0].items.map(i => i.title), ['A']);
  const flat = g.find(x => !x.favorites && !x.system);
  assert.deepStrictEqual(flat.items.map(i => i.title), ['A', 'B']);
}

// withAddedTag: adiciona, idempotente, cria tags, preserva resto
{
  const c0 = OKF.serialize({ type: 'Projeto', title: 'A' }, '# A\n\nCorpo.');
  const c1 = OKF.auto.withAddedTag(c0, 'alpha');
  const p1 = OKF.parse(c1);
  assert.deepStrictEqual(p1.frontmatter.tags, ['alpha']);
  assert.strictEqual(p1.frontmatter.type, 'Projeto');
  assert.ok(/Corpo\./.test(p1.body));
  const c2 = OKF.auto.withAddedTag(c1, 'beta');
  assert.deepStrictEqual(OKF.parse(c2).frontmatter.tags, ['alpha', 'beta']);
  const c3 = OKF.auto.withAddedTag(c2, 'alpha'); // já presente
  assert.strictEqual(c3, c2);
  assert.strictEqual(OKF.auto.withAddedTag(c0, '  '), c0); // tag vazia: inalterado
}

// parseDoc: equivale a parse e memoiza no doc (_p/_pSrc)
{
  const d = { relPath: 'p/a.md', content: OKF.serialize({ type: 'Projeto', title: 'A' }, '# A') };
  const p1 = OKF.parseDoc(d);
  assert.strictEqual(p1.frontmatter.type, 'Projeto');
  assert.strictEqual(d._pSrc, d.content);
  d._p = { frontmatter: { type: 'SENTINELA' }, body: '' };
  assert.strictEqual(OKF.parseDoc(d).frontmatter.type, 'SENTINELA');
  d.content = OKF.serialize({ type: 'Outro', title: 'A' }, '# A');
  assert.strictEqual(OKF.parseDoc(d).frontmatter.type, 'Outro');
  assert.deepStrictEqual(OKF.parseDoc({}).frontmatter, {});
}

console.log('test-grouping OK');
