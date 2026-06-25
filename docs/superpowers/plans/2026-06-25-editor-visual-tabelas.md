# Editor visual de tabelas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barra contextual que surge acima da tabela no editor visual, com inserir/excluir/mover linhas e colunas e alinhamento — tudo em Markdown GFM puro (sem mesclagem nem cor).

**Architecture:** Um plugin ProseMirror (via `$prose` do Milkdown) num novo módulo `src/editor/table-toolbar.js` cria uma `<div class="okf-table-toolbar">` dentro do host do editor, detecta se a seleção está numa tabela, posiciona a barra acima dela e liga os botões aos comandos do `@milkdown/preset-gfm` (via `commandsCtx`). `createInstance` passa a `.use(tableToolbar)` e expõe `getView()` para teste. Cobertura por smoke Electron.

**Tech Stack:** Milkdown 7 / ProseMirror, `@milkdown/preset-gfm`, `@milkdown/prose/{state,tables}`, esbuild (bundle), Electron (smoke test).

---

## File Structure

- `src/editor/table-toolbar.js` — **criar**: plugin `$prose` (detecção + DOM da barra + posicionamento + wiring dos comandos).
- `src/editor/index.js` — **modificar**: `.use(tableToolbar)` em `createInstance`; expor `getView()` no handle.
- `renderer/styles.css` — **modificar**: estilos de `.okf-table-toolbar`.
- `test-renderer.js` — **modificar**: bloco de smoke da barra de tabela.

---

## Task 1: Módulo `table-toolbar.js` (plugin, DOM, comandos, posicionamento)

**Files:**
- Create: `src/editor/table-toolbar.js`

- [ ] **Step 1: Criar o módulo**

Criar `src/editor/table-toolbar.js` com:

```js
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
```

- [ ] **Step 2: Verificar sintaxe via build (depende da Task 2 para `.use`)**

Este módulo é exercido após a Task 2. Aqui só confira que o arquivo existe e está salvo.

---

## Task 2: Ligar o plugin e expor `getView()`

**Files:**
- Modify: `src/editor/index.js`

- [ ] **Step 1: Importar e usar o plugin**

Em `src/editor/index.js`, adicionar o import no topo (após os imports existentes):

```js
import { tableToolbar } from './table-toolbar.js';
```

Na cadeia de `.use(...)` dentro de `createInstance`, adicionar `tableToolbar` após `slash`:

```js
    .use(commonmark).use(gfm).use(history).use(listener).use(clipboard).use(slash).use(tableToolbar).create();
```

- [ ] **Step 2: Expor `getView()` no handle**

No objeto retornado por `createInstance` (junto de `getMarkdown`, `destroy`, …), adicionar:

```js
    getView: () => editor.ctx.get(editorViewCtx),
```

(`editorViewCtx` já é importado em `index.js`.)

- [ ] **Step 3: Rebuild do bundle**

