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
};

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

/* Timestamps ISO são lidos pelo js-yaml como Date — formata de volta para ISO
   (sem milissegundos) para não corromper o campo ao exibir/editar/salvar. */
function fmtTimestamp(v) {
  if (v instanceof Date) return v.toISOString().replace(/\.\d+Z$/, 'Z');
  return String(v);
}

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
  const res = await window.okf.readBundle(dir);
  loadBundle(res, dir.split(/[\\/]/).pop());
}
async function openSample() {
  const res = await window.okf.readSample();
  loadBundle(res, 'Biblioteca de exemplo');
}
async function reload() {
  if (!state.root) return;
  const res = await window.okf.readBundle(state.root);
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
async function reloadFromDisk() {
  if (!state.root) return;
  let res;
  try { res = await window.okf.readBundle(state.root); } catch (e) { return; }
  const newDocs = res.docs || [];

  // Edição em andamento: nunca sobrescrever o editor.
  if (state.editing && state.current) {
    const old = state.docs.find(d => d.relPath === state.current);
    const cur = newDocs.find(d => d.relPath === state.current);
    state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree();
    $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
    if (cur && old && cur.content !== old.content) $('disk-banner').classList.remove('hidden');
    return;
  }

  // Sem edição: atualização completa preservando a seleção.
  state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree();
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
  $('bundle-name').textContent = name + '  ·  ' + state.docs.length + ' arquivos';
  ['btn-reload','btn-new','btn-graph','btn-validate','btn-claude','btn-git','search','type-filter'].forEach(id => $(id).disabled = false);
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

/* ---------- Tree ---------- */
function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  const q = ($('search').value || '').toLowerCase().trim();
  const typeF = $('type-filter').value;

  // group by top-level directory
  const groups = new Map();
  for (const d of state.docs) {
    const p = parsedOf(d);
    const id = OKF.conceptId(d.relPath);
    const title = p.frontmatter.title || d.name.replace(/\.md$/i,'');
    const type = d.reserved ? '' : (p.frontmatter.type || 'Sem tipo');
    const tags = Array.isArray(p.frontmatter.tags) ? p.frontmatter.tags.join(' ') : '';
    // filters
    if (typeF && type !== typeF) continue;
    const body = (p.body || '').toLowerCase();
    if (q && !(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) || tags.toLowerCase().includes(q) || body.includes(q))) continue;

    const dir = d.relPath.includes('/') ? d.relPath.replace(/\/[^/]*$/,'') : '(raiz)';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push({ d, title, type });
  }

  if (!groups.size) {
    tree.innerHTML = '<div class="dir">Nenhum resultado</div>';
    return;
  }
  for (const [dir, items] of [...groups.entries()].sort()) {
    const dh = document.createElement('div');
    dh.className = 'dir';
    dh.textContent = dir;
    tree.appendChild(dh);
    items.sort((a,b)=> a.d.reserved===b.d.reserved ? a.title.localeCompare(b.title) : (a.d.reserved?-1:1));
    for (const it of items) {
      const node = document.createElement('div');
      node.className = 'node' + (it.d.reserved ? ' reserved' : '') + (it.d.relPath===state.current ? ' active' : '');
      node.dataset.rel = it.d.relPath;
      node.innerHTML = `<span class="ic">${it.d.reserved ? '◷' : '📄'}</span>` +
        `<span class="ttl"></span>` +
        (it.type ? `<span class="badge"></span>` : '');
      node.querySelector('.ttl').textContent = it.title;
      if (it.type) node.querySelector('.badge').textContent = it.type;
      node.addEventListener('click', () => openDoc(it.d.relPath));
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

/* ---------- View states ---------- */
function showEmpty(){ $('empty').classList.remove('hidden'); $('viewer').classList.add('hidden'); }
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
  $('render-mode').classList.remove('hidden');
  $('edit-mode').classList.add('hidden');
  $('btn-edit').classList.remove('hidden');
  $('btn-save').classList.add('hidden');
  $('btn-cancel').classList.add('hidden');
  $('btn-delete').classList.toggle('hidden', doc.reserved);

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
  bodyEl.innerHTML = marked.parse(p.body || '');
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
  renderConcept(doc);
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
    const tags = $('e-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
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
    await window.okf.writeFile({ root: state.root, relPath: doc.relPath, content });
    doc.content = content;
    indexDocs();
    buildTypeFilter();
    renderTree();
    state.editing = false;
    if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
    renderConcept(doc);
    toast('Salvo em ' + doc.relPath, 'good');
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'bad');
  }
}

/* ---------- Delete ---------- */
async function deleteCurrent() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc || doc.reserved) return;
  const ok = await window.okf.confirm({ message: 'Excluir este conceito?', detail: doc.relPath });
  if (!ok) return;
  try {
    await window.okf.deleteFile({ root: state.root, relPath: doc.relPath });
    state.docs = state.docs.filter(d => d.relPath !== doc.relPath);
    indexDocs(); buildTypeFilter(); renderTree();
    const next = state.docs.find(d => !d.reserved) || state.docs[0];
    if (next) openDoc(next.relPath); else showEmpty();
    toast('Conceito excluído', 'good');
  } catch (e) { toast('Erro ao excluir: ' + e.message, 'bad'); }
}

