# Temas claro/escuro + Editor WYSIWYG (Milkdown) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar temas claro/escuro e um editor visual (WYSIWYG) de Markdown baseado em Milkdown ao OKF Studio, mantendo round-trip fiel, acesso ao Markdown cru e a integridade dos arquivos `.md`.

**Architecture:** O editor Milkdown é compilado por esbuild num bundle IIFE local (`renderer/vendor/editor.bundle.js`) que expõe `window.OKFEditor` — uma API pequena que isola o app do Milkdown. O `renderer.js` controla a UI (barra de ferramentas própria, toggle Visual/Código, seletor de conceito) e os temas via variável CSS + `data-theme` no `<html>`. Arquivos reservados (`index.md`/`log.md`) continuam só em modo Código.

**Tech Stack:** Electron 42, Milkdown 7.21.x (`@milkdown/core` + presets commonmark/gfm + plugins history/listener/clipboard/slash + utils), esbuild, CSS variables.

---

## Visão geral de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/editor/index.js` | Encapsular Milkdown; exportar a API do editor | Criar |
| `renderer/vendor/editor.bundle.js` | Bundle IIFE gerado (não versionado) | Gerado por build |
| `package.json` | deps Milkdown/esbuild + scripts de build | Modificar |
| `.gitignore` | ignorar `renderer/vendor/` | Modificar |
| `renderer/index.html` | barra do editor, host do Milkdown, botão de tema, `<script>` do vendor | Modificar |
| `renderer/styles.css` | paleta clara (`[data-theme=light]`) + estilos da barra + estilos do Milkdown | Modificar |
| `renderer/renderer.js` | tema, integração do editor, toggle, seletor de conceito | Modificar |
| `test-renderer.js` | smoke test estendido (round-trip, tema, insert) | Modificar |

---

## Task 1: Temas claro/escuro

Independente do editor. Entrega um ganho isolado e testável.

**Files:**
- Modify: `renderer/styles.css` (adicionar paleta clara + estilo do botão)
- Modify: `renderer/index.html` (botão de tema na barra)
- Modify: `renderer/renderer.js` (lógica de tema + correção do grafo)
- Test: `test-renderer.js` (verificar `data-theme`)

- [ ] **Step 1: Escrever a asserção de tema (falha primeiro)**

Em `test-renderer.js`, dentro do objeto retornado pelo `executeJavaScript` (junto aos demais campos `result.*`), adicionar a verificação de que alternar o tema muda o atributo `data-theme` do `<html>`:

```js
    themeToggle: (() => {
      const before = document.documentElement.getAttribute('data-theme');
      window.__okfSetTheme && window.__okfSetTheme(before === 'light' ? 'dark' : 'light');
      const after = document.documentElement.getAttribute('data-theme');
      window.__okfSetTheme && window.__okfSetTheme(before || 'dark');
      return !!(before !== null && after !== null && before !== after);
    })(),
```

E somar `themeToggle` à condição de PASS e ao log:

```js
  const okTheme = result.themeToggle === true;
  // ...
  console.log('  theme toggle muda data-theme:', result.themeToggle);
```

Atualizar a linha do veredito para incluir `okTheme`:

```js
  console.log(okGlobals && okBridge && okRender && okTheme && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');
  app.exit(okGlobals && okBridge && okRender && okTheme && cspViolations.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `npm run test:ui`
Expected: `RESULT: FAIL` (e `theme toggle muda data-theme: false`), porque `window.__okfSetTheme` ainda não existe.

- [ ] **Step 3: Adicionar a paleta clara e o estilo do botão no CSS**

Em `renderer/styles.css`, logo após o bloco `:root{...}` (após a linha `}` que fecha o `:root`), inserir a paleta clara:

```css
:root[data-theme="light"]{
  --bg:#f6f7f9; --panel:#ffffff; --panel2:#eef0f4; --line:#d8dce3;
  --text:#1c1e22; --muted:#5b6270; --accent:#2f6fe0; --accent2:#6b4dff;
  --good:#1f9d6b; --warn:#b9791f; --bad:#d24b4b;
  --chip:#e7eaf0;
}
```

Ainda em `renderer/styles.css`, após a regra `.brand .ver{...}` (criada antes), adicionar o estilo do botão de tema:

```css
#btn-theme{font-size:14px;line-height:1;padding:6px 9px}
```

- [ ] **Step 4: Adicionar o botão de tema no HTML**

Em `renderer/index.html`, dentro de `<div class="tools">`, logo antes de `<button id="btn-update" ...>`, inserir:

```html
      <button id="btn-theme" title="Alternar tema claro/escuro">🌙</button>
