'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  root: null,
  name: '',
  docs: [],            // [{relPath,name,reserved,content,mtime}]
  byId: new Map(),     // conceptId -> doc
  current: null,       // relPath of open doc
  editing: false,
  graph: null,
  editorMode: 'visual',
  editorBody: '',
  linkSuggestions: [],
  templates: [],
  collapsed: new Set(),
  favorites: new Set(),
};

/* ---------- Modelos do usuário (fora da biblioteca) ---------- */
async function loadTemplates() {
  try {
    const raw = await window.okf.templates.list();
    state.templates = (raw || []).map(t => {
      const p = OKF.parse(t.content);
      const f = p.frontmatter || {};
      return {
        name: t.name,
        type: f.type ? String(f.type) : '',
        description: f.description ? String(f.description) : '',
        tags: Array.isArray(f.tags) ? f.tags.map(String) : (f.tags ? [String(f.tags)] : []),
        body: p.body || ''
      };
    });
  } catch (e) { state.templates = []; }
  window.__okfTemplates = state.templates; // usado pelo smoke test
}
function applyTemplateToForm(name) {
  const t = state.templates.find(x => x.name === name);
  if (!t) return;
  $('m-type').value = t.type || '';
  $('m-description').value = t.description || '';
  $('m-tags').value = (t.tags || []).join(', ');
}

/* ---------- Automação: preferência + montagem de ops ---------- */
function autoIndexEnabled() {
  try { return localStorage.getItem('okf-auto-index') !== 'off'; } catch (e) { return true; }
}
function setAutoIndex(on) {
  try { localStorage.setItem('okf-auto-index', on ? 'on' : 'off'); } catch (e) {}
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function baseNameOf(rel) { return rel.split('/').pop(); }
function docByRel(rel) { return state.docs.find(d => d.relPath === rel); }

// Todos os diretórios que devem ter index.md: raiz ('') + cada ancestral com conceito.
function indexDirs(docs) {
  const dirs = new Set(['']);
  for (const d of docs) {
    if (OKF.isReserved(d.relPath)) continue;
    if (!d.relPath.includes('/')) continue;
    const parts = d.relPath.split('/'); parts.pop();
    let acc = '';
    for (const p of parts) { acc = acc ? acc + '/' + p : p; dirs.add(acc); }
  }
  return [...dirs];
}

function indexContentFor(docs, dir) {
  const rel = dir ? dir + '/index.md' : 'index.md';
  const existing = docs.find(d => d.relPath === rel) || docByRel(rel);
  const listing = dir === '' ? OKF.auto.rootListing(docs) : OKF.auto.dirListing(docs, dir);
  let base;
  if (existing) {
    base = existing.content;
  } else if (dir === '') {
    base = OKF.serialize({ okf_version: '0.1' },
      '# ' + (state.name || 'Biblioteca') + '\n\nÍndice da biblioteca.\n\n' +
      OKF.auto.MARK_START + '\n' + OKF.auto.MARK_END + '\n');
  } else {
    base = '# ' + OKF.auto.headingFor(dir.split('/').pop()) + '\n\n' +
      OKF.auto.MARK_START + '\n' + OKF.auto.MARK_END + '\n';
  }
  return OKF.auto.mergeManagedBlock(base, listing);
}

// Ops para (re)escrever todos os index.md a partir de um conjunto de docs.
function indexOpsFrom(docs) {
  const ops = [];
  const dirs = indexDirs(docs);
  for (const dir of dirs) {
    const rel = dir ? dir + '/index.md' : 'index.md';
    const content = indexContentFor(docs, dir);
    const existing = docs.find(d => d.relPath === rel);
    if (!existing) ops.push({ op: 'create', relPath: rel, content });
    else if (existing.content !== content) ops.push({ op: 'write', relPath: rel, content });
  }
  // Remove index.md de subdiretórios que não contêm mais nenhum conceito.
  const keep = new Set(dirs.map(d => (d ? d + '/index.md' : 'index.md')));
  for (const d of docs) {
    if (d.relPath.split('/').pop().toLowerCase() !== 'index.md') continue;
    if (!keep.has(d.relPath)) ops.push({ op: 'delete', relPath: d.relPath });
  }
  return ops;
}

// Op para o log.md, a partir de um conjunto de docs (usa o conteúdo já presente).
function logOpFrom(docs, entry) {
  const existing = docs.find(d => d.relPath === 'log.md');
  const base = existing ? existing.content : '# Histórico de Atualizações\n';
  const content = OKF.auto.appendLog(base, todayStr(), entry);
  return existing ? { op: 'write', relPath: 'log.md', content } : { op: 'create', relPath: 'log.md', content };
}

// Re-renderiza tudo a partir do state.docs atual (sem I/O) e seleciona selectRel.
function rerenderFromState(selectRel) {
  indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  const want = selectRel || state.current;
  if (want && state.docs.some(d => d.relPath === want)) openDoc(want);
  else if (state.docs.length) { const f = state.docs.find(d => !d.reserved) || state.docs[0]; openDoc(f.relPath); }
  else showEmpty();
}

// Aplica um lote e recarrega o estado do disco; seleciona selectRel se informado.
async function applyOpsAndRefresh(ops, selectRel) {
  const r = await window.okf.applyOps({ root: state.root, ops });
  if (!r || !r.ok) {
    toast('Erro ao gravar: ' + ((r && r.error) || 'desconhecido'), 'bad');
    await refreshFromDisk(null);
    return false;
  }
  state.docs = OKF.applyDelta(state.docs, OKF.opsToDelta(ops)); // patch sem reler o disco
  rerenderFromState(selectRel);
  if (!$('git-view').classList.contains('hidden')) refreshGit();
  return true;
}

async function refreshFromDisk(selectRel) {
  const res = await window.okf.readBundle(state.root);
  state.docs = res.docs || [];
  rerenderFromState(selectRel);
}

/* ---------- Tema (claro/escuro) ---------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) { btn.textContent = theme === 'light' ? '☀' : '🌙'; }
  try { localStorage.setItem('okf-theme', theme); } catch (e) {}
  // Re-render the graph so its colors follow the new theme.
  if (typeof showGraph === 'function' && state && state.root &&
      $('graph-view') && !$('graph-view').classList.contains('hidden')) {
    showGraph();
  }
}
function initTheme() {
  let theme;
  try { theme = localStorage.getItem('okf-theme'); } catch (e) {}
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(theme);
}
function toggleTheme() { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); }
window.__okfSetTheme = applyTheme; // usado pelo smoke test

marked.setOptions({ gfm: true, breaks: false });

/* Memoized OKF.parse — avoids re-parsing every doc's YAML on each keystroke. */
function parsedOf(doc) {
  if (doc._pSrc !== doc.content) { doc._p = OKF.parse(doc.content); doc._pSrc = doc.content; }
  return doc._p;
}

/* Corpo do doc em minúsculas, memoizado (para a busca não re-baixar toda vez). */
function bodyLcOf(doc) {
  if (doc._blcSrc !== doc.content) { doc._blc = (parsedOf(doc).body || '').toLowerCase(); doc._blcSrc = doc.content; }
  return doc._blc;
}

/* Timestamps ISO são lidos pelo js-yaml como Date — formata de volta para ISO
   (sem milissegundos) para não corromper o campo ao exibir/editar/salvar. */
function fmtTimestamp(v) {
  if (v instanceof Date) return v.toISOString().replace(/\.\d+Z$/, 'Z');
  return String(v);
}

/* ---------- Data relativa para os recentes ---------- */
function relTime(ms, now) {
  const t = Number(ms) || 0;
  const ref = now || Date.now();
  const s = Math.max(0, Math.floor((ref - t) / 1000));
  if (s < 60) return 'agora';
  const min = Math.floor(s / 60);
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d <= 7) return 'há ' + d + ' dias';
  const dt = new Date(t);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + dt.getFullYear();
}

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

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

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

/* ---------- Recarga ao vivo (watcher) ---------- */
async function reloadFromDisk(delta) {
  if (!state.root) return;
  let newDocs;
  if (delta && (delta.upserts || delta.deletes)) {
    newDocs = OKF.applyDelta(state.docs, delta); // mudança externa: só o delta
  } else {
    let res;
    try { res = await window.okf.readBundle(state.root); } catch (e) { return; } // full (fallback)
    newDocs = res.docs || [];
  }

  // Edição em andamento: nunca sobrescrever o editor.
  if (state.editing && state.current) {
    const old = state.docs.find(d => d.relPath === state.current);
    const cur = newDocs.find(d => d.relPath === state.current);
    state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
    $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
    if (cur && old && cur.content !== old.content) $('disk-banner').classList.remove('hidden');
    return;
  }

  // Sem edição: atualização preservando a seleção.
  state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  if (state.current && state.docs.some(d => d.relPath === state.current)) {
    renderConcept(state.docs.find(d => d.relPath === state.current));
  } else if (state.docs.length) {
    const first = state.docs.find(d => !d.reserved) || state.docs[0];
    openDoc(first.relPath);
  } else {
    showEmpty();
  }
}

