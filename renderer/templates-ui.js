'use strict';

/* ============================================================================
   templates-ui.js — modelos do usuário (fora da biblioteca): carga e diálogo de
   gerenciamento (CRUD). Depende de core.js. `applyTemplateToForm` vive em
   concept.js (usa o form do modal de criação).
   ========================================================================== */

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