```

- [ ] **Step 5: Implementar a lógica de tema no renderer**

Em `renderer/renderer.js`, adicionar perto do topo (após a definição de `state` e antes de `marked.setOptions`) o bloco de tema:

```js
/* ---------- Tema (claro/escuro) ---------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) { btn.textContent = theme === 'light' ? '☀' : '🌙'; }
  try { localStorage.setItem('okf-theme', theme); } catch (e) {}
}
function initTheme() {
  let theme;
  try { theme = localStorage.getItem('okf-theme'); } catch (e) {}
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(theme);
}
function toggleTheme() { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); }
window.__okfSetTheme = applyTheme; // usado pelo smoke test
```

Em `renderer/renderer.js`, dentro de `init()`, junto às outras ligações de botões (ex.: após `$('btn-open').onclick = openFolder;`), adicionar:

```js
  $('btn-theme').onclick = toggleTheme;
```

E ainda em `init()`, antes de `loadVersion();`, chamar a inicialização do tema:

```js
  initTheme();
```

- [ ] **Step 6: Corrigir a cor "hardcoded" do grafo Cytoscape para o tema**

Em `renderer/renderer.js`, na função `showGraph()`, substituir as duas ocorrências de cor fixa do rótulo dos nós. Trocar este trecho do estilo do nó:

```js
        'text-background-color': '#1e1f23', 'text-background-opacity': 0.85,
```

por (lendo a variável do tema atual):

```js
        'text-background-color': getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1e1f23',
        'text-background-opacity': 0.85,
```

- [ ] **Step 7: Rodar o teste e confirmar PASS**

Run: `npm run test:ui`
Expected: `RESULT: PASS` e `theme toggle muda data-theme: true`.

- [ ] **Step 8: Verificar visualmente (opcional, recomendado)**

Run: `npm start` e clicar no botão 🌙/☀ — a interface deve alternar claro/escuro; fechar o app.

- [ ] **Step 9: Commit**

```bash
git add renderer/styles.css renderer/index.html renderer/renderer.js test-renderer.js
git commit -m "feat: temas claro/escuro com toggle e preferência do sistema"
```

---

## Task 2: Build do editor (esbuild + dependências Milkdown)

Prepara o pipeline de build. Ao fim desta task existe um `window.OKFEditor` mínimo (só `ping`) provando que o bundle carrega sob CSP.

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `.gitignore` (vendor)
- Create: `src/editor/index.js` (stub mínimo)
- Modify: `renderer/index.html` (incluir o bundle)
- Test: `test-renderer.js` (verificar `window.OKFEditor`)

- [ ] **Step 1: Instalar dependências**

Run:
```bash
npm install --save @milkdown/core@^7.21.2 @milkdown/preset-commonmark@^7.21.2 @milkdown/preset-gfm@^7.21.2 @milkdown/plugin-history@^7.21.2 @milkdown/plugin-listener@^7.21.2 @milkdown/plugin-clipboard@^7.21.2 @milkdown/plugin-slash@^7.21.2 @milkdown/utils@^7.21.2 @milkdown/ctx@^7.21.2 @milkdown/prose@^7.21.2
npm install --save-dev esbuild
```
Expected: instala sem erros; `npm audit` sem novas vulnerabilidades de severidade alta.

- [ ] **Step 2: Ignorar o vendor gerado**

Em `.gitignore`, adicionar uma linha ao final:

```
renderer/vendor/
```

- [ ] **Step 3: Criar o stub do módulo do editor**

Create `src/editor/index.js`:

```js
// Módulo do editor (Milkdown) empacotado por esbuild como window.OKFEditor.
export function ping() { return 'okf-editor-ready'; }
```

- [ ] **Step 4: Adicionar os scripts de build no package.json**

Em `package.json`, no objeto `scripts`, ajustar/adicionar (substituindo as linhas `dist` e `publish` existentes e somando `build:editor` e `prestart`):

```json
    "build:editor": "esbuild src/editor/index.js --bundle --format=iife --global-name=OKFEditor --outfile=renderer/vendor/editor.bundle.js --legal-comments=none",
    "prestart": "npm run build:editor",
    "dist": "npm run build:editor && electron-builder --win --x64",
    "dist:portable": "npm run build:editor && electron-builder --win portable --x64",
    "publish": "npm run build:editor && electron-builder --win --x64 --publish always",
```

- [ ] **Step 5: Garantir o vendor no pacote do electron-builder**

Em `package.json`, no array `build.files`, adicionar a entrada do vendor (após `"renderer/**/*"`):

```json
      "renderer/vendor/**/*",
```

(Observação: `renderer/**/*` já cobre, mas a entrada explícita documenta a dependência do build.)

- [ ] **Step 6: Rodar o build do editor**

Run: `npm run build:editor`
Expected: cria `renderer/vendor/editor.bundle.js` sem erros.

- [ ] **Step 7: Incluir o bundle no HTML**

Em `renderer/index.html`, na lista de `<script>` no fim do `<body>`, adicionar **antes** de `<script src="renderer.js"></script>`:

```html
  <script src="vendor/editor.bundle.js"></script>
```

- [ ] **Step 8: Escrever a asserção de presença do OKFEditor (falha primeiro)**

Em `test-renderer.js`, no objeto do `executeJavaScript`, adicionar:

```js
    editorGlobal: !!(window.OKFEditor && typeof window.OKFEditor.ping === 'function' && window.OKFEditor.ping() === 'okf-editor-ready'),
```

Somar à condição de PASS e ao log:

```js
  const okEditor = result.editorGlobal === true;
  console.log('  window.OKFEditor presente:', result.editorGlobal);
```

E incluir `okEditor` nas duas linhas do veredito (`okGlobals && okBridge && okRender && okTheme && okEditor && ...`).