function loadBundle(res, name) {
  state.root = res.root;
  state.name = name;
  state.docs = res.docs || [];
  indexDocs();
  state.collapsed = loadCollapsedSet();
  state.favorites = loadFavoritesSet();
  $('bundle-name').textContent = name + '  ·  ' + state.docs.length + ' arquivos';
  ['btn-reload','btn-new','btn-graph','btn-validate','btn-claude','btn-git','search','type-filter'].forEach(id => $(id).disabled = false);
  document.querySelectorAll('#group-seg button').forEach(b => b.disabled = false);
  updateGroupModeButtons();
  buildTypeFilter();
  renderTree();
  closeOverlays();
  if (!state.docs.length) {
    showEmpty();
  } else {
    const first = state.docs.find(d => !d.reserved) || state.docs[0];
    openDoc(first.relPath);
  }
}

function indexDocs() {
  state.byId = new Map();
  for (const d of state.docs) state.byId.set(OKF.conceptId(d.relPath), d);
  state.graph = OKF.buildGraph(state.docs);
}

/* ---------- Agrupamento e colapso da árvore ---------- */
function currentGroupMode() {
  try { const m = localStorage.getItem('okf-group-mode'); return (m === 'tag' || m === 'flat') ? m : 'type'; }
  catch (e) { return 'type'; }
}
function setGroupMode(mode) { try { localStorage.setItem('okf-group-mode', mode); } catch (e) {} }
function updateGroupModeButtons() {
  const mode = currentGroupMode();
  document.querySelectorAll('#group-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
}
function collapseKey() { return 'okf-collapsed:' + (state.root || ''); }
function loadCollapsedSet() {
  let raw = null;
  try { raw = localStorage.getItem(collapseKey()); } catch (e) {}
  if (raw == null) return new Set([OKF.auto.SYSTEM_GROUP_KEY]); // 1ª vez: Sistema recolhido
  try { const a = JSON.parse(raw); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
}
function saveCollapsed(set) { try { localStorage.setItem(collapseKey(), JSON.stringify([...set])); } catch (e) {} }
function favoritesKey() { return 'okf-favorites:' + (state.root || ''); }
function loadFavoritesSet() {
  try { const a = JSON.parse(localStorage.getItem(favoritesKey())); return new Set(Array.isArray(a) ? a : []); }
  catch (e) { return new Set(); }
}
function saveFavorites() { try { localStorage.setItem(favoritesKey(), JSON.stringify([...state.favorites])); } catch (e) {} }
function toggleFavorite(rel) {
  if (!rel) return;
  if (state.favorites.has(rel)) state.favorites.delete(rel); else state.favorites.add(rel);
  saveFavorites();
  renderTree();
}
function toggleGroup(key) {
  if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
  saveCollapsed(state.collapsed);
  renderTree();
}

// Decide se um grupo aceita o conceito arrastado (gate do destaque visual).
function isValidDropTarget(g, rel) {
  if (!rel || !g) return false;
  const doc = docByRel(rel);
  if (!doc || doc.reserved) return false;
  if (g.favorites) return !state.favorites.has(rel);
  if (g.system || g.special) return false;
  if (g.key && g.key.indexOf('type:') === 0) {
    const curType = OKF.parse(doc.content).frontmatter.type || '';
    return OKF.auto.folderForType(curType) !== OKF.auto.folderForType(g.label);
  }
  if (g.key && g.key.indexOf('tag:') === 0) {
    const tags = OKF.parse(doc.content).frontmatter.tags;
    const arr = Array.isArray(tags) ? tags : (tags != null && String(tags).trim() !== '' ? [tags] : []);
    return !arr.some(x => String(x).trim() === g.label);
  }
  return false;
}

// Executa a operação do drop conforme o grupo-alvo.
async function handleDropOnGroup(rel, g) {
  if (!isValidDropTarget(g, rel)) return;
  const doc = docByRel(rel);
  if (g.favorites) {
    state.favorites.add(rel); saveFavorites(); renderTree();
    toast('Favoritado', 'good');
    return;
  }
  if (g.key.indexOf('type:') === 0) {
    const newType = g.label;
    const ok = await window.okf.confirm({
      message: 'Mudar o tipo para "' + newType + '"?',
      detail: 'O arquivo será movido para a pasta do tipo e os links atualizados.'
    });
    if (!ok) return;
    const p = OKF.parse(doc.content);
    const content = OKF.serialize(Object.assign({}, p.frontmatter, { type: newType }), p.body);
    const dest = await changeConceptType(rel, newType, content);
    if (dest) toast('Tipo alterado para ' + newType, 'good');
    return;
  }
  if (g.key.indexOf('tag:') === 0) {
    const content = OKF.auto.withAddedTag(doc.content, g.label);
    const ok = await applyOpsAndRefresh([{ op: 'write', relPath: rel, content }], rel);
    if (ok) toast('Tag "' + g.label + '" adicionada', 'good');
    return;
  }
}

/* ---------- Tree ---------- */
function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  const q = ($('search').value || '').toLowerCase().trim();
  const typeF = $('type-filter').value;
  const mode = currentGroupMode();

  // 1) filtro (busca + tipo) — mesma semântica de antes
  const filtered = state.docs.filter(d => {
    const p = parsedOf(d);
    const id = OKF.conceptId(d.relPath);
    const title = p.frontmatter.title || d.name.replace(/\.md$/i, '');
    const type = d.reserved ? '' : (p.frontmatter.type || '');
    if (typeF && type !== typeF) return false;
    if (q) {
      const tags = Array.isArray(p.frontmatter.tags) ? p.frontmatter.tags.join(' ') : (p.frontmatter.tags || '');
      const body = bodyLcOf(d);
      if (!(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) ||
            String(tags).toLowerCase().includes(q) || body.includes(q))) return false;
    }
    return true;
  });

  // 2) agrupar
  const groups = OKF.auto.groupConcepts(filtered, mode, state.favorites);
  if (!groups.some(g => g.items.length)) {
    tree.innerHTML = '<div class="dir">Nenhum resultado</div>';
    return;
  }

  // 3) desenhar
  for (const g of groups) {
    if (!g.items.length) continue;
    const headless = (mode === 'flat' && !g.system && !g.favorites); // lista plana não tem cabeçalho (favoritos e sistema têm)
    let collapsed = false;
    if (!headless) {
      collapsed = state.collapsed.has(g.key);
      const head = document.createElement('div');
      head.className = 'group-head' + (collapsed ? ' collapsed' : '');
      head.innerHTML = `<span class="caret">${collapsed ? '▸' : '▾'}</span>` +
        `<span class="g-label"></span><span class="g-count">${g.items.length}</span>`;
      head.querySelector('.g-label').textContent = g.label;
      head.addEventListener('click', () => toggleGroup(g.key));
      head.addEventListener('dragover', (e) => { if (isValidDropTarget(g, draggedRel)) { e.preventDefault(); head.classList.add('drag-over'); } });
      head.addEventListener('dragleave', () => head.classList.remove('drag-over'));
      head.addEventListener('drop', (e) => { e.preventDefault(); head.classList.remove('drag-over'); const rel = draggedRel; draggedRel = null; handleDropOnGroup(rel, g); });
      tree.appendChild(head);
      if (collapsed) continue;
    }
    for (const it of g.items) {
      const node = document.createElement('div');
      node.className = 'node' + (it.reserved ? ' reserved' : '') + (it.relPath === state.current ? ' active' : '');
      node.dataset.rel = it.relPath;
      const showBadge = it.type && mode !== 'type'; // no modo Tipo o badge é redundante
      const isFav = !it.reserved && state.favorites.has(it.relPath);
      node.innerHTML = `<span class="ic">${it.reserved ? '◷' : '📄'}</span><span class="ttl"></span>` +
        (showBadge ? `<span class="badge"></span>` : '') +
        (isFav ? `<span class="fav-mark" title="Favorito">★</span>` : '');
      node.querySelector('.ttl').textContent = it.title;
      if (showBadge) node.querySelector('.badge').textContent = it.type;
      node.addEventListener('click', () => openDoc(it.relPath));
      if (!it.reserved) node.addEventListener('contextmenu', (e) => { e.preventDefault(); openTreeMenu(e, it.relPath); });
      if (!it.reserved) {
        node.setAttribute('draggable', 'true');
        node.addEventListener('dragstart', (e) => {
          draggedRel = it.relPath;
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.relPath); } catch (_) {} }
        });
        node.addEventListener('dragend', () => { draggedRel = null; });
      }
      tree.appendChild(node);
    }
  }
}

