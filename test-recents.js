'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./recents.js');

// addEntry: dedup por path; atualiza name/lastOpened; preserva favorite
{
  let list = [];
  list = R.addEntry(list, { path: '/a', name: 'A' }, 1000);
  list = R.addEntry(list, { path: '/b', name: 'B' }, 2000);
  assert.strictEqual(list.length, 2);
  list = R.toggleFavorite(list, '/a');
  list = R.addEntry(list, { path: '/a', name: 'A2' }, 3000);
  assert.strictEqual(list.length, 2, 'dedup por path');
  const a = list.find(e => e.path === '/a');
  assert.strictEqual(a.name, 'A2', 'name atualizado');
  assert.strictEqual(a.lastOpened, 3000, 'lastOpened atualizado');
  assert.strictEqual(a.favorite, true, 'favorite preservado ao reabrir');
}

// sortAndCap: favoritas no topo, demais por lastOpened desc
{
  const list = [
    { path: '/x', name: 'x', lastOpened: 10, favorite: false },
    { path: '/y', name: 'y', lastOpened: 30, favorite: false },
    { path: '/z', name: 'z', lastOpened: 20, favorite: true },
  ];
  assert.deepStrictEqual(R.sortAndCap(list).map(e => e.path), ['/z', '/y', '/x']);
}

// cap de 20 preservando favoritas
{
  const list = [];
  for (let i = 0; i < 25; i++) list.push({ path: '/p' + i, name: 'p' + i, lastOpened: i, favorite: false });
  list.push({ path: '/fav', name: 'fav', lastOpened: -1, favorite: true });
  const s = R.sortAndCap(list);
  assert.strictEqual(s.length, R.CAP, 'teto de 20');
  assert.ok(s.some(e => e.path === '/fav'), 'favorita antiga preservada');
  assert.ok(!s.some(e => e.path === '/p0'), 'não-favorita mais antiga descartada');
}

// removeEntry
{
  const list = [{ path: '/a', name: 'A' }, { path: '/b', name: 'B' }];
  assert.deepStrictEqual(R.removeEntry(list, '/a').map(e => e.path), ['/b']);
}

// enrichExists: função injetada e fs real
{
  const e = R.enrichExists([{ path: '/exists', name: 'E' }, { path: '/missing', name: 'M' }],
    (p) => p === '/exists');
  assert.strictEqual(e[0].exists, true);
  assert.strictEqual(e[1].exists, false);
  const missing = path.join(os.tmpdir(), 'okf-nao-existe-xyz');
  assert.strictEqual(R.enrichExists([{ path: missing, name: 'M' }])[0].exists, false);
}

console.log('test-recents (puro) OK');