- [ ] **Step 9: Rodar o teste e confirmar PASS**

Run: `npm run test:ui`
Expected: `RESULT: PASS` e `window.OKFEditor presente: true`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore src/editor/index.js renderer/index.html test-renderer.js
git commit -m "build: pipeline esbuild + dependências Milkdown e stub do editor"
```

---

## Task 3: API do editor Milkdown (create/get/set/destroy + onChange)

Substitui o stub pela integração real. Ainda sem tocar na UI de edição.

**Files:**
- Modify: `src/editor/index.js` (implementação real)
- Test: `test-renderer.js` (round-trip)

- [ ] **Step 1: Escrever a asserção de round-trip (falha primeiro)**

Em `test-renderer.js`, **após** o `executeJavaScript` que coleta `result`, adicionar um segundo bloco assíncrono que cria um editor temporário e verifica o round-trip. Inserir logo antes da linha `const okGlobals = ...`:

```js
  const roundtrip = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const md = '# Título\\n\\nTexto **negrito** e *itálico*.\\n\\n- item A\\n- item B\\n\\n- [ ] tarefa\\n\\n| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n\\n[Atlas](/projetos/atlas.md)\\n';
    await window.OKFEditor.create(host, md, {});
    const out = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    host.remove();
    return {
      heading: /# Título/.test(out),
      bold: /\\*\\*negrito\\*\\*/.test(out),
      list: /- item A/.test(out),
      task: /- \\[[ xX]\\] tarefa/.test(out),
      table: /\\| a \\| b \\|/.test(out),
      link: /\\]\\(\\/projetos\\/atlas\\.md\\)/.test(out)
    };
  })()`);
  const okRound = roundtrip && roundtrip.heading && roundtrip.bold && roundtrip.list && roundtrip.task && roundtrip.table && roundtrip.link;
  console.log('  round-trip Markdown:', JSON.stringify(roundtrip));
```

Incluir `okRound` nas duas linhas do veredito (`... && okEditor && okRound && ...`).

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `npm run test:ui`
Expected: FAIL — `window.OKFEditor.create is not a function` (ainda é o stub).

- [ ] **Step 3: Implementar a API real do editor**

Substituir todo o conteúdo de `src/editor/index.js` por:

```js
// Módulo do editor (Milkdown) empacotado por esbuild como window.OKFEditor.
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core';
import {
  commonmark,
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, createCodeBlockCommand, insertHrCommand,
  insertImageCommand, toggleLinkCommand, turnIntoTextCommand
} from '@milkdown/preset-commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/preset-gfm';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { clipboard } from '@milkdown/plugin-clipboard';
import { callCommand, getMarkdown as getMd, replaceAll, insert } from '@milkdown/utils';

let editor = null;

export async function create(container, markdown, opts = {}) {
  await destroy();
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown || '');
      ctx.get(listenerCtx).markdownUpdated((_ctx, md) => { if (opts.onChange) opts.onChange(md); });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .create();
  return editor;
}

export function getMarkdown() {
  if (!editor) return '';
  return editor.action(getMd());
}

export function setMarkdown(md) {
  if (!editor) return;
  editor.action(replaceAll(md || ''));
}

const COMMANDS = {
  bold: [toggleStrongCommand],
  italic: [toggleEmphasisCommand],
  strike: [toggleStrikethroughCommand],
  codeInline: [toggleInlineCodeCommand],
  h1: [wrapInHeadingCommand, 1],
  h2: [wrapInHeadingCommand, 2],
  h3: [wrapInHeadingCommand, 3],
  bulletList: [wrapInBulletListCommand],
  orderedList: [wrapInOrderedListCommand],
  blockquote: [wrapInBlockquoteCommand],
  codeBlock: [createCodeBlockCommand],
  hr: [insertHrCommand],
  table: [insertTableCommand],
  undo: [undoCommand],
  redo: [redoCommand],
  clear: [turnIntoTextCommand]
};

export function runCommand(name) {
  if (!editor || !COMMANDS[name]) return;
  const [cmd, payload] = COMMANDS[name];
  editor.action(callCommand(cmd.key, payload));
}

export function taskList() {
  if (!editor) return;
  editor.action(insert('- [ ] '));
}

export function link(href) {
  if (!editor || !href) return;
  editor.action(callCommand(toggleLinkCommand.key, { href }));
}

export function image(src) {
  if (!editor || !src) return;
  editor.action(callCommand(insertImageCommand.key, { src }));
}

export function insertConceptLink(path, title) {
  if (!editor) return;
  const p = path.startsWith('/') ? path : '/' + path;
  editor.action(insert('[' + (title || path) + '](' + p + ')', true));
}

export function focus() {
  if (!editor) return;
  editor.action((ctx) => { ctx.get(editorViewCtx).focus(); });
}

export function setTheme(theme) {
  // O editor herda as variáveis CSS do tema via [data-theme]; nada a fazer.
  void theme;
}

export async function destroy() {
  if (editor) { await editor.destroy(); editor = null; }
}
```

- [ ] **Step 4: Rebuild e rodar o teste**

