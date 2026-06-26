'use strict';
const assert = require('node:assert');
const { orderOps } = require('./ops.js');

{
  const ops = [
    { op: 'delete', relPath: 'a.md' },
    { op: 'create', relPath: 'b.md' },
    { op: 'write', relPath: 'c.md' },
    { op: 'delete', relPath: 'd.md' },
  ];
  const out = orderOps(ops);
  assert.deepStrictEqual(out.map(o => o.op), ['create', 'write', 'delete', 'delete']);
  assert.deepStrictEqual(out.map(o => o.relPath), ['b.md', 'c.md', 'a.md', 'd.md']);
  assert.deepStrictEqual(orderOps(null), []);
  assert.strictEqual(orderOps(ops).length, ops.length);
}
console.log('test-ops OK');