Run: `npm run build:editor`
Expected: gera `renderer/vendor/editor.bundle.js` sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/editor/index.js src/editor/table-toolbar.js
git commit -m "feat(editor): barra contextual de tabela (GFM) + getView() na instância"
```

---

## Task 3: Estilos da barra

**Files:**
- Modify: `renderer/styles.css`

- [ ] **Step 1: Adicionar os estilos**

Em `renderer/styles.css`, após o bloco `.milkdown-host` (procure `.milkdown-host{`), adicionar:

```css
.okf-table-toolbar{position:absolute;z-index:20;display:flex;gap:4px;align-items:center;
  background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:4px 6px;
  box-shadow:0 4px 14px rgba(0,0,0,.3)}
.okf-table-toolbar button{font-size:12px;line-height:1;padding:3px 7px;background:var(--panel2);
  border:1px solid var(--line);border-radius:6px}
.okf-table-toolbar button:hover{border-color:var(--accent);background:var(--hover)}
.okf-table-toolbar .tb-sep{width:1px;height:16px;background:var(--line);margin:0 2px}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/styles.css
git commit -m "style(editor): barra de tabela contextual"
```

---

## Task 4: Smoke test da barra de tabela

**Files:**
- Modify: `test-renderer.js`

- [ ] **Step 1: Adicionar o bloco de teste**

Em `test-renderer.js`, logo após o bloco `const commands = ...` / `console.log('  toolbar commands:'...)` (por volta da linha 103), inserir:

```js
  const tableUI = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div'); host.className = 'milkdown-host';
    document.body.appendChild(host);
    await window.OKFEditor.create(host, '| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n\\ntexto fora\\n', {});
    const view = window.OKFEditor.getView();
    const TextSelection = view.state.selection.constructor;
    const setCursorAt = (predicate) => {
      let target = null;
      view.state.doc.descendants((node, pos) => { if (target === null && predicate(node)) target = pos + 1; });
      if (target === null) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target))));
      return true;
    };
    const bar = () => host.querySelector('.okf-table-toolbar');
    const visible = () => { const b = bar(); return !!b && b.style.display !== 'none'; };
    const click = (act) => { const b = bar().querySelector('button[data-act="'+act+'"]');
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); };

    // cursor numa célula -> barra visível
    setCursorAt(n => n.type.name === 'table_cell' || n.type.name === 'table_header');
    const visInside = visible();
    // inserir coluna à direita -> 3 colunas (3 grupos de --- na linha separadora)
    click('col-after');
    const md3 = window.OKFEditor.getMarkdown();
    const cols = (md3.match(/-{3,}/g) || []).length;
    // inserir linha abaixo -> >=4 linhas começando com '|'
    setCursorAt(n => n.type.name === 'table_cell' || n.type.name === 'table_header');
    click('row-after');
    const md4 = window.OKFEditor.getMarkdown();
    const pipeLines = (md4.match(/^\\|/gm) || []).length;
    // cursor fora da tabela -> barra oculta
    setCursorAt(n => n.type.name === 'paragraph');
    const visOutside = visible();
    // sem HTML no markdown
    const noHtml = !/<table/i.test(md4);

    await window.OKFEditor.destroy();
    host.remove();
    return { visInside, cols, pipeLines, visOutside, noHtml };
  })()`);
  const okTable = tableUI && tableUI.visInside === true && tableUI.cols === 3 &&
    tableUI.pipeLines >= 4 && tableUI.visOutside === false && tableUI.noHtml === true;
  console.log('  table toolbar:', JSON.stringify(tableUI));
```

- [ ] **Step 2: Incluir `okTable` no resultado final**

Na linha do `console.log(... ? 'RESULT: PASS' : 'RESULT: FAIL')` e na linha `app.exit(...)`, adicionar `&& okTable` à conjunção booleana (nos dois lugares):

```js
  console.log(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');

  app.exit(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && cspViolations.length === 0 ? 0 : 1);
```

- [ ] **Step 3: Rodar o smoke (precisa do bundle atualizado da Task 2)**

Run: `npm run build:editor && npm run test:ui`
Expected: saída inclui `table toolbar: {"visInside":true,"cols":3,"pipeLines":...,"visOutside":false,"noHtml":true}` e `RESULT: PASS`.

- [ ] **Step 4: Commit**

```bash
git add test-renderer.js
git commit -m "test(editor): smoke da barra contextual de tabela"
```

---

## Task 5: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: Suíte node**

Run: `npm test`
Expected: termina sem erro (mesma saída de antes; a lógica nova é coberta pelo smoke Electron).

- [ ] **Step 2: Smoke Electron**

Run: `npm run test:ui`
Expected: `RESULT: PASS`, incluindo `table toolbar`.

- [ ] **Step 3: Smoke manual**

Run: `npm start`
Checklist:
- [ ] Editar um conceito (modo Visual), inserir uma tabela; ao clicar dentro, a barra surge acima da tabela.
- [ ] Inserir/excluir coluna e linha; alinhar coluna; mover coluna/linha; excluir tabela.
- [ ] Sair da tabela esconde a barra.
- [ ] Salvar e conferir que o `.md` é GFM limpo (sem `<table>`).
- [ ] No modal de import de PDF, o mesmo comportamento funciona (instância isolada).

- [ ] **Step 4: Commit final (se necessário)**

```bash
git add -A && git commit -m "chore: verificação final editor de tabelas"
```