Run: `npm run build:editor && npm run test:ui`
Expected: `RESULT: PASS` com `round-trip Markdown: {"heading":true,"bold":true,"list":true,"task":true,"table":true,"link":true}`.

Se algum campo vier `false`, inspecionar o `out` real (adicionar `out` ao objeto retornado e rodar de novo) e ajustar — p. ex. o util `insert` aceita `(markdown, inline)`; se `task` falhar, conferir se o GFM está ativo no `.use(gfm)`.

- [ ] **Step 5: Commit**

```bash
git add src/editor/index.js test-renderer.js
git commit -m "feat: API do editor Milkdown (round-trip de Markdown)"
```

---

## Task 4: Integrar o editor no modo de edição + toggle Visual/Código

Liga o Milkdown ao fluxo real de edição de conceitos.

**Files:**
- Modify: `renderer/index.html` (host do Milkdown + barra mínima do modo)
- Modify: `renderer/styles.css` (estilos do host e do Milkdown)
- Modify: `renderer/renderer.js` (enterEdit/saveEdit/cancelEdit/toggle)

- [ ] **Step 1: Adicionar o host do editor e a barra de modo no HTML**

Em `renderer/index.html`, dentro de `<div id="edit-mode" class="hidden">`, **substituir** o bloco do corpo. Localizar:

```html
          <label class="body-label">Corpo (Markdown)</label>
          <textarea id="e-body" class="body-editor" spellcheck="false"></textarea>
```

e trocar por:

```html
          <div id="editor-toolbar" class="editor-toolbar">
            <span class="seg">
              <button id="mode-visual" type="button" class="on">👁 Visual</button>
              <button id="mode-source" type="button">&lt;&gt; Código</button>
            </span>
          </div>
          <div id="milkdown" class="milkdown-host"></div>
          <textarea id="e-body" class="body-editor hidden" spellcheck="false"></textarea>
```

- [ ] **Step 2: Estilos do host e do conteúdo do Milkdown**

Em `renderer/styles.css`, após a regra `.body-editor{...}`, adicionar:

```css
/* editor wysiwyg */
.editor-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  border:1px solid var(--line);border-bottom:none;border-radius:8px 8px 0 0;
  padding:6px;background:var(--panel)}
.editor-toolbar .seg{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.editor-toolbar .seg button{border:none;border-radius:0;background:var(--panel2)}
.editor-toolbar .seg button.on{background:var(--accent);color:#fff}
.editor-toolbar button{font-size:12px;padding:4px 8px}
.editor-toolbar .tb-sep{width:1px;height:18px;background:var(--line);margin:0 2px}
.editor-toolbar .tb-concept{margin-left:auto;background:var(--good);color:#06281c;
  border-color:var(--good);font-weight:600}
.milkdown-host{border:1px solid var(--line);border-radius:0 0 8px 8px;min-height:42vh;
  padding:6px 12px;background:var(--bg);overflow:auto}
.milkdown-host .ProseMirror{outline:none;line-height:1.6;min-height:38vh}
.milkdown-host .ProseMirror h1,.milkdown-host .ProseMirror h2,.milkdown-host .ProseMirror h3{
  border-bottom:1px solid var(--line);padding-bottom:4px}
.milkdown-host .ProseMirror a{color:var(--accent)}
.milkdown-host .ProseMirror table{border-collapse:collapse}
.milkdown-host .ProseMirror th,.milkdown-host .ProseMirror td{border:1px solid var(--line);padding:6px 10px}
.milkdown-host .ProseMirror pre{background:var(--panel2);padding:10px;border-radius:8px;overflow:auto}
.milkdown-host .ProseMirror blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:2px 12px;color:var(--muted)}
.milkdown-host .ProseMirror code{background:var(--panel2);padding:1px 5px;border-radius:4px}
```

- [ ] **Step 3: Adicionar estado do editor e reescrever `enterEdit`**

Em `renderer/renderer.js`, no objeto `state` (topo), adicionar dois campos:

```js
  editorMode: 'visual',  // 'visual' | 'source'
  editorBody: '',        // markdown corrente quando em modo visual
```

Substituir a função `enterEdit()` inteira por:

```js
async function enterEdit() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc) return;
  state.editing = true;
  $('render-mode').classList.add('hidden');
  $('edit-mode').classList.remove('hidden');
  $('btn-edit').classList.add('hidden');
  $('btn-save').classList.remove('hidden');
  $('btn-cancel').classList.remove('hidden');

  const p = OKF.parse(doc.content);
  const f = p.frontmatter;
  const reserved = doc.reserved;
  $('edit-mode').querySelector('.edit-grid').style.display = reserved ? 'none' : '';
  $('extra-fm').style.display = reserved ? 'none' : '';

  if (reserved) {
    // Reservados: só modo Código (conteúdo bruto completo), barra do editor oculta.
    $('editor-toolbar').classList.add('hidden');
    $('milkdown').classList.add('hidden');
    $('e-body').classList.remove('hidden');
    $('e-body').value = doc.content;
    return;
  }

  $('editor-toolbar').classList.remove('hidden');
  $('e-type').value = f.type || '';
  $('e-title').value = f.title || '';
  $('e-description').value = f.description || '';
  $('e-resource').value = f.resource || '';
  $('e-tags').value = Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '');
  $('e-timestamp').value = f.timestamp ? String(f.timestamp) : '';
  const known = ['type','title','description','resource','tags','timestamp'];
  const extra = {};
  Object.keys(f).forEach(k => { if (!known.includes(k)) extra[k] = f[k]; });
  $('e-extra').value = Object.keys(extra).length ? jsyaml.dump(extra).replace(/\n$/,'') : '';

  // Inicia em modo Visual com o corpo do conceito.
  state.editorBody = p.body || '';
  state.editorMode = 'visual';
  $('e-body').classList.add('hidden');
  $('milkdown').classList.remove('hidden');
  setModeButtons('visual');
  await window.OKFEditor.create($('milkdown'), state.editorBody, {
    onChange: (md) => { state.editorBody = md; }
  });
}
```

