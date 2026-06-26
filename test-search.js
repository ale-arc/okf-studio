'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;

const doc = (relPath, fm, body) => ({ relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body) });

const docs = [
  doc('projeto/a.md', { type: 'Projeto', title: 'Foo no título' }, '# A\nO Atlas usa foo e FOO de novo.'),
  doc('processo/b.md', { type: 'Processo', title: 'B' }, '# B\nNada relevante aqui.'),
  doc('index.md', { okf_version: '0.1' }, '# Índice com foo reservado'),
];

// --- searchConcepts ---
{
  // insensível: 'foo' casa "foo" e "FOO" no corpo de a (2x); b não; reservado ignorado
  const r = OKF.searchConcepts(docs, 'foo');
  assert.strictEqual(r.length, 1, 'só a casa');
  assert.strictEqual(r[0].relPath, 'projeto/a.md');
  assert.strictEqual(r[0].count, 2, 'duas ocorrências no corpo');
  assert.ok(r[0].snippets.length >= 1 && r[0].snippets[0].match.toLowerCase() === 'foo');
  // NÃO busca no frontmatter (title 'Foo no título' não conta)
  assert.strictEqual(r[0].count, 2);

  // sensível a maiúsculas: só "foo" (1)
  const rs = OKF.searchConcepts(docs, 'foo', { caseSensitive: true });
  assert.strictEqual(rs[0].count, 1);

  // vazio -> sem resultados
  assert.deepStrictEqual(OKF.searchConcepts(docs, ''), []);
}

// --- replaceInBody ---
{
  const a = docs[0].content;
  const { content, count } = OKF.replaceInBody(a, 'foo', 'bar');
  assert.strictEqual(count, 2, 'substitui as 2 (insensível)');
  assert.ok(content.includes('bar e bar'), 'corpo substituído');
  assert.ok(/title:\s*Foo no título/.test(content), 'frontmatter preservado (Foo intacto)');
  assert.ok(content.includes('type: Projeto'), 'frontmatter preservado');

  // sem ocorrência -> conteúdo inalterado, count 0
  const none = OKF.replaceInBody(a, 'inexistente', 'x');
  assert.strictEqual(none.count, 0);
  assert.strictEqual(none.content, a);

  // sensível: só a minúscula
  const cs = OKF.replaceInBody(a, 'foo', 'bar', { caseSensitive: true });
  assert.strictEqual(cs.count, 1);

  // arquivo sem frontmatter: trata o conteúdo inteiro como corpo, sem corromper
  const plain = '# Título\ntexto com alvo aqui';
  const pr = OKF.replaceInBody(plain, 'alvo', 'meta');
  assert.strictEqual(pr.count, 1);
  assert.strictEqual(pr.content, '# Título\ntexto com meta aqui');
}

console.log('test-search OK');
