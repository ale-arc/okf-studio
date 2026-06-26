'use strict';

/* ============================================================================
   tree.js — árvore lateral: filtro+agrupamento, drag-drop entre grupos, menu de
   contexto e abertura de conceito. Depende de core.js, prefs.js, data.js.
   ========================================================================== */

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

/* ---------- Open doc ---------- */
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