- [ ] **Step 4: Funções de modo (Visual/Código) e helper de leitura do corpo**

Em `renderer/renderer.js`, adicionar (após `enterEdit`):

```js
function setModeButtons(mode) {
  $('mode-visual').classList.toggle('on', mode === 'visual');
  $('mode-source').classList.toggle('on', mode === 'source');
}

async function setEditorMode(mode) {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc || doc.reserved || mode === state.editorMode) return;
  if (mode === 'source') {
    // Visual -> Código: pega o markdown atual e mostra a textarea.
    state.editorBody = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    $('milkdown').classList.add('hidden');
    $('e-body').value = state.editorBody;
    $('e-body').classList.remove('hidden');
  } else {
    // Código -> Visual: recria o editor com o markdown da textarea.
    state.editorBody = $('e-body').value;
    $('e-body').classList.add('hidden');
    $('milkdown').classList.remove('hidden');
    await window.OKFEditor.create($('milkdown'), state.editorBody, {
      onChange: (md) => { state.editorBody = md; }
    });
  }
  state.editorMode = mode;
  setModeButtons(mode);
}

// Markdown do corpo conforme o modo ativo (para salvar).
function currentBodyMarkdown(doc) {
  if (doc.reserved) return $('e-body').value;
  if (state.editorMode === 'source') return $('e-body').value;
  return window.OKFEditor.getMarkdown();
}
```

- [ ] **Step 5: Atualizar `saveEdit` para usar o corpo do editor**

Em `renderer/renderer.js`, na função `saveEdit`, **substituir** as duas atribuições de `content`. Trocar:

```js
  if (doc.reserved) {
    content = $('e-body').value;
  } else {
```

mantendo o restante, e dentro do `else`, trocar a linha:

```js
    content = OKF.serialize(fm, $('e-body').value);
```

por:

```js
    content = OKF.serialize(fm, currentBodyMarkdown(doc));
```

E a linha do reservado:

```js
    content = $('e-body').value;
```

por:

```js
    content = currentBodyMarkdown(doc);
```

Ainda em `saveEdit`, ao final do `try` (após `state.editing = false;` e antes de `renderConcept(doc);`), liberar o editor:

```js
    if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
```

- [ ] **Step 6: Atualizar `cancelEdit` para destruir o editor**

Em `renderer/renderer.js`, substituir a função `cancelEdit()` por:

```js
async function cancelEdit() {
  state.editing = false;
  const doc = state.docs.find(d => d.relPath === state.current);
  if (window.OKFEditor) { await window.OKFEditor.destroy(); }
  renderConcept(doc);
}
```

- [ ] **Step 7: Ligar os botões de modo no `init()`**

Em `renderer/renderer.js`, dentro de `init()`, junto às demais ligações, adicionar:

```js
  $('mode-visual').onclick = () => setEditorMode('visual');
  $('mode-source').onclick = () => setEditorMode('source');
```

- [ ] **Step 8: Garantir destruição ao trocar de documento**

Em `renderer/renderer.js`, no início de `openDoc(relPath)`, antes de `const doc = ...`, adicionar:

```js
  if (state.editing && window.OKFEditor) { window.OKFEditor.destroy(); state.editing = false; }
```

- [ ] **Step 9: Verificar manualmente**

Run: `npm start`
- Abrir a biblioteca de exemplo, abrir um conceito, clicar **✎ Editar** → deve aparecer a barra Visual/Código e o conteúdo renderizado editável.
- Alternar **<> Código** → mostra o Markdown cru; voltar para **👁 Visual** → re-renderiza.
- Editar algo, **💾 Salvar** → grava; reabrir confirma a alteração.
- Editar `index.md` (reservado) → só textarea (Código), frontmatter preservado ao salvar.
Fechar o app.

- [ ] **Step 10: Rodar os smoke tests**

Run: `npm run test:ui`
Expected: `RESULT: PASS` (sem regressões; sem violações de CSP).

