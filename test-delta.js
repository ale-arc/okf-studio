'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;

// opsToDelta: create/write .md -> upsert (doc completo); delete -> deletes; ignora binária/não-.md
{
  const ops = [
    { op: 'write', relPath: 'projeto/a.md', content: 'A' },
    { op: 'create', relPath: 'index.md', content: 'I' },
    { op: 'delete', relPath: 'projeto/b.md' },
    { op: 'create', relPath: 'assets/x.png', content: 'bytes', binary: true },
    { op: 'write', relPath: 'assets/y.txt', content: 'txt' },
  ];
  const d = OKF.opsToDelta(ops);
  assert.deepStrictEqual(d.deletes, ['projeto/b.md']);
  assert.strictEqual(d.upserts.length, 2);
  const a = d.upserts.find(u => u.relPath === 'projeto/a.md');
  assert.strictEqual(a.content, 'A');
  assert.strictEqual(a.name, 'a.md');
  assert.strictEqual(a.reserved, false);
  const idx = d.upserts.find(u => u.relPath === 'index.md');
  assert.strictEqual(idx.reserved, true);
}

// applyDelta: upsert substitui, novo é acrescentado, delete remove, não muta entrada
{
  const docs = [
    { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: 'old' },
    { relPath: 'projeto/b.md', name: 'b.md', reserved: false, content: 'B' },
  ];
  const delta = {
    upserts: [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: 'new' },
      { relPath: 'processo/c.md', name: 'c.md', reserved: false, content: 'C' },
    ],
    deletes: ['projeto/b.md'],
  };
  const out = OKF.applyDelta(docs, delta);
  assert.strictEqual(out.find(d => d.relPath === 'projeto/a.md').content, 'new');
  assert.ok(out.find(d => d.relPath === 'processo/c.md'));
  assert.ok(!out.find(d => d.relPath === 'projeto/b.md'));
  assert.strictEqual(out.length, 2);
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].content, 'old');
}

console.log('test-delta OK');
