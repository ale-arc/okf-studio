# Tela inicial com bibliotecas recentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao abrir o OKF Studio, mostrar uma tela de seleção com as bibliotecas recentemente abertas (nome, caminho, último acesso), com favoritas no topo, remoção da lista e detecção de pasta ausente.

**Architecture:** O processo main passa a ser dono dos "recentes", persistidos em `app.getPath('userData')/recent-libraries.json`. Um novo módulo `recents.js` (espelhando `templates.js`/`git.js`) expõe a lógica pura (ordenação, dedup, teto, favoritas) — testável em Node sem Electron — e os handlers IPC. O renderer ganha a tela inicial (reaproveitando `#empty`), grava recentes ao abrir bibliotecas e oferece "Trocar biblioteca…".

**Tech Stack:** Electron (main + preload + renderer), JavaScript puro, testes em Node com `node:assert`. Sem novas dependências.

**Spec:** `docs/superpowers/specs/2026-06-25-tela-inicial-bibliotecas-recentes-design.md`

---

## File Structure

| Arquivo | Responsabilidade |
|---------|------------------|
| `recents.js` *(novo)* | Lógica pura de recentes (sort/dedup/cap/favoritas/exists) + IO JSON + handlers IPC. |
| `test-recents.js` *(novo)* | Teste de unidade Node da lógica e do IO de `recents.js`. |
| `main.js` *(mod)* | Registrar handlers; item de menu "Trocar biblioteca…". |
| `preload.js` *(mod)* | Expor `window.okf.recents.*`; canal `menu:switch-library`. |
| `renderer/index.html` *(mod)* | Marcação da tela inicial (lista de recentes) dentro de `#empty`. |
| `renderer/renderer.js` *(mod)* | Render da lista, interações, gravar recentes ao abrir, "Trocar biblioteca", helper de data relativa, boot. |
| `renderer/styles.css` *(mod)* | Estilos da lista de recentes. |
| `package.json` *(mod)* | `recents.js` em `build.files`; `test-recents.js` no script `test`. |

---

## Task 1: Lógica pura de `recents.js` + teste

Cria o módulo só com funções puras (sem Electron) e o teste que as cobre. Já liga o teste ao `npm test`.

**Files:**
- Create: `recents.js`
- Create: `test-recents.js`
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Create `test-recents.js`:

```js
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./recents.js');

// addEntry: dedup por path; atualiza name/lastOpened; preserva favorite
{
  let list = [];
  list = R.addEntry(list, { path: '/a', name: 'A' }, 1000);
  list = R.addEntry(list, { path: '/b', name: 'B' }, 2000);
  assert.strictEqual(list.length, 2);
  list = R.toggleFavorite(list, '/a');
  list = R.addEntry(list, { path: '/a', name: 'A2' }, 3000);
  assert.strictEqual(list.length, 2, 'dedup por path');
  const a = list.find(e => e.path === '/a');
  assert.strictEqual(a.name, 'A2', 'name atualizado');
  assert.strictEqual(a.lastOpened, 3000, 'lastOpened atualizado');
  assert.strictEqual(a.favorite, true, 'favorite preservado ao reabrir');
}

// sortAndCap: favoritas no topo, demais por lastOpened desc
{
  const list = [
    { path: '/x', name: 'x', lastOpened: 10, favorite: false },
    { path: '/y', name: 'y', lastOpened: 30, favorite: false },
    { path: '/z', name: 'z', lastOpened: 20, favorite: true },
  ];
  assert.deepStrictEqual(R.sortAndCap(list).map(e => e.path), ['/z', '/y', '/x']);
}

// cap de 20 preservando favoritas
{
  const list = [];
  for (let i = 0; i < 25; i++) list.push({ path: '/p' + i, name: 'p' + i, lastOpened: i, favorite: false });
  list.push({ path: '/fav', name: 'fav', lastOpened: -1, favorite: true });
  const s = R.sortAndCap(list);
  assert.strictEqual(s.length, R.CAP, 'teto de 20');
  assert.ok(s.some(e => e.path === '/fav'), 'favorita antiga preservada');
  assert.ok(!s.some(e => e.path === '/p0'), 'não-favorita mais antiga descartada');
}

// removeEntry
{
  const list = [{ path: '/a', name: 'A' }, { path: '/b', name: 'B' }];
  assert.deepStrictEqual(R.removeEntry(list, '/a').map(e => e.path), ['/b']);
}

// enrichExists: função injetada e fs real
{
  const e = R.enrichExists([{ path: '/exists', name: 'E' }, { path: '/missing', name: 'M' }],
    (p) => p === '/exists');
  assert.strictEqual(e[0].exists, true);
  assert.strictEqual(e[1].exists, false);
  const missing = path.join(os.tmpdir(), 'okf-nao-existe-xyz');
  assert.strictEqual(R.enrichExists([{ path: missing, name: 'M' }])[0].exists, false);
}

console.log('test-recents (puro) OK');
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node test-recents.js`
Expected: FAIL — `Cannot find module './recents.js'`.