- [ ] **Step 11: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js
git commit -m "feat: editor WYSIWYG no modo de edição com toggle Visual/Código"
```

---

## Task 5: Barra de ferramentas de formatação

Adiciona os botões de formatação que chamam `runCommand`.

**Files:**
- Modify: `renderer/index.html` (botões na barra)
- Modify: `renderer/renderer.js` (ligações dos botões)

- [ ] **Step 1: Adicionar os botões na barra**

Em `renderer/index.html`, dentro de `<div id="editor-toolbar" ...>`, **após** o `<span class="seg">…</span>` (o segmento Visual/Código), adicionar:

```html
            <span class="tb-sep"></span>
            <button type="button" data-cmd="undo" title="Desfazer (Ctrl+Z)">↶</button>
            <button type="button" data-cmd="redo" title="Refazer (Ctrl+Y)">↷</button>
            <span class="tb-sep"></span>
            <button type="button" data-cmd="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
            <button type="button" data-cmd="strike" title="Tachado"><s>S</s></button>
            <button type="button" data-cmd="codeInline" title="Código inline">&lt;&gt;</button>
            <span class="tb-sep"></span>
            <button type="button" data-cmd="h1" title="Título 1">H1</button>
            <button type="button" data-cmd="h2" title="Título 2">H2</button>
            <button type="button" data-cmd="h3" title="Título 3">H3</button>
            <span class="tb-sep"></span>
            <button type="button" data-cmd="bulletList" title="Lista">•</button>
            <button type="button" data-cmd="orderedList" title="Lista numerada">1.</button>
            <button type="button" data-cmd="taskList" title="Lista de tarefas">☑</button>
            <button type="button" data-cmd="blockquote" title="Citação">&ldquo;</button>
            <button type="button" data-cmd="table" title="Tabela">⊞</button>
            <button type="button" data-cmd="codeBlock" title="Bloco de código">{ }</button>
            <button type="button" data-cmd="hr" title="Linha horizontal">—</button>
            <span class="tb-sep"></span>
            <button type="button" data-cmd="link" title="Link">🔗</button>
            <button type="button" data-cmd="image" title="Imagem (URL)">🖼</button>
            <button type="button" data-cmd="clear" title="Limpar formatação (parágrafo)">⌫</button>
            <button type="button" id="tb-concept" class="tb-concept" title="Inserir link para um conceito da biblioteca">🔗 Inserir conceito</button>
```

- [ ] **Step 2: Ligar os botões no `init()`**

Em `renderer/renderer.js`, dentro de `init()`, adicionar:

```js
  document.querySelectorAll('#editor-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => runToolbar(btn.dataset.cmd));
  });
```

- [ ] **Step 3: Implementar `runToolbar`**

Em `renderer/renderer.js`, adicionar (perto de `setEditorMode`):

```js
function runToolbar(cmd) {
  if (state.editorMode !== 'visual' || !window.OKFEditor) return;
  if (cmd === 'taskList') { window.OKFEditor.taskList(); window.OKFEditor.focus(); return; }
  if (cmd === 'link') {
    const href = window.prompt('URL do link:');
    if (href) window.OKFEditor.link(href);
    window.OKFEditor.focus(); return;
  }
  if (cmd === 'image') {
    const src = window.prompt('URL da imagem:');
    if (src) window.OKFEditor.image(src);
    window.OKFEditor.focus(); return;
  }
  window.OKFEditor.runCommand(cmd);
  window.OKFEditor.focus();
}
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm start` → em um conceito, entrar em Editar (Visual) e testar: negrito, itálico, H1/H2/H3, listas, tarefas (☑), citação, tabela (⊞), bloco de código, linha (—), link, imagem, desfazer/refazer. Salvar e confirmar que o Markdown reflete as mudanças. Fechar.

- [ ] **Step 5: Rodar smoke test**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat: barra de ferramentas de formatação do editor"
```

---

## Task 6: Seletor "Inserir conceito"

Reusa o estilo de modal do app para inserir links internos válidos.

**Files:**
- Modify: `renderer/index.html` (modal do seletor)
- Modify: `renderer/styles.css` (lista do seletor)
- Modify: `renderer/renderer.js` (abrir/buscar/inserir)
- Test: `test-renderer.js` (insertConceptLink)

- [ ] **Step 1: Escrever a asserção de insertConceptLink (falha primeiro)**

Em `test-renderer.js`, no bloco `roundtrip` (Task 3), antes do `const out = ...`, inserir uma chamada e capturar o resultado. Substituir:

```js
    const out = window.OKFEditor.getMarkdown();
```

por:

```js
    window.OKFEditor.insertConceptLink('/processos/onboarding-cliente.md', 'Onboarding');
    const out = window.OKFEditor.getMarkdown();
```

E adicionar ao objeto retornado do bloco `roundtrip`:

```js
      concept: /\\[Onboarding\\]\\(\\/processos\\/onboarding-cliente\\.md\\)/.test(out),
```

Incluir `roundtrip.concept` na composição de `okRound`.

- [ ] **Step 2: Rodar e confirmar PASS do insert (a API já existe da Task 3)**

Run: `npm run build:editor && npm run test:ui`
Expected: `RESULT: PASS` com `concept` verdadeiro no JSON do round-trip. (Se falhar, conferir o parâmetro `inline` do util `insert`.)

- [ ] **Step 3: Adicionar o modal do seletor no HTML**

Em `renderer/index.html`, **após** o `<div id="modal" ...>...</div>` (modal de novo conceito), adicionar:

