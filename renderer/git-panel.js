'use strict';

/* ============================================================================
   git-panel.js — painel Git (status, commit, push, init). Depende de core.js.
   ========================================================================== */

function showGit() {
  if (!state.root) return;
  closeOverlays();
  $('git-view').classList.remove('hidden');
  refreshGit();
}
async function refreshGit() {
  let s;
  try { s = await window.okf.git.status(); } catch (e) { s = { ok: false, error: String(e) }; }
  renderGit(s);
}
function renderGit(s) {
  const branch = $('git-branch'), list = $('git-list'), commit = $('git-commit'), norepo = $('git-norepo');
  if (!s || !s.ok) {
    norepo.classList.add('hidden'); commit.classList.add('hidden'); branch.textContent = '';
    list.innerHTML = `<div class="git-empty">Erro: ${escapeHtml((s && s.error) || '')}</div>`;
    return;
  }
  if (!s.repo) {
    norepo.classList.remove('hidden'); commit.classList.add('hidden');
    list.innerHTML = ''; branch.textContent = '';
    return;
  }
  norepo.classList.add('hidden'); commit.classList.remove('hidden');
  branch.textContent = s.branch ? ('branch: ' + s.branch) : '';
  $('git-do-push').disabled = !s.hasRemote;
  $('git-do-push').title = s.hasRemote ? 'Enviar (push)' : 'Sem remoto — adicione pelo terminal (git remote add origin …)';
  if (!s.files.length) { list.innerHTML = '<div class="git-empty">Nada para commitar — tudo limpo.</div>'; return; }
  list.innerHTML = s.files.map((f) => {
    const cls = /D/.test(f.code) ? 'del' : (/[AR?]/.test(f.code) ? 'add' : 'mod');
    return `<div class="git-item"><span class="git-code ${cls}">${escapeHtml(f.code || '?')}</span>` +
           `<span class="git-path">${escapeHtml(f.path)}</span></div>`;
  }).join('');
}
async function gitCommit() {
  const msg = $('git-msg').value.trim();
  if (!msg) { toast('Informe a mensagem do commit.', 'bad'); return; }
  const r = await window.okf.git.commit(msg);
  if (r && r.ok) { toast('Commit feito.', 'good'); $('git-msg').value = ''; refreshGit(); }
  else toast('Erro no commit: ' + ((r && r.error) || ''), 'bad');
}
async function gitPush() {
  const r = await window.okf.git.push();
  if (r && r.ok) toast('Push concluído.', 'good');
  else toast('Erro no push: ' + ((r && r.error) || '') + ' — faça login pelo terminal se necessário.', 'bad');
}
async function gitInit() {
  const r = await window.okf.git.init();
  if (r && r.ok) { toast('Repositório inicializado.', 'good'); refreshGit(); }
  else toast('Erro: ' + ((r && r.error) || ''), 'bad');
}
