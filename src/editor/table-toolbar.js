// Barra contextual de tabela: surge acima da tabela onde está o cursor.
// GFM puro — inserir/excluir/mover linhas e colunas e alinhamento.
import { editorViewCtx, commandsCtx } from '@milkdown/core';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { selectedRect } from '@milkdown/prose/tables';
import {
  addColBeforeCommand, addColAfterCommand,
  addRowBeforeCommand, addRowAfterCommand,
  selectColCommand, selectRowCommand, selectTableCommand,
  deleteSelectedCellsCommand, setAlignCommand,
  moveColCommand, moveRowCommand
} from '@milkdown/preset-gfm';

const key = new PluginKey('okf-table-toolbar');

// Sobe da seleção procurando o nó `table`. Retorna { pos, dom } ou null.
function findTable(view) {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {
      const pos = $from.before(d);
      return { pos, dom: view.nodeDOM(pos) };
    }
  }
  return null;
}

export const tableToolbar = $prose((ctx) => {
  let bar = null;

  const call = (name, payload) => {
    ctx.get(commandsCtx).call(name, payload);
    ctx.get(editorViewCtx).focus();
  };
  const moveCol = (dir) => {
    try {
      const r = selectedRect(ctx.get(editorViewCtx).state);
      const from = r.left, to = from + dir;
      if (to < 0 || to >= r.map.width) return;
      call(moveColCommand.key, { from, to });
    } catch (e) { /* fora de tabela */ }
  };
  const moveRow = (dir) => {
    try {
      const r = selectedRect(ctx.get(editorViewCtx).state);
      const from = r.top, to = from + dir;
      if (to < 1 || to >= r.map.height) return; // não cruza o cabeçalho (linha 0)
      call(moveRowCommand.key, { from, to });
    } catch (e) { /* fora de tabela */ }
  };

  const BTNS = [
    { act: 'col-before', label: '⊟+', title: 'Inserir coluna à esquerda', run: () => call(addColBeforeCommand.key) },
    { act: 'col-after',  label: '+⊟', title: 'Inserir coluna à direita',  run: () => call(addColAfterCommand.key) },
    { act: 'col-del',    label: '⊟✕', title: 'Excluir coluna', run: () => { call(selectColCommand.key); call(deleteSelectedCellsCommand.key); } },
    { sep: true },
    { act: 'row-before', label: '⊡+', title: 'Inserir linha acima',  run: () => call(addRowBeforeCommand.key) },
    { act: 'row-after',  label: '+⊡', title: 'Inserir linha abaixo', run: () => call(addRowAfterCommand.key) },
    { act: 'row-del',    label: '⊡✕', title: 'Excluir linha', run: () => { call(selectRowCommand.key); call(deleteSelectedCellsCommand.key); } },
    { sep: true },
    { act: 'align-left',   label: '⬅', title: 'Alinhar à esquerda', run: () => call(setAlignCommand.key, 'left') },
    { act: 'align-center', label: '⬍', title: 'Centralizar',        run: () => call(setAlignCommand.key, 'center') },
    { act: 'align-right',  label: '➡', title: 'Alinhar à direita',  run: () => call(setAlignCommand.key, 'right') },
    { sep: true },
    { act: 'col-move-left',  label: '◀', title: 'Mover coluna à esquerda', run: () => moveCol(-1) },
    { act: 'col-move-right', label: '▶', title: 'Mover coluna à direita',  run: () => moveCol(1) },
    { act: 'row-move-up',    label: '▲', title: 'Mover linha acima',  run: () => moveRow(-1) },
    { act: 'row-move-down',  label: '▼', title: 'Mover linha abaixo', run: () => moveRow(1) },
    { sep: true },
    { act: 'table-del', label: '🗑', title: 'Excluir tabela', run: () => { call(selectTableCommand.key); call(deleteSelectedCellsCommand.key); } },
  ];

  function buildBar(host) {
    const el = document.createElement('div');
    el.className = 'okf-table-toolbar';
    el.style.display = 'none';
    for (const b of BTNS) {
      if (b.sep) { const s = document.createElement('span'); s.className = 'tb-sep'; el.appendChild(s); continue; }
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = b.label; btn.title = b.title; btn.dataset.act = b.act;
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); b.run(); });
      el.appendChild(btn);
    }
    host.appendChild(el);
    return el;
  }

  return new Plugin({
    key,
    view: (view) => {
      const host = view.dom.parentElement || view.dom;
      if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
      bar = buildBar(host);
      const update = () => {
        const t = findTable(view);
        if (!t || !(t.dom instanceof HTMLElement)) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        const top = t.dom.offsetTop - bar.offsetHeight - 6;
        bar.style.top = Math.max(0, top) + 'px';
        bar.style.left = t.dom.offsetLeft + 'px';
      };
      update();
      return { update, destroy: () => { if (bar) bar.remove(); bar = null; } };
    }
  });
});
