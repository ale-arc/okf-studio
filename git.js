'use strict';
// Executa o git (CLI) com cwd = raiz da biblioteca. Sem manuseio de credenciais.
const { execFile } = require('child_process');

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: String(stderr || err.message || '').trim(), stdout: stdout || '' });
      else resolve({ ok: true, stdout: stdout || '' });
    });
  });
}

async function isRepo(cwd) {
  const r = await run(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

async function status(cwd) {
  if (!(await isRepo(cwd))) return { ok: true, repo: false, files: [], branch: '', hasRemote: false };
  const st = await run(cwd, ['status', '--porcelain']);
  if (!st.ok) return { ok: false, error: st.error };
  const files = st.stdout.split(/\r?\n/).filter(Boolean).map((line) => ({
    code: line.slice(0, 2).trim() || line.slice(0, 2),
    path: line.slice(3)
  }));
  const br = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const rm = await run(cwd, ['remote']);
  return { ok: true, repo: true, files, branch: br.ok ? br.stdout.trim() : '', hasRemote: !!(rm.ok && rm.stdout.trim()) };
}

async function commit(cwd, message) {
  const add = await run(cwd, ['add', '-A']);
  if (!add.ok) return add;
  return run(cwd, ['commit', '-m', message]);
}

function push(cwd) { return run(cwd, ['push']); }
function init(cwd) { return run(cwd, ['init']); }

function registerGitHandlers(ipcMain, getRoot) {
  const guard = (fn) => () => { const r = getRoot(); return r ? fn(r) : { ok: false, error: 'Abra uma biblioteca primeiro.' }; };
  ipcMain.handle('git:status', guard(status));
  ipcMain.handle('git:push', guard(push));
  ipcMain.handle('git:init', guard(init));
  ipcMain.handle('git:commit', (_e, msg) => { const r = getRoot(); return r ? commit(r, msg) : { ok: false, error: 'Abra uma biblioteca primeiro.' }; });
}

module.exports = { isRepo, status, commit, push, init, registerGitHandlers };