/* ---------- New concept modal ---------- */
function openModal() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  ['m-path','m-type','m-title','m-description'].forEach(id => $(id).value = '');
  $('modal').classList.remove('hidden');
  $('m-path').focus();
}
function closeModal(){ $('modal').classList.add('hidden'); }
async function createConcept() {
  let rel = $('m-path').value.trim().replace(/^\/+/, '');
  const type = $('m-type').value.trim();
  if (!rel) { toast('Informe o caminho do arquivo.', 'bad'); return; }
  if (!rel.toLowerCase().endsWith('.md')) rel += '.md';
  if (!type) { toast('O campo "type" é obrigatório.', 'bad'); return; }
  const fm = { type };
  if ($('m-title').value.trim()) fm.title = $('m-title').value.trim();
  if ($('m-description').value.trim()) fm.description = $('m-description').value.trim();
  fm.timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const content = OKF.serialize(fm, '# ' + (fm.title || 'Novo conceito') + '\n\nDescreva aqui.\n');
  try {
    await window.okf.createFile({ root: state.root, relPath: rel, content });
    state.docs.push({ relPath: rel, name: rel.split('/').pop(), reserved: OKF.isReserved(rel), content, mtime: Date.now() });
    indexDocs(); buildTypeFilter(); renderTree();
    closeModal();
    openDoc(rel);
    toast('Conceito criado: ' + rel, 'good');
  } catch (e) { toast('Erro ao criar: ' + e.message, 'bad'); }
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
  window.okf.onBundleChanged(() => { reloadFromDisk(); if (!$('git-view').classList.contains('hidden')) refreshGit(); });
  $('empty-open').onclick = openFolder;
  $('empty-sample').onclick = openSample;
  $('btn-edit').onclick = enterEdit;
  $('btn-save').onclick = saveEdit;
  $('btn-cancel').onclick = cancelEdit;
  $('mode-visual').onclick = () => setEditorMode('visual');
  $('mode-source').onclick = () => setEditorMode('source');
  document.querySelectorAll('#editor-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => runToolbar(btn.dataset.cmd));
  });
  $('btn-delete').onclick = deleteCurrent;
  $('graph-close').onclick = () => {
    if (g6graph) { g6graph.destroy(); g6graph = null; }
    closeOverlays();
    if (state.current) showViewer();
  };
  $('validate-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('manual-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('m-cancel').onclick = closeModal;
  $('m-create').onclick = createConcept;
  $('tb-concept').onclick = openConceptPicker;
  $('cm-cancel').onclick = closeConceptPicker;
  $('cm-search').addEventListener('input', e => renderConceptList(e.target.value));
  $('e-now').onclick = () => $('e-timestamp').value = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  $('search').addEventListener('input', renderTree);
  $('type-filter').addEventListener('change', renderTree);

  // menu events from main process
  window.okf.onMenu('menu:open-folder', openFolder);
  window.okf.onMenu('menu:open-sample', openSample);
  window.okf.onMenu('menu:new-concept', openModal);
  window.okf.onMenu('menu:save', () => { if (state.editing) saveEdit(); });
  window.okf.onMenu('menu:reload', reload);
  window.okf.onMenu('menu:validate', showValidation);
  window.okf.onMenu('menu:graph', showGraph);
  window.okf.onMenu('menu:manual', showManual);
  window.okf.onMenu('menu:about', () => toast('OKF Studio ' + (appVersion ? 'v' + appVersion + ' · ' : '') + 'editor de bibliotecas Open Knowledge Format v0.1', 'good'));

  initTheme();
  loadVersion();
  wireUpdates();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeConceptPicker(); if ($('graph-view').classList.contains('hidden')===false || $('validate-view').classList.contains('hidden')===false || $('manual-view').classList.contains('hidden')===false || $('git-view').classList.contains('hidden')===false){ closeOverlays(); if(state.current) showViewer(); } }
  });
}
init();