- [ ] **Step 3: Implementar `recents.js` (só funções puras)**

Create `recents.js`:

```js
'use strict';
// Bibliotecas recentes do usuário. Persistido em
// app.getPath('userData')/recent-libraries.json — gerenciado pelo processo main.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CAP = 20;

// Ordena (favoritas no topo, depois lastOpened desc) e aplica o teto CAP,
// descartando as não-favoritas mais antigas. Favoritas nunca são descartadas.
function sortAndCap(list) {
  const arr = (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    if (!!b.favorite !== !!a.favorite) return a.favorite ? -1 : 1;
    return (b.lastOpened || 0) - (a.lastOpened || 0);
  });
  if (arr.length <= CAP) return arr;
  const favs = arr.filter(e => e.favorite);
  const rest = arr.filter(e => !e.favorite).slice(0, Math.max(0, CAP - favs.length));
  const keep = new Set([...favs, ...rest]);
  return arr.filter(e => keep.has(e));
}

// Insere/atualiza por path (chave de dedup); preserva o favorite anterior.
function addEntry(list, entry, now) {
  const src = Array.isArray(list) ? list : [];
  const prev = src.find(e => e.path === entry.path);
  const arr = src.filter(e => e.path !== entry.path);
  arr.push({
    path: entry.path,
    name: entry.name,
    lastOpened: now,
    favorite: prev ? !!prev.favorite : false
  });
  return sortAndCap(arr);
}

function removeEntry(list, p) {
  return (Array.isArray(list) ? list : []).filter(e => e.path !== p);
}

function toggleFavorite(list, p) {
  const arr = (Array.isArray(list) ? list : []).map(e =>
    e.path === p ? Object.assign({}, e, { favorite: !e.favorite }) : e);
  return sortAndCap(arr);
}

// Acrescenta `exists` a cada item (não persistido). existsFn injetável p/ testes.
function enrichExists(list, existsFn) {
  const fn = existsFn || ((p) => fs.existsSync(p));
  return (Array.isArray(list) ? list : []).map(e => Object.assign({}, e, { exists: !!fn(e.path) }));
}

module.exports = { CAP, sortAndCap, addEntry, removeEntry, toggleFavorite, enrichExists };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node test-recents.js`
Expected: PASS — imprime `test-recents (puro) OK`.

- [ ] **Step 5: Ligar o teste ao `npm test`**

Modify `package.json` — na linha do script `test`, acrescente ` && node test-recents.js` ao final:

```json
"test": "node test-okf.js && node test-tipo-pasta.js && node test-convert.js && node test-watcher-error.js && node test-recents.js",
```

Run: `npm test`
Expected: PASS — todos os testes, incluindo `test-recents (puro) OK`.

- [ ] **Step 6: Commit**

```bash
git add recents.js test-recents.js package.json
git commit -m "feat(recents): lógica pura de bibliotecas recentes (sort, dedup, cap, favoritas)"
```

---

## Task 2: IO JSON + handlers IPC em `recents.js`

