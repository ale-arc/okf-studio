'use strict';

/* ============================================================================
   start.js — tela inicial (bibliotecas recentes) e ciclo de vida da biblioteca:
   abrir, exemplo, nova, recarregar, Claude Code. Depende de core.js e data.js.
   ========================================================================== */

/* ---------- Tela inicial (bibliotecas recentes) ---------- */
async function showStart() {
  closeOverlays();
  $('viewer').classList.add('hidden');
  $('empty').classList.remove('hidden');
  let list = [];
  try { list = await window.okf.recents.list(); } catch (e) { list = []; }
  renderRecents(list);
}

function renderRecents(list) {
  const wrap = $('recent-list');
  if (!wrap) return;
  if (!list || !list.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = list.map(e => {
    const cls = 'recent-item' + (e.exists ? '' : ' missing');
    const favIcon = e.exists ? (e.favorite ? '★' : '☆') : '⚠';
    const when = e.exists ? escapeHtml(relTime(e.lastOpened)) : 'Pasta não encontrada';
    return `<div class="${cls}" data-path="${escapeAttr(e.path)}" data-name="${escapeAttr(e.name || '')}" data-exists="${e.exists ? '1' : '0'}">` +
      `<button class="recent-fav" title="Favoritar" data-fav="${escapeAttr(e.path)}">${favIcon}</button>` +
      `<div class="recent-main"><div class="recent-name">${escapeHtml(e.name || e.path.split(/[\\/]/).pop())}</div>` +
      `<div class="recent-path">${escapeHtml(e.path)}</div></div>` +
      `<span class="recent-when">${when}</span>` +
      `<button class="recent-remove" title="Remover da lista" data-remove="${escapeAttr(e.path)}">✕</button>` +
      `</div>`;
  }).join('');
  wrap.querySelectorAll('.recent-item').forEach(el => el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-fav]') || ev.target.closest('[data-remove]')) return;
    if (el.dataset.exists === '0') { toast('Pasta não encontrada', 'bad'); return; }
    openRecent(el.dataset.path, el.dataset.name);
  }));
  wrap.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    renderRecents(await window.okf.recents.toggleFavorite({ path: b.dataset.fav }));
  }));
  wrap.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    renderRecents(await window.okf.recents.remove({ path: b.dataset.remove }));
  }));
}

async function openRecent(p, name) {
  let res;
  try { res = await window.okf.readBundle(p); }
  catch (e) { toast('Não foi possível abrir a biblioteca.', 'bad'); return; }
  const nm = name || p.split(/[\\/]/).pop();
  loadBundle(res, nm);
  await window.okf.recents.add({ path: p, name: nm });
}

function switchLibrary() { showStart(); }

/* ---------- Load bundle ---------- */
async function openFolder() {
  const dir = await window.okf.openFolder();
  if (!dir) return;
  let res;
  try { res = await window.okf.readBundle(dir); }
  catch (e) { toast('Não foi possível abrir a biblioteca.', 'bad'); return; }
  const name = dir.split(/[\\/]/).pop();
  loadBundle(res, name);
  await window.okf.recents.add({ path: dir, name });
}
async function openSample() {
  let res;
  try { res = await window.okf.readSample(); }
  catch (e) { toast('Não foi possível abrir a biblioteca de exemplo.', 'bad'); return; }
  loadBundle(res, 'Biblioteca de exemplo');
}

/* ---------- Nova biblioteca ---------- */
let newLibDir = null;
async function newLibrary() {
  const dir = await window.okf.newLibraryDialog();
  if (!dir) return;
  newLibDir = dir;
  $('nl-dir').textContent = 'Pasta: ' + dir;
  $('nl-name').value = dir.split(/[\\/]/).pop() || 'Biblioteca';
  $('newlib-modal').classList.remove('hidden');
  $('nl-name').focus();
}
function closeNewLib() { $('newlib-modal').classList.add('hidden'); newLibDir = null; }
async function doCreateLibrary() {
  if (!newLibDir) return;
  const name = $('nl-name').value.trim() || 'Biblioteca';
  const files = OKF.auto.libraryFiles(name, todayStr());
  const r = await window.okf.createLibrary({ dir: newLibDir, files });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  const dir = newLibDir;
  closeNewLib();
  const res = await window.okf.readBundle(dir);
  loadBundle(res, name);
  await window.okf.recents.add({ path: dir, name });
  toast('Biblioteca criada em ' + dir, 'good');
}

async function reload() {
  if (!state.root) return;
  let res;
  try { res = await window.okf.readBundle(state.root); }
  catch (e) { toast('Não foi possível recarregar a biblioteca.', 'bad'); return; }
  loadBundle(res, state.name);
  toast('Biblioteca recarregada', 'good');
}

/* ---------- Claude Code (terminal externo) ---------- */
async function openClaude() {
  if (!state.root) return;
  const res = await window.okf.openClaude();
  if (res && res.ok) toast('Claude Code aberto nesta biblioteca', 'good');
  else toast('Não foi possível abrir: ' + ((res && res.error) || 'erro'), 'bad');
}