```html
  <div id="concept-modal" class="modal hidden">
    <div class="modal-card">
      <h2>Inserir link para conceito</h2>
      <input id="cm-search" type="search" placeholder="Buscar conceito por título ou caminho…" />
      <div id="cm-list" class="cm-list"></div>
      <div class="modal-actions">
        <button id="cm-cancel">Cancelar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Estilo da lista**

Em `renderer/styles.css`, após o bloco `/* modal */`, adicionar:

```css
.cm-list{max-height:46vh;overflow:auto;margin:10px 0;border:1px solid var(--line);border-radius:8px}
.cm-list .cm-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--line)}
.cm-list .cm-item:last-child{border-bottom:none}
.cm-list .cm-item:hover{background:var(--panel2)}
.cm-list .cm-item .cm-title{font-weight:600}
.cm-list .cm-item .cm-path{font-size:11px;color:var(--muted)}
.cm-list .cm-empty{padding:10px;color:var(--muted)}
```

- [ ] **Step 5: Lógica do seletor**

Em `renderer/renderer.js`, adicionar (perto de `runToolbar`):

```js
function openConceptPicker() {
  if (state.editorMode !== 'visual') { toast('Disponível no modo Visual.', 'bad'); return; }
  $('cm-search').value = '';
  renderConceptList('');
  $('concept-modal').classList.remove('hidden');
  $('cm-search').focus();
}
function closeConceptPicker(){ $('concept-modal').classList.add('hidden'); }

function renderConceptList(q) {
  const ql = (q || '').toLowerCase().trim();
  const list = $('cm-list');
  const items = state.docs
    .filter(d => !d.reserved && d.relPath !== state.current)
    .map(d => {
      const f = parsedOf(d).frontmatter;
      return { relPath: d.relPath, title: f.title || d.name.replace(/\.md$/i,'') };
    })
    .filter(it => !ql || it.title.toLowerCase().includes(ql) || it.relPath.toLowerCase().includes(ql))
    .sort((a,b) => a.title.localeCompare(b.title));
  if (!items.length) { list.innerHTML = '<div class="cm-empty">Nenhum conceito encontrado.</div>'; return; }
  list.innerHTML = items.map(it =>
    `<div class="cm-item" data-rel="${escapeAttr(it.relPath)}" data-title="${escapeAttr(it.title)}">
       <div class="cm-title">${escapeHtml(it.title)}</div>
       <div class="cm-path">/${escapeHtml(it.relPath)}</div>
     </div>`).join('');
  list.querySelectorAll('.cm-item').forEach(el => el.addEventListener('click', () => {
    window.OKFEditor.insertConceptLink('/' + el.dataset.rel, el.dataset.title);
    closeConceptPicker();
    window.OKFEditor.focus();
  }));
}
```

- [ ] **Step 6: Ligar no `init()`**

Em `renderer/renderer.js`, dentro de `init()`, adicionar:

```js
  $('tb-concept').onclick = openConceptPicker;
  $('cm-cancel').onclick = closeConceptPicker;
  $('cm-search').addEventListener('input', e => renderConceptList(e.target.value));