Acrescenta persistência (`userData/recent-libraries.json`) e os handlers IPC, mais o teste de IO com arquivo temporário.

**Files:**
- Modify: `recents.js`
- Modify: `test-recents.js`

- [ ] **Step 1: Acrescentar o teste de IO que falha**

Append ao final de `test-recents.js` (depois do `console.log('test-recents (puro) OK');`):

```js
// readStore/writeStore: round-trip com arquivo temporário
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-recents-'));
  const file = path.join(dir, 'recent-libraries.json');
  assert.deepStrictEqual(await R.readStore(file), [], 'arquivo ausente => []');
  await R.writeStore(file, [{ path: '/a', name: 'A', lastOpened: 1, favorite: true }]);
  const back = await R.readStore(file);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].path, '/a');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-recents (IO) OK');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node test-recents.js`
Expected: FAIL — `R.readStore is not a function`.

- [ ] **Step 3: Implementar IO + handlers em `recents.js`**

Em `recents.js`, **substitua a linha `module.exports = ...`** pelo bloco abaixo (acrescenta IO, handlers e o export completo):

```js
function recentsFile() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'recent-libraries.json');
}

async function readStore(file) {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return []; // arquivo ausente ou inválido => lista vazia
  }
}

async function writeStore(file, list) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(list, null, 2), 'utf8');
}

function registerRecentsHandlers(ipcMain) {
  ipcMain.handle('recents:list', async () => {
    const list = sortAndCap(await readStore(recentsFile()));
    return enrichExists(list);
  });
  ipcMain.handle('recents:add', async (_e, { path: p, name }) => {
    const file = recentsFile();
    const list = addEntry(await readStore(file), { path: p, name }, Date.now());
    await writeStore(file, list);
    return enrichExists(list);
  });
  ipcMain.handle('recents:remove', async (_e, { path: p }) => {
    const file = recentsFile();
    const list = sortAndCap(removeEntry(await readStore(file), p));
    await writeStore(file, list);
    return enrichExists(list);
  });
  ipcMain.handle('recents:toggleFavorite', async (_e, { path: p }) => {
    const file = recentsFile();
    const list = toggleFavorite(await readStore(file), p);
    await writeStore(file, list);
    return enrichExists(list);
  });
}

module.exports = {
  CAP, sortAndCap, addEntry, removeEntry, toggleFavorite, enrichExists,
  recentsFile, readStore, writeStore, registerRecentsHandlers
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node test-recents.js`
Expected: PASS — imprime `test-recents (puro) OK` e `test-recents (IO) OK`.

- [ ] **Step 5: Commit**

```bash
git add recents.js test-recents.js
git commit -m "feat(recents): persistência JSON em userData e handlers IPC"
```

---

## Task 3: Registrar no `main.js` + menu "Trocar biblioteca…" + empacotamento

**Files:**
- Modify: `main.js`
- Modify: `package.json` (`build.files`)

- [ ] **Step 1: Importar o módulo no topo do `main.js`**

Em `main.js`, logo após a linha `const { registerPdfHandlers } = require('./convert-pdf.js');`, adicione:

```js
const { registerRecentsHandlers } = require('./recents.js');
```

- [ ] **Step 2: Registrar os handlers**

Em `main.js`, logo após a linha `registerPdfHandlers(ipcMain, () => currentRoot);`, adicione:

```js
registerRecentsHandlers(ipcMain);
```

- [ ] **Step 3: Adicionar o item de menu**

Em `main.js`, dentro do submenu `Arquivo`, logo após o bloco `Nova biblioteca…` (o objeto que termina em `send('menu:new-library')`), e antes do `{ type: 'separator' }` seguinte, insira:

```js
{
  label: 'Trocar biblioteca…',
  click: () => mainWindow.webContents.send('menu:switch-library')
},
```

- [ ] **Step 4: Incluir `recents.js` no empacotamento**

Em `package.json`, dentro de `build.files`, adicione a entrada `"recents.js",` junto às outras (ex.: logo após `"templates.js",`):

```json
      "templates.js",
      "recents.js",
```

