'use strict';

/* ============================================================================
   concept.js — visualização e edição de um conceito: render, cross-links,
   editor (visual/código), salvar, trocar tipo, mover, renomear, reorganizar,
   excluir e criar. Depende de core.js, prefs.js, data.js, tree.js.
   ========================================================================== */

function applyTemplateToForm(name) {
  const t = state.templates.find(x => x.name === name);
  if (!t) return;
  $('m-type').value = t.type || '';
  $('m-description').value = t.description || '';
  $('m-tags').value = (t.tags || []).join(', ');
}

// Opções compartilhadas ao (re)criar o editor Milkdown: sincroniza o corpo e
// alimenta o autocomplete de [[wikilink]] com os conceitos da biblioteca.
function editorOpts() {
  return {
    onChange: (md) => { state.editorBody = md; },
    wikiLinkItems: () => currentConceptsForLinks(),
  };
}

/* ---------- Render doc ---------- */
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
    await window.OKFEditor.create($('milkdown'), newBody, editorOpts());
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
  await window.OKFEditor.create($('milkdown'), state.editorBody, editorOpts());
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
    await window.OKFEditor.create($('milkdown'), state.editorBody, editorOpts());
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

// Padroniza o tipo: reescreve o frontmatter de todos os conceitos cujo tipo
// mapeia ao mesmo slug para o rótulo `target` (usado pelo painel Saúde).
async function unifyType(slug, target) {
  const ops = OKF.auto.unifyTypeOps(state.docs, slug, target);
  if (!ops.length) { toast('Nada a unificar.', 'good'); return false; }
  const ok = await window.okf.confirm({
    message: 'Padronizar o tipo para "' + target + '"?',
    detail: ops.length + ' conceito(s) terão o campo "type" reescrito (mesma pasta; nada é movido).'
  });
  if (!ok) return false;
  const done = await applyOpsAndRefresh(ops, state.current);
  if (done) toast('Tipo unificado: ' + ops.length + ' conceito(s) → ' + target, 'good');
  return done;
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