function buildTypeFilter() {
  const sel = $('type-filter');
  const types = new Set();
  for (const d of state.docs) {
    if (d.reserved) continue;
    const t = parsedOf(d).frontmatter.type;
    if (t) types.add(t);
  }
  sel.innerHTML = '<option value="">Todos os tipos</option>' +
    [...types].sort().map(t => `<option>${escapeHtml(t)}</option>`).join('');
}

// Popula o <datalist id="type-options"> com os tipos existentes (rótulos canônicos).
function refreshTypeDatalist() {
  const dl = $('type-options');
  if (!dl) return;
  const labels = [...OKF.auto.typeLabelLookup(state.docs).values()].sort((a, b) => a.localeCompare(b));
  dl.innerHTML = labels.map(t => `<option value="${escapeAttr(t)}"></option>`).join('');
}

/* ---------- Menu de contexto da árvore ---------- */
let treeMenuRel = null;
let draggedRel = null; // relPath do conceito sendo arrastado
function openTreeMenu(e, rel) {
  treeMenuRel = rel;
  const favBtn = $('tree-menu').querySelector('button[data-act="favorite"]');
  if (favBtn) favBtn.textContent = state.favorites.has(rel) ? '☆ Remover dos favoritos' : '★ Favoritar';
  const m = $('tree-menu');
  m.style.left = e.clientX + 'px';
  m.style.top = e.clientY + 'px';
  m.classList.remove('hidden');
}
function closeTreeMenu() { $('tree-menu').classList.add('hidden'); treeMenuRel = null; }

/* ---------- View states ---------- */
function showEmpty(){ $('empty').classList.remove('hidden'); $('viewer').classList.add('hidden'); $('recent-list').classList.add('hidden'); }
function showViewer(){ $('empty').classList.add('hidden'); $('viewer').classList.remove('hidden'); }
function closeOverlays(){ $('graph-view').classList.add('hidden'); $('validate-view').classList.add('hidden'); $('manual-view').classList.add('hidden'); $('git-view').classList.add('hidden'); }

/* ---------- Painel Git ---------- */
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

/* ---------- Manual ---------- */
let manualRendered = false;
function showManual() {
  closeOverlays();
  if (!manualRendered) {
    const body = $('manual-body');
    body.innerHTML = marked.parse($('manual-md').textContent || '');
    // Links externos abrem no navegador.
    body.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (OKF.isExternal(href)) {
        a.addEventListener('click', e => { e.preventDefault(); window.okf.openExternal(href); });
      } else {
        a.addEventListener('click', e => e.preventDefault());
      }
    });
    // Índice navegável a partir dos cabeçalhos de seção (H2).
    const hs = [...body.querySelectorAll('h2')];
    hs.forEach((h, i) => { h.id = 'man-sec-' + i; });
    $('manual-toc').innerHTML = '<div class="toc-title">Conteúdo</div>' +
      hs.map((h, i) => `<a href="#" data-i="${i}">${escapeHtml(h.textContent)}</a>`).join('');
    $('manual-toc').querySelectorAll('a[data-i]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); hs[+a.dataset.i].scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    manualRendered = true;
  }
  $('manual-view').classList.remove('hidden');
  $('manual-body').scrollTop = 0;
}

/* ---------- Open / render doc ---------- */
function openDoc(relPath) {
  if (state.editing && window.OKFEditor) { window.OKFEditor.destroy(); state.editing = false; }
  $('disk-banner').classList.add('hidden');
  const doc = state.docs.find(d => d.relPath === relPath);
  if (!doc) return;
  state.current = relPath;
  state.editing = false;
  closeOverlays();
  showViewer();
  [...document.querySelectorAll('.tree .node')].forEach(n =>
    n.classList.toggle('active', n.dataset.rel === relPath));
  renderConcept(doc);
}

function renderConcept(doc) {
  $('xlink-badge').classList.add('hidden'); $('xlink-panel').classList.add('hidden');
  $('render-mode').classList.remove('hidden');
  $('edit-mode').classList.add('hidden');
  $('btn-edit').classList.remove('hidden');
  $('btn-save').classList.add('hidden');
  $('btn-cancel').classList.add('hidden');
  $('btn-delete').classList.toggle('hidden', doc.reserved);
  $('btn-rename').classList.toggle('hidden', doc.reserved);

  const p = parsedOf(doc);
  const id = OKF.conceptId(doc.relPath);
  $('crumbs').innerHTML = doc.relPath.split('/').map((s,i,a)=>
    i===a.length-1 ? `<b>${escapeHtml(s)}</b>` : escapeHtml(s)).join(' / ');

  // frontmatter card (hidden for reserved files)
  const fm = $('fm-card');
  if (doc.reserved) {
    fm.classList.add('hidden');
  } else {
    fm.classList.remove('hidden');
    const f = p.frontmatter;
    const tags = Array.isArray(f.tags) ? f.tags : (f.tags ? [f.tags] : []);
    const known = ['type','title','description','resource','tags','timestamp'];
    const extra = Object.keys(f).filter(k => !known.includes(k));
    fm.innerHTML =
      `<span class="type-pill">${escapeHtml(f.type || 'Sem tipo')}</span>` +
      `<h1>${escapeHtml(f.title || doc.name.replace(/\.md$/i,''))}</h1>` +
      (f.description ? `<div class="desc">${escapeHtml(f.description)}</div>` : '') +
      (tags.length ? `<div class="fm-row">${tags.map(t=>`<span class="tag">${escapeHtml(String(t))}</span>`).join('')}</div>` : '') +
      (f.resource ? `<div class="fm-row"><span class="k">resource:</span> <a href="#" data-ext="${escapeAttr(f.resource)}">${escapeHtml(f.resource)}</a></div>` : '') +
      (f.timestamp ? `<div class="fm-row"><span class="k">timestamp:</span> ${escapeHtml(fmtTimestamp(f.timestamp))}</div>` : '') +
      (extra.length ? `<div class="fm-row">${extra.map(k=>`<span class="k">${escapeHtml(k)}:</span> ${escapeHtml(String(f[k]))}`).join('&nbsp;&nbsp;')}</div>` : '');
    fm.querySelectorAll('a[data-ext]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); window.okf.openExternal(a.dataset.ext); }));
  }

  // body
  const bodyEl = $('md-body');
  bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(p.body || ''));
  rewireLinks(bodyEl, doc.relPath);

  // backlinks
  const bl = $('backlinks');
  const refs = (state.graph.backlinks[id] || []);
  if (refs.length && !doc.reserved) {
    bl.classList.remove('hidden');
    bl.innerHTML = '<h3>Citado por</h3>' + refs.map(r => {
      const rd = state.byId.get(r);
      const t = rd ? (OKF.parse(rd.content).frontmatter.title || r) : r;
      return `<a href="#" data-rel="${escapeAttr(rd ? rd.relPath : '')}">${escapeHtml(t)}</a>`;
    }).join('');
    bl.querySelectorAll('a[data-rel]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); if(a.dataset.rel) openDoc(a.dataset.rel); }));
  } else {
    bl.classList.add('hidden');
  }
}

// Rewire internal links to navigate inside the app; external open in browser; mark broken.
function rewireLinks(container, srcRel) {
  container.querySelectorAll('a').forEach(a => {
    const target = a.getAttribute('href') || '';
    if (OKF.isExternal(target)) {
      a.addEventListener('click', e => { e.preventDefault(); window.okf.openExternal(target); });
      return;
    }
    if (target.startsWith('#')) return;
    const tgt = OKF.resolveTarget(target, srcRel);
    const doc = tgt ? state.byId.get(tgt) : null;
    if (doc) {
      a.addEventListener('click', e => { e.preventDefault(); openDoc(doc.relPath); });
    } else {
      a.classList.add('broken');
      a.title = 'Conceito inexistente na biblioteca';
      a.addEventListener('click', e => e.preventDefault());
    }
  });
}

/* ---------- Sugestão de cross-links ---------- */
function currentConceptsForLinks() {
  return state.docs.filter(d => !d.reserved && d.relPath !== state.current)
    .map(d => ({ relPath: d.relPath, title: parsedOf(d).frontmatter.title || baseNameOf(d.relPath).replace(/\.md$/i, '') }));
}
function refreshLinkSuggestions() {
  if (!state.editing || !state.current) { $('xlink-badge').classList.add('hidden'); $('xlink-panel').classList.add('hidden'); return; }
  const body = (state.editorMode === 'source' || (docByRel(state.current) || {}).reserved)
    ? $('e-body').value
    : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const sugg = OKF.auto.suggestLinks(body || '', currentConceptsForLinks(), OKF.conceptId(state.current));
  state.linkSuggestions = sugg;
  const badge = $('xlink-badge');
  if (sugg.length) { badge.textContent = '🔗 ' + sugg.length + ' sugestão(ões) de links'; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); $('xlink-panel').classList.add('hidden'); }
}
function openLinkPanel() {
  const sugg = state.linkSuggestions || [];
  const list = $('xlink-list');
  list.innerHTML = sugg.map((s, i) =>
    `<div class="xlink-item" data-i="${i}"><code>${escapeHtml(s.text)}</code> → <span>${escapeHtml(s.targetRel)}</span>` +
    `<span class="grow"></span><button data-acc="${i}">Aceitar</button><button data-dis="${i}">Dispensar</button></div>`).join('') ||
    '<div class="muted">Nenhuma sugestão.</div>';
  list.querySelectorAll('button[data-acc]').forEach(b => b.onclick = () => acceptSuggestion(+b.dataset.acc));
  list.querySelectorAll('button[data-dis]').forEach(b => b.onclick = () => dismissSuggestion(+b.dataset.dis));
  $('xlink-panel').classList.remove('hidden');
}
async function applyBodyEdit(newBody) {
  state.editorBody = newBody;
  if (state.editorMode === 'source' || (docByRel(state.current) || {}).reserved) {
    $('e-body').value = newBody;
  } else if (window.OKFEditor) {
    await window.OKFEditor.destroy();
    await window.OKFEditor.create($('milkdown'), newBody, { onChange: (md) => { state.editorBody = md; } });
  }
}
async function acceptSuggestion(i) {
  const sugg = state.linkSuggestions || [];
  if (!sugg[i]) return;
  const body = state.editorMode === 'source' ? $('e-body').value : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const newBody = OKF.auto.applySuggestions(body, [sugg[i]]);
  await applyBodyEdit(newBody);
  refreshLinkSuggestions();
  if ((state.linkSuggestions || []).length) openLinkPanel(); else $('xlink-panel').classList.add('hidden');
}
function dismissSuggestion(i) {
  state.linkSuggestions = (state.linkSuggestions || []).filter((_, j) => j !== i);
  if (state.linkSuggestions.length) openLinkPanel(); else $('xlink-panel').classList.add('hidden');
  $('xlink-badge').textContent = '🔗 ' + state.linkSuggestions.length + ' sugestão(ões) de links';
  if (!state.linkSuggestions.length) $('xlink-badge').classList.add('hidden');
}
async function acceptAllSuggestions() {
  const sugg = state.linkSuggestions || [];
  if (!sugg.length) return;
  const body = state.editorMode === 'source' ? $('e-body').value : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const newBody = OKF.auto.applySuggestions(body, sugg);
  await applyBodyEdit(newBody);
  refreshLinkSuggestions();
}

