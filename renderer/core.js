'use strict';

/* ============================================================================
   core.js — substrato compartilhado: DOM helper, estado global, constantes,
   helpers genéricos e toggles de view. Carregado primeiro (depois de okf.js).
   ========================================================================== */

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

/* Chaves de localStorage (centralizadas). */
const LS = {
  THEME: 'okf-theme',
  AUTO_INDEX: 'okf-auto-index',
  GROUP_MODE: 'okf-group-mode',
  COLLAPSED: 'okf-collapsed:',   // prefixo + state.root
  FAVORITES: 'okf-favorites:',   // prefixo + state.root
};

function todayStr() { return new Date().toISOString().slice(0, 10); }
function baseNameOf(rel) { return rel.split('/').pop(); }
function docByRel(rel) { return state.docs.find(d => d.relPath === rel); }

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

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------- Helpers ---------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- View states ---------- */
function showEmpty(){ $('empty').classList.remove('hidden'); $('viewer').classList.add('hidden'); $('recent-list').classList.add('hidden'); }
function showViewer(){ $('empty').classList.add('hidden'); $('viewer').classList.remove('hidden'); }
function closeOverlays(){ $('graph-view').classList.add('hidden'); $('validate-view').classList.add('hidden'); $('health-view').classList.add('hidden'); $('search-view').classList.add('hidden'); $('manual-view').classList.add('hidden'); $('git-view').classList.add('hidden'); }