- [ ] **Step 5: Sanidade — o app principal ainda carrega**

Run: `npm test`
Expected: PASS (nenhuma regressão; `main.js` não roda nos testes, mas garante que nada quebrou).

- [ ] **Step 6: Commit**

```bash
git add main.js package.json
git commit -m "feat(recents): registrar handlers, menu Trocar biblioteca e empacotamento"
```

---

## Task 4: Expor no `preload.js`

**Files:**
- Modify: `preload.js`

- [ ] **Step 1: Adicionar a API `recents`**

Em `preload.js`, dentro do objeto exposto por `contextBridge.exposeInMainWorld('okf', { ... })`, logo após o bloco `templates: { ... }`, adicione:

```js
  recents: {
    list: () => ipcRenderer.invoke('recents:list'),
    add: (payload) => ipcRenderer.invoke('recents:add', payload),
    remove: (payload) => ipcRenderer.invoke('recents:remove', payload),
    toggleFavorite: (payload) => ipcRenderer.invoke('recents:toggleFavorite', payload)
  },
```

- [ ] **Step 2: Permitir o canal de menu novo**

Em `preload.js`, dentro do array `valid` (em `onMenu`), acrescente `'menu:switch-library'`:

```js
      'menu:rebuild-indexes', 'menu:templates', 'menu:export-pdf', 'menu:import-doc',
      'menu:switch-library'
```

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(recents): expor window.okf.recents e canal menu:switch-library"
```

---

## Task 5: Marcação da tela inicial no `index.html`

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Substituir o conteúdo de `#empty`**

Em `renderer/index.html`, substitua o bloco `#empty` inteiro (do `<div id="empty" class="empty">` ao `</div>` que o fecha, incluindo `<h1>`, os `<p>` e `.empty-actions`) por:

```html
      <div id="empty" class="empty">
        <svg class="empty-logo" viewBox="0 0 512 512" width="88" height="88" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#5340b5"/><g stroke="#fff" stroke-width="18" stroke-linecap="round"><line x1="256" y1="256" x2="406" y2="256"/><line x1="256" y1="256" x2="331" y2="386"/><line x1="256" y1="256" x2="181" y2="386"/><line x1="256" y1="256" x2="106" y2="256"/><line x1="256" y1="256" x2="181" y2="126"/><line x1="256" y1="256" x2="331" y2="126"/></g><circle cx="406" cy="256" r="26" fill="#85B7EB"/><circle cx="331" cy="386" r="26" fill="#fff"/><circle cx="181" cy="386" r="26" fill="#1D9E75"/><circle cx="106" cy="256" r="26" fill="#fff"/><circle cx="181" cy="126" r="26" fill="#fff"/><circle cx="331" cy="126" r="26" fill="#EF9F27"/><circle cx="256" cy="256" r="34" fill="#fff"/></svg>
        <h1>OKF Studio</h1>
        <p>Escolha uma biblioteca para começar.</p>
        <div id="recent-list" class="recent-list hidden"></div>
        <div class="empty-actions">
          <button id="empty-open">📂 Abrir pasta…</button>
          <button id="empty-new">🆕 Nova</button>
          <button id="empty-sample">✨ Exemplo</button>
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add renderer/index.html
git commit -m "feat(recents): marcação da tela inicial com lista de recentes"
```

---

## Task 6: Renderer — render, interações, gravar recentes, trocar biblioteca

Toda a lógica de renderer. Sem teste automatizado (wiring de DOM Electron); verificação manual na Task 8. As funções `escapeHtml`, `escapeAttr`, `baseNameOf`, `toast`, `loadBundle`, `closeOverlays` já existem em `renderer.js`.

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Helper de data relativa**

Em `renderer/renderer.js`, logo após a função `fmtTimestamp` (perto da linha 177), adicione:

```js
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
```

- [ ] **Step 2: Tela inicial e render da lista**

Em `renderer/renderer.js`, logo após o helper `relTime` adicionado acima, adicione:

