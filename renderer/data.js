'use strict';

/* ============================================================================
   data.js — indexação (index.md/log.md), grafo em memória e motor de reload
   (delta no caminho feliz, full no fallback). Depende de core.js e prefs.js.
   ========================================================================== */

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
    if (baseNameOf(d.relPath).toLowerCase() !== 'index.md') continue;
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
  ['btn-reload','btn-new','btn-graph','btn-validate','btn-health','btn-claude','btn-git','search','type-filter'].forEach(id => $(id).disabled = false);
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
