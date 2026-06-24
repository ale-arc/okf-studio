'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  root: null,
  name: '',
  docs: [],            // [{relPath,name,reserved,content,mtime}]
  byId: new Map(),     // conceptId -> doc
  current: null,       // relPath of open doc
  editing: false,
  graph: null
};

marked.setOptions({ gfm: true, breaks: false });

/* Memoized OKF.parse — avoids re-parsing every doc's YAML on each keystroke. */
function parsedOf(doc) {
  if (doc._pSrc !== doc.content) { doc._p = OKF.parse(doc.content); doc._pSrc = doc.content; }
  return doc._p;
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

function loadBundle(res, name) {
  state.root = res.root;
  state.name = name;
  state.docs = res.docs || [];
  indexDocs();
  $('bundle-name').textContent = name + '  ·  ' + state.docs.length + ' arquivos';
  ['btn-reload','btn-new','btn-graph','btn-validate','search','type-filter'].forEach(id => $(id).disabled = false);
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
    if (q && !(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) || tags.toLowerCase().includes(q))) continue;

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
function closeOverlays(){ $('graph-view').classList.add('hidden'); $('validate-view').classList.add('hidden'); }

/* ---------- Open / render doc ---------- */
function openDoc(relPath) {
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
      (f.timestamp ? `<div class="fm-row"><span class="k">timestamp:</span> ${escapeHtml(String(f.timestamp))}</div>` : '') +
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
function enterEdit() {
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
  // For reserved files, hide frontmatter grid and edit the RAW content so any
  // frontmatter they carry (e.g. okf_version in the root index.md) is preserved.
  $('edit-mode').querySelector('.edit-grid').style.display = reserved ? 'none' : '';
  $('extra-fm').style.display = reserved ? 'none' : '';
  if (reserved) {
    $('e-body').value = doc.content;
    return;
  }
  $('e-type').value = f.type || '';
  $('e-title').value = f.title || '';
  $('e-description').value = f.description || '';
  $('e-resource').value = f.resource || '';
  $('e-tags').value = Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '');
  $('e-timestamp').value = f.timestamp ? String(f.timestamp) : '';
  const known = ['type','title','description','resource','tags','timestamp'];
  const extra = {};
  Object.keys(f).forEach(k => { if (!known.includes(k)) extra[k] = f[k]; });
  $('e-extra').value = Object.keys(extra).length ? jsyaml.dump(extra).replace(/\n$/,'') : '';
  $('e-body').value = p.body || '';
}

function cancelEdit() {
  state.editing = false;
  const doc = state.docs.find(d => d.relPath === state.current);
  renderConcept(doc);
}

async function saveEdit() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc) return;
  let content;
  if (doc.reserved) {
    content = $('e-body').value;
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
    content = OKF.serialize(fm, $('e-body').value);
  }
  try {
    await window.okf.writeFile({ root: state.root, relPath: doc.relPath, content });
    doc.content = content;
    indexDocs();
    buildTypeFilter();
    renderTree();
    state.editing = false;
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

/* ---------- Graph ---------- */
const TYPE_COLORS = ['#5b9dff','#7c5cff','#43c08a','#e0a64a','#e06a6a','#4ec9d4','#d98ad9','#9aa0aa'];
function showGraph() {
  if (!state.root) return;
  closeOverlays();
  $('graph-view').classList.remove('hidden');
  const g = state.graph;
  const types = [...new Set(g.nodes.map(n => n.type))];
  const colorOf = t => TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length];

  const elements = [];
  for (const n of g.nodes) elements.push({ data: { id: n.id, label: n.title, type: n.type, rel: n.relPath, color: colorOf(n.type) } });
  let edgeId = 0;
  for (const e of g.edges) {
    if (!e.exists) continue; // only edges to existing concepts
    elements.push({ data: { id: 'e'+(edgeId++), source: e.source, target: e.target } });
  }
  $('graph-stats').textContent = `${g.nodes.length} conceitos · ${edgeId} relações`;

  const cy = cytoscape({
    container: $('cy'),
    elements,
    style: [
      { selector: 'node', style: {
        'background-color': 'data(color)', 'label': 'data(label)',
        'color': '#e6e8ec', 'font-size': '11px', 'text-valign': 'bottom',
        'text-margin-y': 4, 'width': 26, 'height': 26,
        'text-background-color': '#1e1f23', 'text-background-opacity': 0.85,
        'text-background-padding': 2 } },
      { selector: 'edge', style: {
        'width': 1.4, 'line-color': '#4a4f59', 'target-arrow-color': '#4a4f59',
        'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.9 } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#fff' } }
    ],
    layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: 6000, idealEdgeLength: 90 }
  });
  cy.on('tap', 'node', evt => openDoc(evt.target.data('rel')));

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
  $('btn-open').onclick = openFolder;
  $('btn-sample').onclick = openSample;
  $('btn-reload').onclick = reload;
  $('btn-new').onclick = openModal;
  $('btn-graph').onclick = showGraph;
  $('btn-validate').onclick = showValidation;
  $('empty-open').onclick = openFolder;
  $('empty-sample').onclick = openSample;
  $('btn-edit').onclick = enterEdit;
  $('btn-save').onclick = saveEdit;
  $('btn-cancel').onclick = cancelEdit;
  $('btn-delete').onclick = deleteCurrent;
  $('graph-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('validate-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
  $('m-cancel').onclick = closeModal;
  $('m-create').onclick = createConcept;
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
  window.okf.onMenu('menu:about', () => toast('OKF Studio ' + (appVersion ? 'v' + appVersion + ' · ' : '') + 'editor de bibliotecas Open Knowledge Format v0.1', 'good'));

  loadVersion();
  wireUpdates();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); if ($('graph-view').classList.contains('hidden')===false || $('validate-view').classList.contains('hidden')===false){ closeOverlays(); if(state.current) showViewer(); } }
  });
}
init();