```js
/* ---------- Tela inicial (bibliotecas recentes) ---------- */
async function showStart() {
  closeOverlays();
  $('viewer').classList.add('hidden');
  $('empty').classList.remove('hidden');
  let list = [];
  try { list = await window.okf.recents.list(); } catch (e) { list = []; }
  renderRecents(list);
}

function renderRecents(list) {
  const wrap = $('recent-list');
  if (!wrap) return;
  if (!list || !list.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = list.map(e => {
    const cls = 'recent-item' + (e.exists ? '' : ' missing');
    const favIcon = e.exists ? (e.favorite ? '★' : '☆') : '⚠';
    const when = e.exists ? escapeHtml(relTime(e.lastOpened)) : 'Pasta não encontrada';
    return `<div class="${cls}" data-path="${escapeAttr(e.path)}" data-name="${escapeAttr(e.name || '')}" data-exists="${e.exists ? '1' : '0'}">` +
      `<button class="recent-fav" title="Favoritar" data-fav="${escapeAttr(e.path)}">${favIcon}</button>` +
      `<div class="recent-main"><div class="recent-name">${escapeHtml(e.name || baseNameOf(e.path))}</div>` +
      `<div class="recent-path">${escapeHtml(e.path)}</div></div>` +
      `<span class="recent-when">${when}</span>` +
      `<button class="recent-remove" title="Remover da lista" data-remove="${escapeAttr(e.path)}">✕</button>` +
      `</div>`;
  }).join('');
  wrap.querySelectorAll('.recent-item').forEach(el => el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-fav]') || ev.target.closest('[data-remove]')) return;
    if (el.dataset.exists === '0') { toast('Pasta não encontrada', 'bad'); return; }
    openRecent(el.dataset.path, el.dataset.name);
  }));
  wrap.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    renderRecents(await window.okf.recents.toggleFavorite({ path: b.dataset.fav }));
  }));
  wrap.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    renderRecents(await window.okf.recents.remove({ path: b.dataset.remove }));
  }));
}

async function openRecent(p, name) {
  let res;
  try { res = await window.okf.readBundle(p); }
  catch (e) { toast('Não foi possível abrir a biblioteca.', 'bad'); return; }
  const nm = name || p.split(/[\\/]/).pop();
  loadBundle(res, nm);
  await window.okf.recents.add({ path: p, name: nm });
}

function switchLibrary() { showStart(); }
```

- [ ] **Step 3: Gravar nos recentes ao abrir pasta**

Em `renderer/renderer.js`, substitua a função `openFolder` por:

```js
async function openFolder() {
  const dir = await window.okf.openFolder();
  if (!dir) return;
  const res = await window.okf.readBundle(dir);
  const name = dir.split(/[\\/]/).pop();
  loadBundle(res, name);
  await window.okf.recents.add({ path: dir, name });
}
```

- [ ] **Step 4: Gravar nos recentes ao criar biblioteca**

Em `renderer/renderer.js`, na função `doCreateLibrary`, logo após `loadBundle(res, name);` e antes de `toast('Biblioteca criada em ' + dir, 'good');`, adicione:

```js
  await window.okf.recents.add({ path: dir, name });
```

- [ ] **Step 5: Ação na paleta de comandos**

Em `renderer/renderer.js`, dentro de `paletteActions()`, no array retornado, logo após a linha `{ label: 'Carregar biblioteca de exemplo', run: openSample, needsLib: false },` adicione:

```js
    { label: 'Trocar biblioteca…', run: switchLibrary, needsLib: false },
```

- [ ] **Step 6: Ligar o botão "Nova", o menu e o boot**

Em `renderer/renderer.js`, na função `init()`, logo após a linha `$('empty-sample').onclick = openSample;`, adicione:

```js
  $('empty-new').onclick = newLibrary;
```

Ainda em `init()`, logo após a linha `window.okf.onMenu('menu:open-sample', openSample);`, adicione:

```js
  window.okf.onMenu('menu:switch-library', switchLibrary);
```

E ao final de `init()`, logo após a linha `loadTemplates();`, adicione:

```js
  showStart();
```

- [ ] **Step 7: Sanidade**