/* ---------- Edit ---------- */
async function enterEdit() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc) return;
  state.editing = true;
  $('render-mode').classList.add('hidden');
  $('edit-mode').classList.remove('hidden');
  $('btn-edit').classList.add('hidden');
  $('btn-save').classList.remove('hidden');
  $('btn-cancel').classList.remove('hidden');
  $('btn-rename').classList.add('hidden');

  const p = OKF.parse(doc.content);
  const f = p.frontmatter;
  const reserved = doc.reserved;
  $('edit-mode').querySelector('.edit-grid').style.display = reserved ? 'none' : '';
  $('extra-fm').style.display = reserved ? 'none' : '';

  if (reserved) {
    // Reservados: só modo Código (conteúdo bruto completo), barra do editor oculta.
    $('editor-toolbar').classList.add('hidden');
    $('milkdown').classList.add('hidden');
    $('e-body').classList.remove('hidden');
    $('e-body').value = doc.content;
    return;
  }

  $('editor-toolbar').classList.remove('hidden');
  refreshTypeDatalist(); // popula o datalist com os tipos existentes (como em openModal)
  $('e-type').value = f.type || '';
  $('e-title').value = f.title || '';
  $('e-description').value = f.description || '';
  $('e-resource').value = f.resource || '';
  $('e-tags').value = Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '');
  $('e-timestamp').value = f.timestamp ? fmtTimestamp(f.timestamp) : '';
  const known = ['type','title','description','resource','tags','timestamp'];
  const extra = {};
  Object.keys(f).forEach(k => { if (!known.includes(k)) extra[k] = f[k]; });
  $('e-extra').value = Object.keys(extra).length ? jsyaml.dump(extra).replace(/\n$/,'') : '';

  // Inicia em modo Visual com o corpo do conceito.
  state.editorBody = p.body || '';
  if (!window.OKFEditor) {
    // Bundle do editor indisponível — degrada para o modo Código (textarea).
    toast('Editor visual indisponível; usando modo Código.', 'bad');
    state.editorMode = 'source';
    $('milkdown').classList.add('hidden');
    $('e-body').value = state.editorBody;
    $('e-body').classList.remove('hidden');
    setModeButtons('source');
    return;
  }
  state.editorMode = 'visual';
  $('e-body').classList.add('hidden');
  $('milkdown').classList.remove('hidden');
  setModeButtons('visual');
  await window.OKFEditor.create($('milkdown'), state.editorBody, {
    onChange: (md) => { state.editorBody = md; }
  });
  setTimeout(refreshLinkSuggestions, 0);
}

function setModeButtons(mode) {
  $('mode-visual').classList.toggle('on', mode === 'visual');
  $('mode-source').classList.toggle('on', mode === 'source');
}

function openConceptPicker() {
  if (state.editorMode !== 'visual') { toast('Disponível no modo Visual.', 'bad'); return; }
  $('cm-search').value = '';
  renderConceptList('');
  $('concept-modal').classList.remove('hidden');
  $('cm-search').focus();
}
function closeConceptPicker(){ $('concept-modal').classList.add('hidden'); }

function renderConceptList(q) {
  const ql = (q || '').toLowerCase().trim();
  const list = $('cm-list');
  const items = state.docs
    .filter(d => !d.reserved && d.relPath !== state.current)
    .map(d => {
      const f = parsedOf(d).frontmatter;
      return { relPath: d.relPath, title: f.title || d.name.replace(/\.md$/i,'') };
    })
    .filter(it => !ql || it.title.toLowerCase().includes(ql) || it.relPath.toLowerCase().includes(ql))
    .sort((a,b) => a.title.localeCompare(b.title));
  if (!items.length) { list.innerHTML = '<div class="cm-empty">Nenhum conceito encontrado.</div>'; return; }
  list.innerHTML = items.map(it =>
    `<div class="cm-item" data-rel="${escapeAttr(it.relPath)}" data-title="${escapeAttr(it.title)}">
       <div class="cm-title">${escapeHtml(it.title)}</div>
       <div class="cm-path">/${escapeHtml(it.relPath)}</div>
     </div>`).join('');
  list.querySelectorAll('.cm-item').forEach(el => el.addEventListener('click', () => {
    window.OKFEditor.insertConceptLink('/' + el.dataset.rel, el.dataset.title);
    closeConceptPicker();
    window.OKFEditor.focus();
  }));
}

function runToolbar(cmd) {
  if (state.editorMode !== 'visual' || !window.OKFEditor) return;
  if (cmd === 'taskList') { window.OKFEditor.taskList(); window.OKFEditor.focus(); return; }
  if (cmd === 'link') {
    const href = window.prompt('URL do link:');
    if (href) window.OKFEditor.link(href);
    window.OKFEditor.focus(); return;
  }
  if (cmd === 'image') {
    const src = window.prompt('URL da imagem:');
    if (src) window.OKFEditor.image(src);
    window.OKFEditor.focus(); return;
  }
  window.OKFEditor.runCommand(cmd);
  window.OKFEditor.focus();
}

async function setEditorMode(mode) {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc || doc.reserved || mode === state.editorMode) return;
  if (mode === 'visual' && !window.OKFEditor) { toast('Editor visual indisponível.', 'bad'); return; }
  if (mode === 'source') {
    state.editorBody = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    $('milkdown').classList.add('hidden');
    $('e-body').value = state.editorBody;
    $('e-body').classList.remove('hidden');
  } else {
    state.editorBody = $('e-body').value;
    $('e-body').classList.add('hidden');
    $('milkdown').classList.remove('hidden');
    await window.OKFEditor.create($('milkdown'), state.editorBody, {
      onChange: (md) => { state.editorBody = md; }
    });
  }
  state.editorMode = mode;
  setModeButtons(mode);
  setTimeout(refreshLinkSuggestions, 0);
}

