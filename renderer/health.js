'use strict';

/* ============================================================================
   health.js — painel "Saúde da biblioteca": lint do grafo de conhecimento
   (links quebrados, órfãos, tipos inconsistentes, índices desatualizados,
   títulos duplicados, dicas). Reusa as classes CSS de validate-view (.v-*).
   Depende de core.js, prefs.js, data.js (indexOpsFrom/rebuildIndexes), tree.js
   (openDoc) e da função pura OKF.health.
   ========================================================================== */

function showHealth() {
  if (!state.root) return;
  closeOverlays();
  const h = OKF.health(state.docs);
  const stale = indexOpsFrom(state.docs).length;
  renderHealth(h, stale);
  $('health-view').classList.remove('hidden');
}

// Uma linha de achado clicável (abre o conceito) ou informativa (sem data-rel).
function healthItemHtml(where, msg, cls) {
  const rel = where ? ` data-rel="${escapeAttr(where)}"` : '';
  return `<div class="v-item ${cls || 'warnv'}">` +
    `<div class="where"${rel}>${escapeHtml(where || '—')}</div>` +
    `<div class="msg">${escapeHtml(msg)}</div></div>`;
}

function renderHealth(h, stale) {
  const c = h.counts;
  const total = c.brokenLinks + c.orphans + c.inconsistentTypes + c.duplicateTitles + stale;
  const el = $('health-body');
  let html =
    `<div class="v-summary">
      <div class="v-pill ${c.brokenLinks ? 'bad' : 'good'}"><div class="n">${c.brokenLinks}</div><div class="muted">links quebrados</div></div>
      <div class="v-pill warn"><div class="n">${c.orphans}</div><div class="muted">órfãos</div></div>
      <div class="v-pill warn"><div class="n">${c.inconsistentTypes}</div><div class="muted">tipos inconsistentes</div></div>
      <div class="v-pill warn"><div class="n">${stale}</div><div class="muted">índices a atualizar</div></div>
      <div class="v-pill warn"><div class="n">${c.duplicateTitles}</div><div class="muted">títulos duplicados</div></div>
    </div>`;

  if (!total && !c.noDescription && !c.noTags) {
    html += `<div class="v-item okv"><div class="where">✓ Biblioteca saudável</div>` +
      `<div class="msg">Sem links quebrados, órfãos, tipos inconsistentes, índices pendentes ou títulos duplicados.</div></div>`;
    el.innerHTML = html;
    return;
  }

  // Índices desatualizados (com ação de 1 clique).
  if (stale) {
    html += `<div class="v-section">📇 Índices desatualizados</div>`;
    html += `<div class="v-item warnv"><div class="where">${stale} arquivo(s) index.md</div>` +
      `<div class="msg">Listagens automáticas fora de sincronia. ` +
      `<button id="health-rebuild" class="health-fix">Reconstruir índices (${stale})</button></div></div>`;
  }

  // Links quebrados.
  if (h.brokenLinks.length) {
    html += `<div class="v-section">🔗 Links quebrados</div>`;
    html += h.brokenLinks.map(b => healthItemHtml(b.where, 'Aponta para conceito inexistente: "' + b.target + '".', 'err')).join('');
  }

  // Conceitos órfãos.
  if (h.orphans.length) {
    html += `<div class="v-section">🏝️ Conceitos órfãos</div>`;
    html += h.orphans.map(o => healthItemHtml(o.where, 'Nenhum outro conceito aponta para "' + o.title + '".')).join('');
  }

  // Tipos inconsistentes (sem alvo único — informativo).
  if (h.inconsistentTypes.length) {
    html += `<div class="v-section">🏷️ Tipos inconsistentes</div>`;
    html += h.inconsistentTypes.map(t =>
      healthItemHtml('', 'Variações do mesmo tipo: ' + t.variants.join(' / ') + ' — padronize para "' + t.canonical + '".')).join('');
  }

  // Títulos duplicados (uma linha por conceito do grupo).
  if (h.duplicateTitles.length) {
    html += `<div class="v-section">👯 Títulos duplicados</div>`;
    html += h.duplicateTitles.map(d =>
      d.items.map(it => healthItemHtml(it.where, 'Título repetido: "' + d.title + '".')).join('')).join('');
  }

  // Dicas (severidade baixa).
  if (h.noDescription.length || h.noTags.length) {
    html += `<div class="v-section">📝 Dicas (opcionais)</div>`;
    html += h.noDescription.map(x => healthItemHtml(x.where, 'Sem "description" — recomendado para índices e buscas.')).join('');
    html += h.noTags.map(x => healthItemHtml(x.where, 'Sem "tags" — ajuda no agrupamento e na busca.')).join('');
  }

  el.innerHTML = html;

  // Navegação ao clicar num achado.
  el.querySelectorAll('.where[data-rel]').forEach(a =>
    a.addEventListener('click', () => openDoc(a.dataset.rel)));

  // Ação: reconstruir índices, depois re-renderiza o painel.
  const rebuildBtn = $('health-rebuild');
  if (rebuildBtn) rebuildBtn.addEventListener('click', async () => { await rebuildIndexes(); showHealth(); });
}
