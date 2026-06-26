// Autocomplete de [[wikilink]]: ao digitar "[[", abre um popup ancorado no cursor
// com busca dos conceitos; ao escolher, substitui "[[query" por um link
// [Título](/caminho.md). Plugin ProseMirror isolado (um por instância do editor).
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';

let wlSeq = 0;

// Pura e testável: detecta um "[[" aberto antes do cursor no texto do bloco atual.
// Retorna { from, query } (from = índice do "[[" no texto) ou null se não houver
// um "[[" aberto (sem "]" / "[" / quebra de linha depois dele).
export function wikiLinkQuery(textBeforeCursor) {
  const idx = textBeforeCursor.lastIndexOf('[[');
  if (idx < 0) return null;
  const query = textBeforeCursor.slice(idx + 2);
  if (/[\[\]\n]/.test(query)) return null; // já fechado ou malformado
  return { from: idx, query };
}

// getItems: () => [{ relPath, title }]  (provedor vindo do renderer)
export function wikiLinkPlugin(getItems) {
  const key = new PluginKey('okf-wikilink-' + (wlSeq++));
  const S = { active: false, items: [], sel: 0, from: 0, to: 0, pop: null };

  function hide() {
    S.active = false; S.items = []; S.sel = 0;
    if (S.pop) { S.pop.remove(); S.pop = null; }
  }

  function renderPop(view) {
    if (!S.pop) { S.pop = document.createElement('div'); S.pop.className = 'okf-wikilink-menu'; document.body.appendChild(S.pop); }
    const pop = S.pop;
    pop.innerHTML = '';
    S.items.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'okf-wikilink-item' + (i === S.sel ? ' sel' : '');
      const t = document.createElement('div'); t.className = 'wl-title'; t.textContent = it.title || it.relPath;
      const p = document.createElement('div'); p.className = 'wl-path'; p.textContent = '/' + it.relPath;
      el.appendChild(t); el.appendChild(p);
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(view, i); });
      pop.appendChild(el);
    });
    const coords = view.coordsAtPos(view.state.selection.from);
    pop.style.left = Math.round(coords.left) + 'px';
    pop.style.top = Math.round(coords.bottom + 4) + 'px';
  }

  function pick(view, i) {
    const it = S.items[i];
    const { from, to } = S;
    if (!it) { hide(); return; }
    const schema = view.state.schema;
    const linkMark = schema.marks.link;
    const href = '/' + it.relPath.replace(/^\/+/, '');
    const node = schema.text(it.title || href, linkMark ? [linkMark.create({ href })] : []);
    let tr = view.state.tr.replaceWith(from, to, node);
    const end = from + node.nodeSize;
    tr = tr.setSelection(TextSelection.create(tr.doc, end));
    if (linkMark) tr = tr.removeStoredMark(linkMark);
    hide();
    view.dispatch(tr);
    view.focus();
  }

  function recompute(view) {
    const sel = view.state.selection;
    if (!sel.empty || !sel.$from.parent.isTextblock) { hide(); return; }
    const $from = sel.$from;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
    const q = wikiLinkQuery(textBefore);
    if (!q) { hide(); return; }
    const term = q.query.toLowerCase();
    const items = (getItems ? (getItems() || []) : [])
      .filter(it => !term ||
        (it.title && it.title.toLowerCase().includes(term)) ||
        (it.relPath && it.relPath.toLowerCase().includes(term)))
      .slice(0, 50);
    if (!items.length) { hide(); return; }
    const cursorPos = sel.from;
    const blockStart = cursorPos - $from.parentOffset;
    S.from = blockStart + q.from; // inclui o "[["
    S.to = cursorPos;
    S.items = items;
    if (S.sel >= items.length) S.sel = 0;
    S.active = true;
    renderPop(view);
  }

  const plugin = new Plugin({
    key,
    view: () => ({
      update: (v) => recompute(v),
      destroy: () => hide(),
    }),
    props: {
      handleKeyDown: (view, event) => {
        if (!S.active || !S.items.length) return false;
        if (event.key === 'ArrowDown') { S.sel = (S.sel + 1) % S.items.length; renderPop(view); return true; }
        if (event.key === 'ArrowUp') { S.sel = (S.sel - 1 + S.items.length) % S.items.length; renderPop(view); return true; }
        if (event.key === 'Enter') { pick(view, S.sel); return true; }
        if (event.key === 'Escape') { hide(); return true; }
        return false;
      },
    },
  });

  return $prose(() => plugin);
}
