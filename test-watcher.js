'use strict';
// Smoke: o watcher detecta uma alteração de arquivo. Run: npm run test:watch
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWatcher } = require('./watcher.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-watch-'));
let fired = false;
const w = createWatcher(() => { fired = true; });
w.watch(dir);

setTimeout(() => { fs.writeFileSync(path.join(dir, 'novo.md'), '# oi'); }, 400);
setTimeout(() => {
  console.log('detectou-mudanca:', fired);
  console.log(fired ? 'RESULT: PASS' : 'RESULT: FAIL');
  w.close();
  process.exit(fired ? 0 : 1);
}, 1800);