function currentBodyMarkdown(doc) {
  if (doc.reserved) return $('e-body').value;
  if (state.editorMode === 'source') return $('e-body').value;
  return window.OKFEditor.getMarkdown();
}

async function cancelEdit() {
  state.editing = false;
  const doc = state.docs.find(d => d.relPath === state.current);
  if (window.OKFEditor) { await window.OKFEditor.destroy(); }
  if (doc) renderConcept(doc); else showEmpty();
}

async function saveEdit() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc) return;
  let content;
  if (doc.reserved) {
    content = currentBodyMarkdown(doc);
  } else {
    const type = $('e-type').value.trim();
    if (!type) { toast('O campo "type" é obrigatório (OKF v0.1).', 'bad'); return; }
    const fm = { type };
    if ($('e-title').value.trim()) fm.title = $('e-title').value.trim();
    if ($('e-description').value.trim()) fm.description = $('e-description').value.trim();
    if ($('e-resource').value.trim()) fm.resource = $('e-resource').value.trim();
    const tags = OKF.auto.parseTags($('e-tags').value);
    if (tags.length) fm.tags = tags;
    if ($('e-timestamp').value.trim()) fm.timestamp = $('e-timestamp').value.trim();
    const extraRaw = $('e-extra').value.trim();
    if (extraRaw) {
      try {
        const ex = jsyaml.load(extraRaw);
        if (ex && typeof ex === 'object') Object.assign(fm, ex);
      } catch (e) { toast('YAML inválido nos campos extras: ' + e.message, 'bad'); return; }
    }
    content = OKF.serialize(fm, currentBodyMarkdown(doc));
  }
  try {
    if (doc.reserved || !autoIndexEnabled()) {
      await window.okf.writeFile({ root: state.root, relPath: doc.relPath, content });
      doc.content = content;
      indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
      state.editing = false;
      if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      renderConcept(doc);
      toast('Salvo em ' + doc.relPath, 'good');
      return;
    }
    const before = OKF.parse(doc.content).frontmatter;
    const after = OKF.parse(content).frontmatter;
    // Troca de tipo que muda a pasta = mover o conceito para a pasta do novo tipo.
    const folderChanged = !doc.reserved &&
      OKF.auto.folderForType(before.type || '') !== OKF.auto.folderForType(after.type || '');
    if (folderChanged) {
      doc.content = content; // o arquivo movido carrega o frontmatter novo
      if (state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      state.editing = false;
      const dest = await changeConceptType(doc.relPath, after.type || '', content);
      if (dest) toast('Tipo alterado; movido para ' + dest, 'good');
      return;
    }
    const metaChanged = (before.title || '') !== (after.title || '') ||
                        (before.description || '') !== (after.description || '') ||
                        (before.type || '') !== (after.type || '');
    const nextDocs = state.docs.map(d => d.relPath === doc.relPath ? { ...d, content } : d);
    const ops = [{ op: 'write', relPath: doc.relPath, content }];
    if (metaChanged) ops.push(...indexOpsFrom(nextDocs)); // sem log: edição não é estrutural
    if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
    state.editing = false;
    const ok = await applyOpsAndRefresh(ops, doc.relPath);
    if (ok) toast('Salvo em ' + doc.relPath, 'good');
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'bad');
  }
}

// Troca o tipo de um conceito movendo o arquivo para a pasta do novo tipo.
// `content` é o conteúdo já com o frontmatter do novo tipo. Retorna o destino
// (relPath) em sucesso, ou null em falha. Reusa performMove.
async function changeConceptType(rel, newType, content) {
  let dest = OKF.auto.moveTargetForType(rel, newType || '');
  let k = 2;
  while (docByRel(dest) && dest !== rel) {
    dest = OKF.auto.folderForType(newType || '') + '/' +
           baseNameOf(rel).replace(/\.md$/i, '') + '-' + (k++) + '.md';
  }
  const titleMv = OKF.parse(content).frontmatter.title || baseNameOf(dest).replace(/\.md$/i, '');
  const logEntry = autoIndexEnabled()
    ? '**Troca de tipo**: `' + rel + '` → [' + titleMv + '](/' + dest + ') (Tipo: ' + (newType || '') + ').'
    : null;
  const ok = await performMove(rel, dest, logEntry, content);
  return ok ? dest : null;
}

/* ---------- Mover (núcleo compartilhado) ---------- */
// Move fromRel -> toRel: reescreve links, regenera índices e (opcional) loga.
// movedContentOverride: conteúdo já editado do arquivo movido (ex.: troca de tipo).
async function performMove(fromRel, toRel, logEntry, movedContentOverride) {
  if (!docByRel(fromRel)) return false;
  const changes = OKF.auto.rewriteRenameLinks(state.docs, fromRel, toRel);
  const movedChange = changes.find(c => c.relPath === fromRel);
  const movedContent = movedContentOverride != null ? movedContentOverride
    : (movedChange ? movedChange.newContent : docByRel(fromRel).content);
  let nextDocs = state.docs.filter(d => d.relPath !== fromRel).map(d => {
    const c = changes.find(x => x.relPath === d.relPath);
    return c ? { ...d, content: c.newContent } : d;
  });
  nextDocs.push({ relPath: toRel, name: baseNameOf(toRel), reserved: OKF.isReserved(toRel), content: movedContent });
  const ops = [{ op: 'create', relPath: toRel, content: movedContent }, { op: 'delete', relPath: fromRel }];
  for (const c of changes) {
    if (c.relPath === fromRel) continue;
    const isIndex = c.relPath.split('/').pop().toLowerCase() === 'index.md';
    if (isIndex && autoIndexEnabled()) continue; // indexOpsFrom regenera estes
    ops.push({ op: 'write', relPath: c.relPath, content: c.newContent });
  }
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    if (logEntry) ops.push(logOpFrom(nextDocs, logEntry));
  }
  const movedOk = await applyOpsAndRefresh(ops, toRel);
  if (movedOk && state.favorites.has(fromRel)) {
    state.favorites.delete(fromRel); state.favorites.add(toRel); saveFavorites(); renderTree();
  }
  return movedOk;
}

/* ---------- Renomear / Mover ---------- */
let renameFrom = null;
function openRename(rel) {
  rel = rel || state.current;
  const doc = rel && docByRel(rel);
  if (!doc || doc.reserved) { toast('Selecione um conceito (não reservado).', 'bad'); return; }
  renameFrom = rel;
  $('rn-path').value = rel;
  $('rn-hint').textContent = 'Atual: ' + rel + ' — os links que apontam para este conceito serão atualizados.';
  $('rename-modal').classList.remove('hidden');
  $('rn-path').focus();
}
function closeRename() { $('rename-modal').classList.add('hidden'); renameFrom = null; }

async function doRename() {
  const fromRel = renameFrom;
  let toRel = $('rn-path').value.trim().replace(/^\/+/, '');
  if (!fromRel) return;
  if (!toRel) { toast('Informe o novo caminho.', 'bad'); return; }
  if (!toRel.toLowerCase().endsWith('.md')) toRel += '.md';
  if (toRel === fromRel) { closeRename(); return; }
  if (docByRel(toRel)) { toast('Já existe um conceito em ' + toRel, 'bad'); return; }

  const sameDir = (fromRel.includes('/') ? fromRel.replace(/\/[^/]*$/, '') : '') ===
                  (toRel.includes('/') ? toRel.replace(/\/[^/]*$/, '') : '');
  const movedContent = docByRel(fromRel).content;
  const title = OKF.parse(movedContent).frontmatter.title || baseNameOf(toRel).replace(/\.md$/i, '');
  const verbo = sameDir ? 'Renomeação' : 'Movimentação';
  const logEntry = autoIndexEnabled()
    ? '**' + verbo + '**: `' + fromRel + '` → [' + title + '](/' + toRel + ').' : null;
  closeRename();
  const ok = await performMove(fromRel, toRel, logEntry);
  if (ok) toast('Movido para ' + toRel, 'good');
}

