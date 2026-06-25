'use strict';
// Regressão: um erro do chokidar (ex.: EINVAL de lstat em pastas do Google Drive)
// NÃO pode derrubar o processo principal. O EventEmitter relança 'error' sem
// listener como exceção não tratada — o watcher deve registrar um handler.
// Run: node test-watcher-error.js
const EventEmitter = require('events');

// Stub do chokidar ANTES de carregar o watcher: captura a instância criada.
let lastEmitter = null;
const fakeChokidar = {
  watch() {
    const e = new EventEmitter();
    e.close = () => {};
    lastEmitter = e;
    return e;
  }
};
require.cache[require.resolve('chokidar')] = {
  id: require.resolve('chokidar'),
  filename: require.resolve('chokidar'),
  loaded: true,
  exports: fakeChokidar
};

const { createWatcher } = require('./watcher.js');

let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }

const w = createWatcher(() => {});
w.watch('/tmp/lib-falsa');

ok(lastEmitter && lastEmitter.listenerCount('error') > 0, 'watcher: registra handler de erro do chokidar');

let threw = false;
try {
  lastEmitter.emit('error', new Error("EINVAL: invalid argument, lstat 'G:\\Meu Drive\\x.md'"));
} catch (e) {
  threw = true;
}
ok(!threw, 'watcher: erro do chokidar é tratado e não derruba o processo');

w.close();
console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('WATCHER-ERROR OK');
