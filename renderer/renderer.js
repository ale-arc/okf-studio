'use strict';

/* ============================================================================
   renderer.js — entry point. Versão, auto-update e wiring de eventos (init()).
   Carregado por ÚLTIMO: depende de todos os módulos (core, prefs, data, start,
   tree, concept, git-panel, graph-view, palette, templates-ui).
   ========================================================================== */

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
  $('btn-health').onclick = showHealth;
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
  $('health-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };
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
  window.okf.onMenu('menu:health', showHealth);
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
    if (e.key === 'Escape') { closeModal(); closeConceptPicker(); closePalette(); closeRename(); closeTreeMenu(); closeNewLib(); closeTemplates(); if ($('graph-view').classList.contains('hidden')===false || $('validate-view').classList.contains('hidden')===false || $('health-view').classList.contains('hidden')===false || $('manual-view').classList.contains('hidden')===false || $('git-view').classList.contains('hidden')===false){ closeOverlays(); if(state.current) showViewer(); } }
  });
}
init();
