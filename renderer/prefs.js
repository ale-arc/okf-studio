'use strict';

/* ============================================================================
   prefs.js — preferências em localStorage: tema, índices automáticos, modo de
   agrupamento, seções recolhidas e favoritos. Depende de core.js.
   ========================================================================== */

/* ---------- Automação: preferência ---------- */
function autoIndexEnabled() {
  try { return localStorage.getItem(LS.AUTO_INDEX) !== 'off'; } catch (e) { return true; }
}
function setAutoIndex(on) {
  try { localStorage.setItem(LS.AUTO_INDEX, on ? 'on' : 'off'); } catch (e) {}
}

/* ---------- Tema (claro/escuro) ---------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) { btn.textContent = theme === 'light' ? '☀' : '🌙'; }
  try { localStorage.setItem(LS.THEME, theme); } catch (e) {}
  // Re-render the graph so its colors follow the new theme.
  if (typeof showGraph === 'function' && state && state.root &&
      $('graph-view') && !$('graph-view').classList.contains('hidden')) {
    showGraph();
  }
}
function initTheme() {
  let theme;
  try { theme = localStorage.getItem(LS.THEME); } catch (e) {}
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(theme);
}
function toggleTheme() { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); }
window.__okfSetTheme = applyTheme; // usado pelo smoke test

/* ---------- Agrupamento e colapso da árvore ---------- */
function currentGroupMode() {
  try { const m = localStorage.getItem(LS.GROUP_MODE); return (m === 'tag' || m === 'flat') ? m : 'type'; }
  catch (e) { return 'type'; }
}
function setGroupMode(mode) { try { localStorage.setItem(LS.GROUP_MODE, mode); } catch (e) {} }
function updateGroupModeButtons() {
  const mode = currentGroupMode();
  document.querySelectorAll('#group-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
}
function collapseKey() { return LS.COLLAPSED + (state.root || ''); }
function loadCollapsedSet() {
  let raw = null;
  try { raw = localStorage.getItem(collapseKey()); } catch (e) {}
  if (raw == null) return new Set([OKF.auto.SYSTEM_GROUP_KEY]); // 1ª vez: Sistema recolhido
  try { const a = JSON.parse(raw); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
}
function saveCollapsed(set) { try { localStorage.setItem(collapseKey(), JSON.stringify([...set])); } catch (e) {} }
function favoritesKey() { return LS.FAVORITES + (state.root || ''); }
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