/* ---------- Reorganizar por tipo (migração legada, opcional) ---------- */
function openReorg() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  const plan = OKF.auto.planReorg(state.docs);
  const hint = $('reorg-hint'); const list = $('reorg-list');
  if (!plan.length) {
    hint.textContent = 'Tudo já está organizado por tipo. Nada a mover.';
    list.innerHTML = ''; $('reorg-ok').disabled = true;
  } else {
    hint.textContent = plan.length + ' conceito(s) serão movidos para a pasta do seu tipo:';
    list.innerHTML = plan.map(p =>
      `<div class="reorg-row"><code>${escapeHtml(p.from)}</code> → <code>${escapeHtml(p.to)}</code></div>`).join('');
    $('reorg-ok').disabled = false;
  }
  $('reorg-modal').classList.remove('hidden');
}
function closeReorg() { $('reorg-modal').classList.add('hidden'); }
async function applyReorg() {
  const plan = OKF.auto.planReorg(state.docs);
  closeReorg();
  if (!plan.length) return;
  let okCount = 0;
  for (const p of plan) {
    const logEntry = autoIndexEnabled()
      ? '**Reorganização por tipo**: `' + p.from + '` → [' + p.title + '](/' + p.to + ').' : null;
    const ok = await performMove(p.from, p.to, logEntry);
    if (ok) okCount++;
  }
  toast('Reorganização concluída: ' + okCount + '/' + plan.length, 'good');
}

/* ---------- Delete ---------- */
async function deleteCurrent() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc || doc.reserved) return;
  const ok = await window.okf.confirm({ message: 'Excluir este conceito?', detail: doc.relPath });
  if (!ok) return;
  const title = OKF.parse(doc.content).frontmatter.title || baseNameOf(doc.relPath).replace(/\.md$/i, '');
  const nextDocs = state.docs.filter(d => d.relPath !== doc.relPath);
  const ops = [{ op: 'delete', relPath: doc.relPath }];
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    ops.push(logOpFrom(nextDocs, '**Exclusão**: removido `' + doc.relPath + '` (' + title + ').'));
  }
  const done = await applyOpsAndRefresh(ops, null);
  if (done) toast('Conceito excluído', 'good');
}

/* ---------- New concept modal ---------- */
/* ---------- Paleta de comandos (Ctrl+P) ---------- */
let paletteItems = [], paletteSel = 0;
function paletteActions() {
  const lib = !!state.root;
  return [
    { label: 'Novo conceito', run: openModal, needsLib: true },
    { label: 'Grafo de relacionamentos', run: showGraph, needsLib: true },
    { label: 'Validar conformidade', run: showValidation, needsLib: true },
    { label: 'Painel Git', run: showGit, needsLib: true },
    { label: 'Claude Code (terminal)', run: openClaude, needsLib: true },
    { label: 'Recarregar biblioteca', run: reload, needsLib: true },
    { label: 'Reconstruir índices', run: rebuildIndexes, needsLib: true },
    { label: 'Reorganizar por tipo (mover para a pasta do tipo)', run: openReorg, needsLib: true },
    { label: 'Gerenciar modelos', run: openTemplates, needsLib: false },
    { label: autoIndexEnabled() ? 'Índices automáticos: DESLIGAR' : 'Índices automáticos: LIGAR',
      run: () => { setAutoIndex(!autoIndexEnabled()); toast('Índices automáticos: ' + (autoIndexEnabled() ? 'ligados' : 'desligados'), 'good'); }, needsLib: false },
    { label: 'Manual do OKF Studio', run: showManual, needsLib: false },
    { label: 'Alternar tema claro/escuro', run: toggleTheme, needsLib: false },
    { label: 'Abrir biblioteca…', run: openFolder, needsLib: false },
    { label: 'Carregar biblioteca de exemplo', run: openSample, needsLib: false },
    { label: 'Trocar biblioteca…', run: switchLibrary, needsLib: false },
    { label: 'Nova biblioteca…', run: newLibrary, needsLib: false },
    { label: 'Exportar conceito como PDF', run: () => window.OKFConvertUI.exportCurrentPdf(), needsLib: true },
    { label: 'Importar documento (PDF/DOCX/HTML/TXT)', run: () => window.OKFConvertUI.importDocument(), needsLib: true },
  ].filter(a => !a.needsLib || lib).map(a => ({ kind: 'ação', label: a.label, sub: '', run: a.run }));
}
function paletteConcepts() {
  if (!state.root) return [];
  return state.docs.filter(d => !d.reserved).map(d => {
    const f = parsedOf(d).frontmatter;
    return { kind: 'conceito', label: f.title || d.name.replace(/\.md$/i, ''), sub: d.relPath, run: () => openDoc(d.relPath) };
  });
}
function openPalette() {
  $('palette-input').value = '';
  renderPalette('');
  $('palette').classList.remove('hidden');
  $('palette-input').focus();
}
function closePalette() { $('palette').classList.add('hidden'); }
function renderPalette(q) {
  const ql = (q || '').toLowerCase().trim();
  const all = paletteActions().concat(paletteConcepts());
  paletteItems = all.filter(it => !ql || it.label.toLowerCase().includes(ql) || (it.sub && it.sub.toLowerCase().includes(ql)));
  paletteSel = 0;
  const list = $('palette-list');
  if (!paletteItems.length) { list.innerHTML = '<div class="pal-empty">Nada encontrado.</div>'; return; }
  list.innerHTML = paletteItems.map((it, i) =>
    `<div class="pal-item${i === 0 ? ' sel' : ''}" data-i="${i}">` +
    `<span class="pal-kind">${it.kind}</span><span class="pal-label">${escapeHtml(it.label)}</span>` +
    (it.sub ? `<span class="pal-sub">${escapeHtml(it.sub)}</span>` : '') + `</div>`).join('');
  list.querySelectorAll('.pal-item').forEach(el => el.addEventListener('click', () => activatePalette(+el.dataset.i)));
}
function movePalette(delta) {
  if (!paletteItems.length) return;
  paletteSel = (paletteSel + delta + paletteItems.length) % paletteItems.length;
  const els = $('palette-list').querySelectorAll('.pal-item');
  els.forEach((el, i) => el.classList.toggle('sel', i === paletteSel));
  if (els[paletteSel]) els[paletteSel].scrollIntoView({ block: 'nearest' });
}
function activatePalette(i) {
  const it = paletteItems[typeof i === 'number' ? i : paletteSel];
  if (!it) return;
  closePalette();
  it.run();
}

function openModal() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  ['m-type', 'm-title', 'm-description', 'm-tags'].forEach(id => $(id).value = '');
  const tplSel = $('m-template');
  tplSel.innerHTML = state.templates.map(t => `<option>${escapeHtml(t.name)}</option>`).join('');
  tplSel.value = state.templates.some(t => t.name === 'Em branco') ? 'Em branco'
    : (state.templates[0] ? state.templates[0].name : '');
  applyTemplateToForm(tplSel.value);
  refreshTypeDatalist();
  $('modal').classList.remove('hidden');
  $('m-type').focus();
}
function closeModal(){ $('modal').classList.add('hidden'); }
async function createConcept() {
  const typeRaw = $('m-type').value.trim();
  if (!typeRaw) { toast('O campo "type" é obrigatório.', 'bad'); return; }
  const type = OKF.auto.canonicalType(typeRaw, state.docs);
  const title = $('m-title').value.trim();
  if (!title) { toast('Informe o título.', 'bad'); return; }
  const taken = new Set(state.docs.map(d => d.relPath));
  const rel = OKF.auto.pathForConcept(type, title, taken);
  if (docByRel(rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }
  const fm = { type, title };
  if ($('m-description').value.trim()) fm.description = $('m-description').value.trim();
  const tags = OKF.auto.parseTags($('m-tags').value);
  if (tags.length) fm.tags = tags;
  fm.timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const tpl = state.templates.find(t => t.name === $('m-template').value);
  const body = tpl ? tpl.body.replace(/^\n+/, '') : '';
  const content = OKF.serialize(fm, '# ' + title + '\n\n' + body);

  const newDoc = { relPath: rel, name: baseNameOf(rel), reserved: OKF.isReserved(rel), content };
  const nextDocs = state.docs.concat([newDoc]);
  const ops = [{ op: 'create', relPath: rel, content }];
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    const desc = fm.description ? ' - ' + fm.description : '';
    ops.push(logOpFrom(nextDocs, '**Criação**: [' + title + '](/' + rel + ')' + desc));
  }
  closeModal();
  const ok = await applyOpsAndRefresh(ops, rel);
  if (ok) toast('Conceito criado: ' + rel, 'good');
}

/* ---------- Reconstruir índices ---------- */
async function rebuildIndexes() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  const ops = indexOpsFrom(state.docs);
  if (!ops.length) { toast('Índices já estão atualizados.', 'good'); return; }
  const ok = await window.okf.confirm({
    message: 'Reconstruir índices?',
    detail: ops.length + ' arquivo(s) index.md serão (re)escritos. A prosa fora dos blocos gerenciados é preservada.'
  });
  if (!ok) return;
  const done = await applyOpsAndRefresh(ops, state.current);
  if (done) toast('Índices reconstruídos (' + ops.length + ' arquivo(s)).', 'good');
}

