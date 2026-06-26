'use strict';

/* ============================================================================
   palette.js — paleta de comandos (Ctrl+P): ações + conceitos pesquisáveis.
   Depende de core.js e das funções de ação dos demais módulos.
   ========================================================================== */

let paletteItems = [], paletteSel = 0;
function paletteActions() {
  const lib = !!state.root;
  return [
    { label: 'Novo conceito', run: openModal, needsLib: true },
    { label: 'Grafo de relacionamentos', run: showGraph, needsLib: true },
    { label: 'Validar conformidade', run: showValidation, needsLib: true },
    { label: 'Saúde da biblioteca', run: showHealth, needsLib: true },
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