```

E, no listener de `keydown` existente (que trata `Escape`), o fechamento do modal já cobre via `closeModal()`; adicionar também o fechamento do seletor. Localizar a linha que começa com `if (e.key === 'Escape') { closeModal();` e inserir logo após `closeModal();`:

```js
 closeConceptPicker();
```

- [ ] **Step 7: Verificar manualmente**

Run: `npm start` → em Editar (Visual), clicar **🔗 Inserir conceito**, buscar e escolher um conceito → insere o link; salvar e confirmar o Markdown `[Título](/caminho.md)`. Fechar.

- [ ] **Step 8: Rodar smoke test**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 9: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js test-renderer.js
git commit -m "feat: seletor de conceitos para inserir links internos"
```

---

## Task 7: Menu de barra "/" (slash) — incremental

Inserção de blocos digitando "/". Tarefa final; se algo falhar aqui, as anteriores já entregam o valor principal.

**Files:**
- Modify: `src/editor/index.js` (plugin slash + menu)
- Modify: `renderer/styles.css` (estilo do menu)

- [ ] **Step 1: Implementar o menu slash no módulo do editor**

Em `src/editor/index.js`, adicionar o import do slash no topo (junto aos demais):

```js
import { slashFactory, SlashProvider } from '@milkdown/plugin-slash';
```

Ainda em `src/editor/index.js`, antes de `let editor = null;`, criar a fábrica e o provider:

```js
const slash = slashFactory('okf-slash');
let slashProvider = null;

const SLASH_ITEMS = [
  { label: 'Título 1', run: () => runCommand('h1') },
  { label: 'Título 2', run: () => runCommand('h2') },
  { label: 'Lista', run: () => runCommand('bulletList') },
  { label: 'Lista numerada', run: () => runCommand('orderedList') },
  { label: 'Tarefas', run: () => taskList() },
  { label: 'Citação', run: () => runCommand('blockquote') },
  { label: 'Tabela', run: () => runCommand('table') },
  { label: 'Bloco de código', run: () => runCommand('codeBlock') },
  { label: 'Linha horizontal', run: () => runCommand('hr') }
];
```

No `.config((ctx) => { ... })` do `create`, adicionar a configuração do slash (após a linha do `listenerCtx`):

```js
      ctx.set(slash.key, {
        view: (view) => {
          const content = document.createElement('div');
          content.className = 'okf-slash-menu';
          SLASH_ITEMS.forEach((it) => {
            const el = document.createElement('div');
            el.className = 'okf-slash-item';
            el.textContent = it.label;
            el.addEventListener('mousedown', (e) => {
              e.preventDefault();
              // remove o caractere "/" que disparou o menu
              const { state, dispatch } = view;
              const { from } = state.selection;
              dispatch(state.tr.delete(from - 1, from));
              it.run();
              slashProvider && slashProvider.hide();
              focus();
            });
            content.appendChild(el);
          });
          slashProvider = new SlashProvider({ content });
          slashProvider.onShow = () => {};
          return {
            update: (updatedView, prevState) => { slashProvider.update(updatedView, prevState); },
            destroy: () => { slashProvider.destroy(); slashProvider = null; }
          };
        }
      });
```

E registrar o plugin: na cadeia `.use(...)` do `create`, adicionar `.use(slash)` (após `.use(clipboard)`).

- [ ] **Step 2: Estilo do menu slash**

Em `renderer/styles.css`, após o bloco do editor wysiwyg, adicionar:

```css
.okf-slash-menu{background:var(--panel);border:1px solid var(--line);border-radius:8px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:180px;overflow:hidden}
.okf-slash-item{padding:7px 12px;cursor:pointer;font-size:13px;color:var(--text)}
.okf-slash-item:hover{background:var(--accent);color:#fff}
```

- [ ] **Step 3: Rebuild e verificar manualmente**

Run: `npm run build:editor && npm start`
- Em Editar (Visual), numa linha vazia digitar `/` → o menu aparece; escolher "Tabela" insere a tabela e remove o "/". Fechar.

Se o `SlashProvider`/`slashFactory` divergir da versão instalada, inspecionar os exports:
`node -e "console.log(Object.keys(require('@milkdown/plugin-slash')))"` e ajustar os nomes.

- [ ] **Step 4: Rodar smoke test (sem regressões)**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/editor/index.js renderer/styles.css
git commit -m "feat: menu de barra (/) para inserir blocos"
```

---

## Task 8: Verificação final, build de produção e README

**Files:**
- Modify: `README.md` (documentar editor + temas)

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test && npm run test:ui`
Expected: `TESTE OK` e `RESULT: PASS`.

- [ ] **Step 2: Build de produção (confirma que o build do editor entra no pacote)**

Run: `npm run dist`
Expected: gera `dist/OKF-Studio-Setup-*.exe`, `dist/OKF-Studio-Portable-*.exe` e `dist/latest.yml`; sem erros. Confirmar que `renderer/vendor/editor.bundle.js` foi gerado antes do empacotamento.

- [ ] **Step 3: Atualizar o README**

Em `README.md`, na lista de recursos ("## O que o app faz"), após a linha de "Atualizações automáticas", adicionar:

```markdown
- **Editor visual (WYSIWYG)** de Markdown (Milkdown): edição renderizada estilo
  Word, barra de ferramentas (negrito, itálico, títulos, listas, tarefas,
  citação, tabela, código, linha, link, imagem, desfazer/refazer), menu "/" e
  botão **Inserir conceito**; com toggle **Código** para o Markdown cru.
- **Temas claro e escuro** — segue o tema do Windows na 1ª abertura e alterna
  pelo botão 🌙/☀ (escolha salva).
```

Ainda no README, na seção "## Estrutura do projeto", após a linha do `renderer/`, adicionar:

```markdown
├── src/editor/          Fonte do editor Milkdown (compilado por esbuild)
├── renderer/vendor/     Bundle gerado do editor (não versionado)
```

E em "## Como rodar", após o `npm install`, observar a etapa de build:

```markdown
> O `npm start` e o `npm run dist` rodam automaticamente `npm run build:editor`
> (esbuild) para gerar `renderer/vendor/editor.bundle.js`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: editor WYSIWYG e temas no README"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Notas de verificação da API do Milkdown

Se qualquer comando/insert divergir da versão instalada (7.21.x), inspecionar os exports reais e ajustar o mapa `COMMANDS` em `src/editor/index.js`:

```bash
node -e "const c=require('@milkdown/preset-commonmark'); console.log(Object.keys(c).filter(k=>k.endsWith('Command')))"
node -e "const g=require('@milkdown/preset-gfm'); console.log(Object.keys(g).filter(k=>k.endsWith('Command')))"
node -e "const u=require('@milkdown/utils'); console.log(Object.keys(u))"
```

Nomes confirmados na 7.21.2: `toggleStrongCommand`, `toggleEmphasisCommand`, `toggleInlineCodeCommand`, `wrapInHeadingCommand`, `wrapInBulletListCommand`, `wrapInOrderedListCommand`, `wrapInBlockquoteCommand`, `createCodeBlockCommand`, `insertHrCommand`, `insertImageCommand`, `toggleLinkCommand`, `turnIntoTextCommand`, `toggleStrikethroughCommand`, `insertTableCommand`, `undoCommand`, `redoCommand`; utils `callCommand`, `getMarkdown`, `replaceAll`, `insert`.
```
