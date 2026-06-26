'use strict';

/* ============================================================================
   graph-view.js — overlays de visualização: manual, validação de conformidade
   e grafo de relacionamentos (AntV G6 v5). Depende de core.js, prefs.js, tree.js.
   ========================================================================== */

/* ---------- Manual ---------- */
let manualRendered = false;
function showManual() {
  closeOverlays();
  if (!manualRendered) {
    const body = $('manual-body');
    body.innerHTML = marked.parse($('manual-md').textContent || '');
    // Links externos abrem no navegador.
    body.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (OKF.isExternal(href)) {
        a.addEventListener('click', e => { e.preventDefault(); window.okf.openExternal(href); });
      } else {
        a.addEventListener('click', e => e.preventDefault());
      }
    });
    // Índice navegável a partir dos cabeçalhos de seção (H2).
    const hs = [...body.querySelectorAll('h2')];
    hs.forEach((h, i) => { h.id = 'man-sec-' + i; });
    $('manual-toc').innerHTML = '<div class="toc-title">Conteúdo</div>' +
      hs.map((h, i) => `<a href="#" data-i="${i}">${escapeHtml(h.textContent)}</a>`).join('');
    $('manual-toc').querySelectorAll('a[data-i]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); hs[+a.dataset.i].scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    manualRendered = true;
  }
  $('manual-view').classList.remove('hidden');
  $('manual-body').scrollTop = 0;
}

/* ---------- Validation ---------- */
function showValidation() {
  if (!state.root) return;
  closeOverlays();
  const v = OKF.validate(state.docs);
  const el = $('validate-body');
  const conform = v.errors.length === 0;
  el.innerHTML =
    `<div class="v-summary">
      <div class="v-pill"><div class="n">${v.counts.concepts}</div><div class="muted">conceitos</div></div>
      <div class="v-pill ${conform?'good':'bad'}"><div class="n">${v.counts.errors}</div><div class="muted">erros</div></div>
      <div class="v-pill warn"><div class="n">${v.counts.warnings}</div><div class="muted">avisos</div></div>
    </div>
    <div class="v-item ${conform?'okv':'err'}">
      <div class="where">${conform ? '✓ Conforme com OKF v0.1' : '✗ Não conforme'}</div>
      <div class="msg">${conform
        ? 'Todos os conceitos têm frontmatter YAML válido e campo "type".'
        : 'Corrija os erros abaixo para tornar a biblioteca conforme.'}</div>
    </div>` +
    v.errors.map(e => itemHtml(e, 'err')).join('') +
    v.warnings.map(w => itemHtml(w, 'warnv')).join('');
  el.querySelectorAll('.where[data-rel]').forEach(a =>
    a.addEventListener('click', () => openDoc(a.dataset.rel)));
  $('validate-view').classList.remove('hidden');
}
function itemHtml(it, cls) {
  return `<div class="v-item ${cls}">
    <div class="where" data-rel="${escapeAttr(it.where)}">${escapeHtml(it.where)}</div>
    <div class="msg">${escapeHtml(it.msg)}</div></div>`;
}

/* ---------- Graph (AntV G6 v5) ---------- */
const TYPE_COLORS = ['#5b9dff','#7c5cff','#43c08a','#e0a64a','#e06a6a','#4ec9d4','#d98ad9','#9aa0aa'];
let g6graph = null;

function graphThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { text: v('--text'), muted: v('--muted'), line: v('--line'), bg: v('--bg') };
}

async function showGraph() {
  if (!state.root) return;
  closeOverlays();
  $('graph-view').classList.remove('hidden');
  const g = state.graph;
  const types = [...new Set(g.nodes.map(n => n.type))];
  const colorOf = t => TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length];

  // degree (only over existing edges) → drives node size
  const deg = {};
  g.edges.forEach(e => {
    if (e.exists) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; }
  });
  const col = graphThemeColors();

  const data = {
    nodes: g.nodes.map(n => ({
      id: n.id,
      data: { label: n.title, type: n.type, rel: n.relPath, color: colorOf(n.type), deg: deg[n.id] || 0 }
    })),
    edges: g.edges.filter(e => e.exists).map((e, i) => ({ id: 'e' + i, source: e.source, target: e.target }))
  };
  $('graph-stats').textContent = `${data.nodes.length} conceitos · ${data.edges.length} relações`;

  if (g6graph) { g6graph.destroy(); g6graph = null; }
  const host = $('cy');

  g6graph = new G6.Graph({
    container: host,
    autoResize: true,
    autoFit: 'view',
    padding: 40,
    theme: currentTheme() === 'light' ? 'light' : 'dark',
    data,
    node: {
      style: {
        fill: d => d.data.color,
        stroke: d => d.data.color,
        lineWidth: 0,
        size: d => 24 + (d.data.deg || 0) * 6,
        labelText: d => d.data.label,
        labelPlacement: 'bottom',
        labelFill: col.text,
        labelFontSize: 12,
        labelBackground: false
      },
      state: { active: { lineWidth: 3, stroke: col.text } }
    },
    edge: {
      style: { stroke: col.muted || col.line, lineWidth: 1.4, endArrow: true, opacity: 0.55, curveOffset: 18 },
      state: { active: { stroke: col.text, opacity: 1 } }
    },
    // d3-force (pure JS, CSP-safe) com animation:false: calcula as posições já
    // estabilizadas antes do render/fit, evitando aglomeração. collide impede
    // sobreposição. (O smoke test headless usa 'force' à parte.)
    layout: {
      type: 'd3-force', animation: false,
      link: { distance: 140 },
      manyBody: { strength: -500 },
      collide: { radius: 56 },
      x: { strength: 0.06 },
      y: { strength: 0.06 }
    },
    behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element', { type: 'hover-activate', degree: 1 }]
  });
  await g6graph.render();
  // No resize, ajusta o canvas ao container (resize) e re-enquadra (fitView).
  // fitView é async no v5 — trate a rejeição p/ não vazar UnhandledPromiseRejection.
  // (A margem do fit vem do `padding` no nível do Graph; fitView não aceita padding.)
  const refit = () => {
    if (!g6graph || $('graph-view').classList.contains('hidden')) return;
    const host2 = $('cy');
    try { g6graph.resize(host2.clientWidth, host2.clientHeight); } catch (e) {}
    try {
      const r = g6graph.fitView({ when: 'always', direction: 'both' });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {}
  };
  window.__okfRefit = refit;
  refit();
  // Re-enquadra quando o container muda de tamanho (ResizeObserver dispara já com
  // o #cy no tamanho novo, evitando a corrida com o autoResize do G6).
  if (!window.__okfGraphRO) {
    let rt;
    window.__okfGraphRO = new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (window.__okfRefit) window.__okfRefit(); }, 120);
    });
    window.__okfGraphRO.observe($('cy'));
  }

  g6graph.on('node:click', (e) => {
    const id = e.target && e.target.id != null ? e.target.id : e.itemId;
    if (id == null) return;
    const nd = g6graph.getNodeData(id);
    const rel = nd && nd.data ? nd.data.rel : null;
    if (rel) openDoc(rel);
  });

  $('graph-legend').innerHTML = types.map(t =>
    `<span><span class="dot" style="background:${colorOf(t)}"></span>${escapeHtml(t)}</span>`).join('');
}