/* ---------- Diálogo de Modelos ---------- */
let tplSelected = null; // nome do modelo carregado no formulário (null = novo)
async function openTemplates() {
  await loadTemplates();
  clearTplForm();
  try { $('tpl-dir').textContent = 'Pasta: ' + await window.okf.templates.dir(); } catch (e) {}
  $('templates-modal').classList.remove('hidden');
  $('tpl-name').focus();
}
function closeTemplates() { $('templates-modal').classList.add('hidden'); }
function renderTplList() {
  const list = $('tpl-list');
  list.innerHTML = state.templates.map(t =>
    `<div class="tpl-item${t.name === tplSelected ? ' sel' : ''}" data-name="${escapeAttr(t.name)}">${escapeHtml(t.name)}</div>`
  ).join('') || '<div class="tpl-item">Nenhum modelo.</div>';
  list.querySelectorAll('.tpl-item[data-name]').forEach(el =>
    el.addEventListener('click', () => loadTplToForm(el.dataset.name)));
}
function clearTplForm() {
  tplSelected = null;
  ['tpl-name', 'tpl-type', 'tpl-description', 'tpl-tags', 'tpl-body'].forEach(id => $(id).value = '');
  renderTplList();
  $('tpl-name').focus();
}
function loadTplToForm(name) {
  const t = state.templates.find(x => x.name === name);
  if (!t) return;
  tplSelected = name;
  $('tpl-name').value = t.name;
  $('tpl-type').value = t.type || '';
  $('tpl-description').value = t.description || '';
  $('tpl-tags').value = (t.tags || []).join(', ');
  $('tpl-body').value = t.body || '';
  renderTplList();
}
function refreshTemplateSelect() {
  if ($('modal').classList.contains('hidden')) return;
  const tplSel = $('m-template');
  const cur = tplSel.value;
  tplSel.innerHTML = state.templates.map(t => `<option>${escapeHtml(t.name)}</option>`).join('');
  if (state.templates.some(t => t.name === cur)) tplSel.value = cur;
  else tplSel.value = state.templates.some(t => t.name === 'Em branco') ? 'Em branco'
    : (state.templates[0] ? state.templates[0].name : '');
}
async function saveTpl() {
  const name = $('tpl-name').value.trim();
  if (!name) { toast('Informe o nome do modelo.', 'bad'); return; }
  if (/[\/\\:*?"<>|]/.test(name)) { toast('Nome inválido (não use / \\ : * ? " < > |).', 'bad'); return; }
  const fm = {};
  const type = $('tpl-type').value.trim(); if (type) fm.type = type;
  const desc = $('tpl-description').value.trim(); if (desc) fm.description = desc;
  const tags = OKF.auto.parseTags($('tpl-tags').value); if (tags.length) fm.tags = tags;
  const content = OKF.serialize(fm, $('tpl-body').value);
  const r = await window.okf.templates.save({ name, content, oldName: tplSelected });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  await loadTemplates();
  tplSelected = name; renderTplList(); refreshTemplateSelect();
  toast('Modelo salvo: ' + name, 'good');
}
async function deleteTpl() {
  if (!tplSelected) { toast('Selecione um modelo na lista.', 'bad'); return; }
  const ok = await window.okf.confirm({ message: 'Excluir o modelo?', detail: tplSelected });
  if (!ok) return;
  const r = await window.okf.templates.remove({ name: tplSelected });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  await loadTemplates(); clearTplForm(); refreshTemplateSelect();
  toast('Modelo excluído', 'good');
}
async function restoreTpl() {
  const r = await window.okf.templates.restoreDefaults();
  if (!r || !r.ok) { toast('Erro ao restaurar padrões.', 'bad'); return; }
  await loadTemplates(); renderTplList(); refreshTemplateSelect();
  toast((r.created || 0) + ' modelo(s) padrão restaurado(s).', 'good');
}

/* ---------- Validation ---------- */
function showValidation() {
  if (!state.root) return;
  closeOverlays();
  const v = OKF.validate(state.docs);
  const el = $('validate-body');
  const conform = v.errors.length === 0;
  el.innerHTML =
    `<div class="v-summary">
      <div class="v-pill"><div class="n">${v.counts.concepts}</div><div class="muted">conceitos</div></div>
      <div class="v-pill ${conform?'good':'bad'}"><div class="n">${v.counts.errors}</div><div class="muted">erros</div></div>
      <div class="v-pill warn"><div class="n">${v.counts.warnings}</div><div class="muted">avisos</div></div>
    </div>
    <div class="v-item ${conform?'okv':'err'}">
      <div class="where">${conform ? '✓ Conforme com OKF v0.1' : '✗ Não conforme'}</div>
      <div class="msg">${conform
        ? 'Todos os conceitos têm frontmatter YAML válido e campo "type".'
        : 'Corrija os erros abaixo para tornar a biblioteca conforme.'}</div>
    </div>` +
    v.errors.map(e => itemHtml(e, 'err')).join('') +
    v.warnings.map(w => itemHtml(w, 'warnv')).join('');
  el.querySelectorAll('.where[data-rel]').forEach(a =>
    a.addEventListener('click', () => openDoc(a.dataset.rel)));
  $('validate-view').classList.remove('hidden');
}
function itemHtml(it, cls) {
  return `<div class="v-item ${cls}">
    <div class="where" data-rel="${escapeAttr(it.where)}">${escapeHtml(it.where)}</div>
    <div class="msg">${escapeHtml(it.msg)}</div></div>`;
}

/* ---------- Graph (AntV G6 v5) ---------- */
const TYPE_COLORS = ['#5b9dff','#7c5cff','#43c08a','#e0a64a','#e06a6a','#4ec9d4','#d98ad9','#9aa0aa'];
let g6graph = null;

function graphThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { text: v('--text'), muted: v('--muted'), line: v('--line'), bg: v('--bg') };
}

async function showGraph() {
  if (!state.root) return;
  closeOverlays();
  $('graph-view').classList.remove('hidden');
  const g = state.graph;
  const types = [...new Set(g.nodes.map(n => n.type))];
  const colorOf = t => TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length];

  // degree (only over existing edges) → drives node size
  const deg = {};
  g.edges.forEach(e => {
    if (e.exists) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; }
  });
  const col = graphThemeColors();

  const data = {
    nodes: g.nodes.map(n => ({
      id: n.id,
      data: { label: n.title, type: n.type, rel: n.relPath, color: colorOf(n.type), deg: deg[n.id] || 0 }
    })),
    edges: g.edges.filter(e => e.exists).map((e, i) => ({ id: 'e' + i, source: e.source, target: e.target }))
  };
  $('graph-stats').textContent = `${data.nodes.length} conceitos · ${data.edges.length} relações`;

  if (g6graph) { g6graph.destroy(); g6graph = null; }
  const host = $('cy');

  g6graph = new G6.Graph({
    container: host,
    autoResize: true,
    autoFit: 'view',
    padding: 40,
    theme: currentTheme() === 'light' ? 'light' : 'dark',
    data,
    node: {
      style: {
        fill: d => d.data.color,
        stroke: d => d.data.color,
        lineWidth: 0,
        size: d => 24 + (d.data.deg || 0) * 6,
        labelText: d => d.data.label,
        labelPlacement: 'bottom',
        labelFill: col.text,
        labelFontSize: 12,
        labelBackground: false
      },
      state: { active: { lineWidth: 3, stroke: col.text } }
    },
    edge: {
      style: { stroke: col.muted || col.line, lineWidth: 1.4, endArrow: true, opacity: 0.55, curveOffset: 18 },
      state: { active: { stroke: col.text, opacity: 1 } }
    },
    // d3-force (pure JS, CSP-safe) com animation:false: calcula as posições já
    // estabilizadas antes do render/fit, evitando aglomeração. collide impede
    // sobreposição. (O smoke test headless usa 'force' à parte.)
    layout: {
      type: 'd3-force', animation: false,
      link: { distance: 140 },
      manyBody: { strength: -500 },
      collide: { radius: 56 },
      x: { strength: 0.06 },
      y: { strength: 0.06 }
    },
    behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element', { type: 'hover-activate', degree: 1 }]
  });
  await g6graph.render();
  // No resize, ajusta o canvas ao container (resize) e re-enquadra (fitView).
  // fitView é async no v5 — trate a rejeição p/ não vazar UnhandledPromiseRejection.
  // (A margem do fit vem do `padding` no nível do Graph; fitView não aceita padding.)
  const refit = () => {
    if (!g6graph || $('graph-view').classList.contains('hidden')) return;
    const host2 = $('cy');
    try { g6graph.resize(host2.clientWidth, host2.clientHeight); } catch (e) {}
    try {
      const r = g6graph.fitView({ when: 'always', direction: 'both' });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {}
  };
  window.__okfRefit = refit;
  refit();
  // Re-enquadra quando o container muda de tamanho (ResizeObserver dispara já com
  // o #cy no tamanho novo, evitando a corrida com o autoResize do G6).
  if (!window.__okfGraphRO) {
    let rt;
    window.__okfGraphRO = new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (window.__okfRefit) window.__okfRefit(); }, 120);
    });
    window.__okfGraphRO.observe($('cy'));
  }

  g6graph.on('node:click', (e) => {
    const id = e.target && e.target.id != null ? e.target.id : e.itemId;
    if (id == null) return;
    const nd = g6graph.getNodeData(id);
    const rel = nd && nd.data ? nd.data.rel : null;
    if (rel) openDoc(rel);
  });

  $('graph-legend').innerHTML = types.map(t =>
    `<span><span class="dot" style="background:${colorOf(t)}"></span>${escapeHtml(t)}</span>`).join('');
}

