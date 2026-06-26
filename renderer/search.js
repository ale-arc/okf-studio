'use strict';

/* ============================================================================
   search.js — painel "Busca e substituição": busca literal no corpo dos
   conceitos com trechos destacados e localizar-e-substituir com revisão por
   arquivo (substitui só no corpo, preserva o frontmatter). Depende de core.js,
   data.js (docByRel/applyOpsAndRefresh), tree.js (openDoc) e das funções puras
   OKF.searchConcepts / OKF.replaceInBody.
   ========================================================================== */

let searchResults = [];

function showSearch() {
  if (!state.root) return;
  closeOverlays();
  $('search-view').classList.remove('hidden');
  renderSearchResults([], $('sq').value || '');
  $('sq').focus();
  $('sq').select();
}

function searchCaseSensitive() { return $('sc').checked; }

function runSearch() {
  const q = $('sq').value;
  searchResults = OKF.searchConcepts(state.docs, q, { caseSensitive: searchCaseSensitive() });
  renderSearchResults(searchResults, q);
}

function highlightSnippet(s) {
  return escapeHtml(s.before) + '<mark>' + escapeHtml(s.match) + '</mark>' + escapeHtml(s.after);
}

function renderSearchResults(results, q) {
  const el = $('search-body');
  if (!q) { el.innerHTML = '<div class="search-empty">Digite um termo e clique em Buscar.</div>'; return; }
  if (!results.length) { el.innerHTML = '<div class="search-empty">Nenhuma ocorrência de "' + escapeHtml(q) + '".</div>'; return; }
  const total = results.reduce((n, r) => n + r.count, 0);
  el.innerHTML =
    '<div class="search-summary">' + total + ' ocorrência(s) em ' + results.length + ' conceito(s)</div>' +
    results.map((r) =>
      '<div class="search-item">' +
        '<div class="search-row">' +
          '<input type="checkbox" class="search-pick" data-rel="' + escapeAttr(r.relPath) + '" checked />' +
          '<span class="where" data-rel="' + escapeAttr(r.relPath) + '">' + escapeHtml(r.title) + '</span>' +
          '<span class="search-path">/' + escapeHtml(r.relPath) + '</span>' +
          '<span class="search-count">' + r.count + '</span>' +
        '</div>' +
        r.snippets.map(s => '<div class="search-snip">' + highlightSnippet(s) + '</div>').join('') +
      '</div>').join('');
  el.querySelectorAll('.where[data-rel]').forEach(a => a.addEventListener('click', () => openDoc(a.dataset.rel)));
}

async function applyReplace() {
  const q = $('sq').value;
  if (!q) { toast('Informe o termo a buscar.', 'bad'); return; }
  const picks = [...$('search-body').querySelectorAll('.search-pick:checked')].map(c => c.dataset.rel);
  if (!picks.length) { toast('Selecione ao menos um conceito.', 'bad'); return; }
  const rep = $('sr').value;
  const cs = searchCaseSensitive();
  const ops = []; let total = 0;
  for (const rel of picks) {
    const d = docByRel(rel);
    if (!d) continue;
    const { content, count } = OKF.replaceInBody(d.content, q, rep, { caseSensitive: cs });
    if (count) { ops.push({ op: 'write', relPath: rel, content }); total += count; }
  }
  if (!ops.length) { toast('Nada a substituir.', 'good'); return; }
  const ok = await window.okf.confirm({
    message: 'Substituir "' + q + '" por "' + rep + '"?',
    detail: total + ' ocorrência(s) em ' + ops.length + ' conceito(s) — apenas no corpo (frontmatter preservado).'
  });
  if (!ok) return;
  const done = await applyOpsAndRefresh(ops, state.current);
  if (done) { toast('Substituídas ' + total + ' ocorrência(s) em ' + ops.length + ' conceito(s)', 'good'); runSearch(); }
}