Run: `npm test`
Expected: PASS (renderer não roda nos testes; confirma que nada mais quebrou).

- [ ] **Step 8: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(recents): render da tela inicial, interações e gravação de recentes"
```

---

## Task 7: Estilos da lista de recentes

**Files:**
- Modify: `renderer/styles.css`

- [ ] **Step 1: Acrescentar os estilos**

Append ao final de `renderer/styles.css`:

```css
/* ---------- Tela inicial: bibliotecas recentes ---------- */
.recent-list { width: 100%; max-width: 460px; margin: 18px auto 4px; display: flex; flex-direction: column; gap: 7px; }
.recent-item { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 9px 12px; cursor: pointer; text-align: left; }
.recent-item:hover { background: var(--hover); }
.recent-item.missing { opacity: .55; cursor: default; }
.recent-item.missing:hover { background: var(--panel); }
.recent-fav { background: none; border: none; color: var(--warn); font-size: 16px; cursor: pointer; padding: 0 2px; line-height: 1; }
.recent-item.missing .recent-fav { color: var(--bad); }
.recent-main { flex: 1; min-width: 0; }
.recent-name { color: var(--text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-path { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-when { color: var(--muted); font-size: 11px; white-space: nowrap; }
.recent-remove { background: none; border: none; color: var(--muted); font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
.recent-remove:hover { color: var(--bad); }
```

- [ ] **Step 2: Commit**

```bash
git add renderer/styles.css
git commit -m "feat(recents): estilos da lista de bibliotecas recentes"
```

---

## Task 8: Verificação manual ponta a ponta

Sem código novo. Confirma o fluxo real no app.

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test`
Expected: PASS em todos, incluindo `test-recents (puro) OK` e `test-recents (IO) OK`.

- [ ] **Step 2: Abrir o app e validar a tela inicial**

Run: `npm start`

Verifique, na ordem:
1. **Primeira execução:** a tela inicial mostra logo + "Escolha uma biblioteca para começar" + os botões **Abrir pasta… / Nova / Exemplo**, sem lista (ainda não há recentes).
2. Clique **Exemplo** — a biblioteca de exemplo abre, mas **não** deve entrar nos recentes.
3. **Trocar biblioteca…** (menu *Arquivo* ou Ctrl+P) volta para a tela inicial.
4. **Abrir pasta…** e escolha uma pasta de biblioteca real — abre e passa a aparecer nos recentes ao voltar à tela inicial.
5. Abra uma segunda biblioteca; volte à tela inicial: as duas aparecem, **mais recente no topo**, com nome, caminho e "há X".
6. Clique na **estrela** de uma — vira favorita e sobe para o topo; reabra o app (`npm start`) e confirme que favorita e ordem **persistiram**.
7. Clique no **✕** de um item — sai da lista (a pasta no disco continua intacta).
8. Renomeie/mova no Explorer a pasta de uma biblioteca recente; volte à tela inicial: o item aparece **esmaecido** com "Pasta não encontrada"; clicar mostra o toast e **não** abre; o ✕ remove.

- [ ] **Step 3: Commit (se algo foi ajustado durante a verificação)**

```bash
git add -A
git commit -m "fix(recents): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura do spec)

- **Partida sempre na tela de seleção** → Task 6 (`showStart()` no boot; nenhuma biblioteca auto-carregada).
- **Info por item: nome, caminho, último acesso** → Task 6 (`renderRecents` + `relTime`).
- **Remover / favoritar / pasta ausente** → Tasks 2 (handlers) + 6 (UI) + 7 (estilo `.missing`).
- **Armazenamento JSON no userData via main** → Task 2.
- **Modelo de dados, dedup por path, cap preservando favoritas, exemplo excluído** → Tasks 1–2 (lógica) e Task 6 (`openSample` não grava; `openFolder`/`doCreateLibrary`/`openRecent` gravam).
- **Trocar biblioteca sem reiniciar** → Tasks 3 (menu) + 4 (canal) + 6 (paleta + handler).
- **Testes da lógica de `recents.js`** → Tasks 1–2.