/* ---------- Auto-update ---------- */
let appVersion = '';
async function loadVersion() {
  try {
    appVersion = await window.okf.getVersion();
    $('app-version').textContent = 'v' + appVersion;
  } catch (e) { /* ignore */ }
}
function wireUpdates() {
  $('btn-update').onclick = () => window.okf.installUpdate();
  window.okf.onUpdateStatus((s) => {
    const btn = $('btn-update');
    switch (s.state) {
      case 'available':
        toast('Atualização ' + s.version + ' encontrada — baixando em segundo plano…', 'good');
        break;
      case 'downloading':
        btn.classList.remove('hidden');
        btn.textContent = '⬇ ' + s.percent + '%';
        btn.disabled = true;
        break;
      case 'downloaded':
        btn.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = '⬆ Atualizar para ' + s.version;
        toast('Atualização ' + s.version + ' pronta. Clique em "Atualizar" para reiniciar e instalar.', 'good');
        break;
      // 'checking' / 'none' / 'error' são silenciosos no fluxo automático.
    }
  });
}

/* ---------- Helpers ---------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- Wire up ---------- */
function init() {
  $('btn-theme').onclick = toggleTheme;
  $('btn-open').onclick = openFolder;
  $('btn-newlib').onclick = newLibrary;
  $('nl-cancel').onclick = closeNewLib;
  $('nl-ok').onclick = doCreateLibrary;
  window.okf.onMenu('menu:new-library', newLibrary);
  $('btn-sample').onclick = openSample;
  $('btn-reload').onclick = reload;
  $('btn-new').onclick = openModal;
  $('btn-graph').onclick = showGraph;
  $('btn-validate').onclick = showValidation;
  $('btn-claude').onclick = openClaude;
  $('btn-git').onclick = showGit;
  $('git-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('git-refresh').onclick = refreshGit;
  $('git-init').onclick = gitInit;
  $('git-do-commit').onclick = gitCommit;
  $('git-do-push').onclick = gitPush;
  $('disk-reload').onclick = () => { $('disk-banner').classList.add('hidden'); cancelEdit(); reloadFromDisk(); };
  $('disk-keep').onclick = () => $('disk-banner').classList.add('hidden');
  window.okf.onBundleChanged((delta) => { reloadFromDisk(delta); if (!$('git-view').classList.contains('hidden')) refreshGit(); });
  $('empty-open').onclick = openFolder;
  $('empty-sample').onclick = openSample;
  $('empty-new').onclick = newLibrary;
  $('btn-edit').onclick = enterEdit;
  $('btn-save').onclick = saveEdit;
  $('btn-cancel').onclick = cancelEdit;
  $('mode-visual').onclick = () => setEditorMode('visual');
  $('mode-source').onclick = () => setEditorMode('source');
  document.querySelectorAll('#editor-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => runToolbar(btn.dataset.cmd));
  });
  $('btn-delete').onclick = deleteCurrent;
  $('btn-rename').onclick = () => openRename(state.current);
  $('btn-export-pdf').addEventListener('click', () => window.OKFConvertUI.exportCurrentPdf());
  $('import-cancel').addEventListener('click', () => window.OKFConvertUI.closeImport());
  $('import-save').addEventListener('click', () => window.OKFConvertUI.saveImport());
  $('import-mode-visual').addEventListener('click', () => window.OKFConvertUI.setImportMode('visual'));
  $('import-mode-source').addEventListener('click', () => window.OKFConvertUI.setImportMode('source'));
  $('rn-cancel').onclick = closeRename;
  $('rn-ok').onclick = doRename;
  $('reorg-cancel').onclick = closeReorg;
  $('reorg-ok').onclick = applyReorg;
  $('xlink-badge').onclick = openLinkPanel;
  $('xlink-close').onclick = () => $('xlink-panel').classList.add('hidden');
  $('xlink-all').onclick = acceptAllSuggestions;
  $('tree-menu').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => {
    const rel = treeMenuRel; const act = b.dataset.act; closeTreeMenu();
    if (!rel) return;
    if (act === 'favorite') toggleFavorite(rel);
    else if (act === 'rename') openRename(rel);
    else if (act === 'delete') { openDoc(rel); deleteCurrent(); }
  }));
  document.addEventListener('click', (e) => { if (!$('tree-menu').contains(e.target)) closeTreeMenu(); });
  $('graph-close').onclick = () => {
    if (g6graph) { g6graph.destroy(); g6graph = null; }
    closeOverlays();
    if (state.current) showViewer();
  };
  $('validate-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('manual-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('m-cancel').onclick = closeModal;
  $('m-create').onclick = createConcept;
  $('m-template').addEventListener('change', () => applyTemplateToForm($('m-template').value));
  $('m-templates-manage').onclick = openTemplates;
  $('tpl-new').onclick = clearTplForm;
  $('tpl-save').onclick = saveTpl;
  $('tpl-delete').onclick = deleteTpl;
  $('tpl-restore').onclick = restoreTpl;
  $('tpl-close').onclick = closeTemplates;
  window.okf.onMenu('menu:templates', openTemplates);
  window.okf.onMenu('menu:export-pdf', () => window.OKFConvertUI.exportCurrentPdf());
  window.okf.onMenu('menu:import-doc', () => window.OKFConvertUI.importDocument());
  $('palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
  $('palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); activatePalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('palette').addEventListener('click', (e) => { if (e.target === $('palette')) closePalette(); });
  $('tb-concept').onclick = openConceptPicker;
  $('cm-cancel').onclick = closeConceptPicker;
  $('cm-search').addEventListener('input', e => renderConceptList(e.target.value));
  $('e-now').onclick = () => $('e-timestamp').value = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let searchTimer = null;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderTree, 150); });
  $('type-filter').addEventListener('change', renderTree);
  document.querySelectorAll('#group-seg button').forEach(b => b.addEventListener('click', () => {
    setGroupMode(b.dataset.mode); updateGroupModeButtons(); renderTree();
  }));

  // menu events from main process
  window.okf.onMenu('menu:open-folder', openFolder);
  window.okf.onMenu('menu:open-sample', openSample);
  window.okf.onMenu('menu:switch-library', switchLibrary);
  window.okf.onMenu('menu:new-concept', openModal);
  window.okf.onMenu('menu:save', () => { if (state.editing) saveEdit(); });
  window.okf.onMenu('menu:reload', reload);
  window.okf.onMenu('menu:validate', showValidation);
  window.okf.onMenu('menu:graph', showGraph);
  window.okf.onMenu('menu:rebuild-indexes', rebuildIndexes);
  window.okf.onMenu('menu:manual', showManual);
  window.okf.onMenu('menu:about', () => toast('OKF Studio ' + (appVersion ? 'v' + appVersion + ' · ' : '') + 'editor de bibliotecas Open Knowledge Format v0.1', 'good'));

  initTheme();
  loadVersion();
  wireUpdates();
  loadTemplates();
  showStart();

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { closeModal(); closeConceptPicker(); closePalette(); closeRename(); closeTreeMenu(); closeNewLib(); closeTemplates(); if ($('graph-view').classList.contains('hidden')===false || $('validate-view').classList.contains('hidden')===false || $('manual-view').classList.contains('hidden')===false || $('git-view').classList.contains('hidden')===false){ closeOverlays(); if(state.current) showViewer(); } }
  });
}
init();
