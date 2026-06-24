'use strict';
// Smoke: status lista um arquivo novo; após commit, fica limpo. Run: npm run test:git
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { init, status, commit } = require('./git.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-git-'));
  await init(dir);
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.md'), '# a');

  const s1 = await status(dir);
  const listed = s1.ok && s1.repo && s1.files.length === 1 && s1.files[0].path === 'a.md';

  const c = await commit(dir, 'add a');
  const s2 = await status(dir);
  const clean = c.ok && s2.ok && s2.files.length === 0;

  console.log('lista 1 arquivo:', listed, '| limpo após commit:', clean);
  console.log(listed && clean ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(listed && clean ? 0 : 1);
})();
