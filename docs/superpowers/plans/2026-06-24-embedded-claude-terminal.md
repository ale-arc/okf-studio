# Terminal Claude Code acoplado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embutir um terminal real (doca inferior, Ctrl+J) no OKF Studio rodando PowerShell na raiz da biblioteca, com botão "Iniciar Claude Code", e atualizar a biblioteca ao vivo quando os arquivos mudam no disco.

**Architecture:** O processo principal cria um PTY com `node-pty` e vigia a pasta com `chokidar`, conversando com o renderer por IPC. O renderer exibe o PTY com `@xterm/xterm` numa doca inferior e recarrega a biblioteca ao receber `bundle:changed`, protegendo a edição em andamento.

**Tech Stack:** Electron 42, node-pty 1.1.0 (nativo), @xterm/xterm 6 + @xterm/addon-fit 0.11 (UMD local), chokidar 4, @electron/rebuild (dev).

---

## Visão geral de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `pty.js` | Criar/gerenciar o PTY; handlers IPC `term:*` | Criar |
| `watcher.js` | Vigiar a biblioteca; debounce; callback de mudança | Criar |
| `main.js` | Registrar PTY + watcher; `currentRoot`; ícone | Modificar |
| `preload.js` | Ponte `okf.term.*` e `okf.onBundleChanged` | Modificar |
| `renderer/terminal.js` | Montar xterm na doca; fit; iniciar Claude | Criar |
| `renderer/index.html` | Doca + `<script>`/CSS do xterm + botão Terminal | Modificar |
| `renderer/styles.css` | Estilos da doca e alça de resize | Modificar |
| `renderer/renderer.js` | Toggle (Ctrl+J), recarga ao vivo, proteção de edição | Modificar |
| `test-pty.js` | Smoke do node-pty (echo) | Criar |
| `test-watcher.js` | Smoke do chokidar (detecção) | Criar |
| `test-renderer.js` | Smoke: ponte do terminal + xterm + CSP | Modificar |

---

## Task 1: Dependências, rebuild nativo e empacotamento

**Files:**
- Modify: `package.json` (deps, scripts, asarUnpack)

- [ ] **Step 1: Instalar dependências**

Run:
```bash
npm install --save node-pty@^1.1.0 @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0 chokidar@^4.0.0
npm install --save-dev @electron/rebuild
```
Expected: instala sem erro. `chokidar`, `@xterm/*` são JS; `node-pty` é nativo (será recompilado no próximo passo).

- [ ] **Step 2: Recompilar o node-pty para a ABI do Electron (dev)**

Adicionar em `package.json` `scripts`:
```json
    "rebuild": "electron-rebuild -f -w node-pty",
```
Run: `npm run rebuild`
Expected: termina com sucesso (`✔ Rebuild Complete`). Isso compila o `node-pty` para o Electron usado em dev.

- [ ] **Step 3: Configurar asarUnpack do binário nativo**

Em `package.json`, dentro de `build`, adicionar (após `extraResources`):
```json
    "asarUnpack": [
      "node_modules/node-pty/**"
    ],
```
(Mantém o `.node` do node-pty fora do asar para carregar no app empacotado. O electron-builder recompila módulos nativos no `dist` por padrão — `npmRebuild: true`.)

- [ ] **Step 4: Verificar que o node-pty carrega no Electron**

Run: `node_modules/.bin/electron -e "try{require('node-pty');console.log('node-pty OK')}catch(e){console.log('FALHOU',e.message)}"`
Expected: imprime `node-pty OK`. Se falhar, rode `npm run rebuild` de novo e confira a versão do Electron.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json
git commit -m "build: deps do terminal (node-pty, xterm, chokidar) + rebuild/asarUnpack"
```

---

## Task 2: Backend do PTY (`pty.js`) + IPC + ponte

**Files:**
- Create: `pty.js`, `test-pty.js`
- Modify: `main.js`, `preload.js`, `package.json` (script `test:pty`)

- [ ] **Step 1: Escrever o smoke test do PTY (falha primeiro)**

Create `test-pty.js`:
```js
'use strict';
// Smoke: node-pty roda no Electron e ecoa um comando. Run: npm run test:pty
const { app } = require('electron');
const { spawnTerminal } = require('./pty.js');

app.whenReady().then(() => {
  let out = '';
  const term = spawnTerminal(process.cwd(), { cols: 80, rows: 24 });
  if (!term) { console.log('RESULT: FAIL (sem PTY)'); app.exit(1); return; }
  term.onData((d) => { out += d; });
  term.write('echo okf-pty-ok\r\n');
  setTimeout(() => {
    const ok = out.includes('okf-pty-ok');
    console.log('saida-contem-marcador:', ok);
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
    try { term.kill(); } catch (e) {}
    app.exit(ok ? 0 : 1);
  }, 2500);
});
```

Add to `package.json` `scripts`:
```json
    "test:pty": "electron test-pty.js",
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:pty`
Expected: FAIL — `Cannot find module './pty.js'` (ainda não existe).

- [ ] **Step 3: Implementar `pty.js`**

Create `pty.js`:
```js
'use strict';
// Encapsula o node-pty: cria o PTY e registra os handlers IPC term:*.
// O require é tolerante a falha (se o módulo nativo não carregar, o terminal
// fica indisponível em vez de derrubar o app).
let pty = null;
try { pty = require('node-pty'); } catch (e) { pty = null; }

let term = null;

function spawnTerminal(cwd, size) {
  if (!pty) return null;
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  return pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: (size && size.cols) || 80,
    rows: (size && size.rows) || 24,
    cwd: cwd || process.cwd(),
    env: process.env
  });
}

function killTerm() {
  if (term) { try { term.kill(); } catch (e) {} term = null; }
}

function registerPtyHandlers(ipcMain, getWindow, getRoot) {
  ipcMain.handle('term:start', (_e, size) => {
    if (!pty) return { ok: false, error: 'Terminal indisponível (node-pty não carregou).' };
    const cwd = getRoot();
    if (!cwd) return { ok: false, error: 'Abra uma biblioteca primeiro.' };
    killTerm();
    term = spawnTerminal(cwd, size);
    if (!term) return { ok: false, error: 'Falha ao iniciar o terminal.' };
    term.onData((d) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('term:data', d); });
    term.onExit(({ exitCode }) => {
      const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('term:exit', exitCode);
      term = null;
    });
    return { ok: true };
  });
  ipcMain.on('term:input', (_e, data) => { if (term) term.write(data); });
  ipcMain.on('term:resize', (_e, size) => { if (term && size) { try { term.resize(size.cols, size.rows); } catch (e) {} } });
  ipcMain.on('term:kill', () => killTerm());
}

module.exports = { spawnTerminal, registerPtyHandlers, killTerm };
```

- [ ] **Step 4: Rodar o smoke e confirmar PASS**

Run: `npm run test:pty`
Expected: `saida-contem-marcador: true` e `RESULT: PASS`. (Se FAIL por timing, aumente o `setTimeout` para 4000.)

- [ ] **Step 5: Ligar no `main.js`**

Em `main.js`, no topo (após os outros `require`):
```js
const { registerPtyHandlers, killTerm } = require('./pty.js');
```
Adicionar, junto às variáveis de topo (após `let mainWindow = null;`):
```js
let currentRoot = null;
```
No final do bloco de IPC (antes de `app.whenReady`), registrar os handlers:
```js
registerPtyHandlers(ipcMain, () => mainWindow, () => currentRoot);
```
No handler `bundle:read`, antes do `return`, definir a raiz atual:
```js
  currentRoot = root;
```
No handler `bundle:sample`, antes do `return`, definir a raiz atual:
```js
  currentRoot = root;
```
Em `createWindow`, no `mainWindow.on('closed', ...)`, encerrar o PTY:
```js
  mainWindow.on('closed', () => { killTerm(); mainWindow = null; });
```

- [ ] **Step 6: Expor a ponte no `preload.js`**

Em `preload.js`, dentro do objeto exposto em `window.okf` (após `installUpdate`), adicionar:
```js
  term: {
    start: (size) => ipcRenderer.invoke('term:start', size),
    input: (data) => ipcRenderer.send('term:input', data),
    resize: (size) => ipcRenderer.send('term:resize', size),
    kill: () => ipcRenderer.send('term:kill'),
    onData: (cb) => ipcRenderer.on('term:data', (_e, d) => cb(d)),
    onExit: (cb) => ipcRenderer.on('term:exit', (_e, code) => cb(code))
  },
  onBundleChanged: (cb) => ipcRenderer.on('bundle:changed', () => cb()),
```

- [ ] **Step 7: Commit**
```bash
git add pty.js test-pty.js main.js preload.js package.json
git commit -m "feat: backend do PTY (node-pty) com IPC term:* e ponte"
```

---

## Task 3: Observador de arquivos (`watcher.js`)

**Files:**
- Create: `watcher.js`, `test-watcher.js`
- Modify: `main.js`, `package.json` (script `test:watch`)

- [ ] **Step 1: Escrever o smoke test do watcher (falha primeiro)**

Create `test-watcher.js`:
```js
'use strict';
// Smoke: o watcher detecta uma alteração de arquivo. Run: npm run test:watch
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWatcher } = require('./watcher.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-watch-'));
let fired = false;
const w = createWatcher(() => { fired = true; });
w.watch(dir);

setTimeout(() => { fs.writeFileSync(path.join(dir, 'novo.md'), '# oi'); }, 400);
setTimeout(() => {
  console.log('detectou-mudanca:', fired);
  console.log(fired ? 'RESULT: PASS' : 'RESULT: FAIL');
  w.close();
  process.exit(fired ? 0 : 1);
}, 1800);
```

Add to `package.json` `scripts`:
```json
    "test:watch": "node test-watcher.js",
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:watch`
Expected: FAIL — `Cannot find module './watcher.js'`.

- [ ] **Step 3: Implementar `watcher.js`**

Create `watcher.js`:
```js
'use strict';
// Vigia a raiz da biblioteca e chama onChange (com debounce) em add/change/unlink.
const chokidar = require('chokidar');

function createWatcher(onChange) {
  let w = null;
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const ignored = (p) =>
    /[\\/](\.git|node_modules|dist|\.superpowers)([\\/]|$)/.test(p) ||
    /[\\/]\.[^\\/]+$/.test(p); // arquivos/pastas ocultos

  return {
    watch(root) {
      this.close();
      if (!root) return;
      w = chokidar.watch(root, { ignored, ignoreInitial: true });
      w.on('add', fire).on('change', fire).on('unlink', fire);
    },
    close() {
      if (w) { w.close(); w = null; }
      clearTimeout(timer);
    }
  };
}

module.exports = { createWatcher };
```

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npm run test:watch`
Expected: `detectou-mudanca: true` e `RESULT: PASS`.

- [ ] **Step 5: Ligar no `main.js`**

Em `main.js`, no topo (após o require do pty):
```js
const { createWatcher } = require('./watcher.js');
```
Após `let currentRoot = null;`, criar o watcher:
```js
const libWatcher = createWatcher(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bundle:changed');
});
```
Nos handlers `bundle:read` e `bundle:sample`, logo após definir `currentRoot = root;`, iniciar a vigilância:
```js
  libWatcher.watch(root);
```
No `mainWindow.on('closed', ...)`, fechar o watcher também:
```js
  mainWindow.on('closed', () => { killTerm(); libWatcher.close(); mainWindow = null; });
```

- [ ] **Step 6: Commit**
```bash
git add watcher.js test-watcher.js main.js package.json
git commit -m "feat: observador de arquivos (chokidar) emitindo bundle:changed"
```

---

## Task 4: Doca do terminal (UI com xterm)

**Files:**
- Modify: `renderer/index.html` (doca + scripts/CSS do xterm + botão)
- Create: `renderer/terminal.js`
- Modify: `renderer/styles.css`
- Modify: `renderer/renderer.js` (toggle, habilitar botão, resize)

- [ ] **Step 1: Marcação da doca, botão e assets do xterm (HTML)**

Em `renderer/index.html`, dentro de `<div class="tools">`, logo após `<button id="btn-theme" ...>`, adicionar:
```html
      <button id="btn-terminal" title="Terminal Claude Code (Ctrl+J)" disabled>⌨ Terminal</button>
```
Em `renderer/index.html`, imediatamente após `</main>` (fim do `#layout`), adicionar a doca:
```html
  <div id="terminal-dock" class="hidden">
    <div class="term-grip" id="term-grip"></div>
    <div class="term-head">
      <span class="term-cwd" id="term-cwd"></span>
      <button id="term-claude" class="term-claude">▸ Iniciar Claude Code</button>
      <span class="grow"></span>
      <button id="term-close">Fechar</button>
    </div>
    <div id="term-host"></div>
  </div>
```
Em `renderer/index.html`, no `<head>`, após `<link rel="stylesheet" href="styles.css" />`, adicionar o CSS do xterm:
```html
  <link rel="stylesheet" href="../node_modules/@xterm/xterm/css/xterm.css" />
```
Em `renderer/index.html`, na lista de `<script>` no fim do body, antes de `<script src="renderer.js"></script>`, adicionar (xterm e o addon expõem os globais `Terminal` e `FitAddon`):
```html
  <script src="../node_modules/@xterm/xterm/lib/xterm.js"></script>
  <script src="../node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>
  <script src="terminal.js"></script>
```
(Confirme os caminhos no pacote instalado: `node_modules/@xterm/xterm/lib/xterm.js`, `.../css/xterm.css`, `node_modules/@xterm/addon-fit/lib/addon-fit.js`. São os campos `main`/`style` dos respectivos `package.json`.)

- [ ] **Step 2: Estilos da doca (CSS)**

Em `renderer/styles.css`, ao final, adicionar:
```css
/* terminal dock */
#terminal-dock{flex:0 0 auto;height:280px;min-height:120px;max-height:75vh;
  display:flex;flex-direction:column;border-top:1px solid var(--line);background:#16171b}
.term-grip{height:6px;flex:0 0 auto;cursor:ns-resize;background:var(--line)}
.term-grip:hover{background:var(--accent)}
.term-head{display:flex;align-items:center;gap:10px;padding:5px 10px;
  background:var(--panel);border-bottom:1px solid var(--line)}
.term-cwd{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:50%}
.term-claude{background:var(--good);border-color:var(--good);color:#06281c;font-weight:600}
.term-claude:hover:not(:disabled){background:#36a878;border-color:#36a878}
#term-host{flex:1;min-height:0;padding:4px 6px}
#btn-terminal{font-size:13px}
```

- [ ] **Step 3: Implementar `renderer/terminal.js`**

Create `renderer/terminal.js`:
```js
'use strict';
// Monta o xterm na doca e conversa com o PTY via window.okf.term.
(function () {
  let term = null, fit = null, started = false;

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const accent = cs.getPropertyValue('--accent').trim() || '#5b9dff';
    return { background: '#16171b', foreground: '#d6e6df', cursor: accent, selectionBackground: '#33405c' };
  }

  function ensure() {
    if (term) return;
    term = new Terminal({
      fontSize: 13, fontFamily: 'Consolas, "Courier New", monospace',
      cursorBlink: true, theme: themeColors(), scrollback: 5000
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('term-host'));
    term.onData((d) => window.okf.term.input(d));
    window.okf.term.onData((d) => term.write(d));
    window.okf.term.onExit(() => { term.write('\r\n\x1b[33m[sessão encerrada]\x1b[0m\r\n'); started = false; });
    window.addEventListener('resize', doFit);
  }

  function doFit() {
    if (!fit || !term) return;
    try { fit.fit(); window.okf.term.resize({ cols: term.cols, rows: term.rows }); } catch (e) {}
  }

  async function start() {
    ensure(); doFit();
    const res = await window.okf.term.start({ cols: term.cols, rows: term.rows });
    if (res && res.ok) { started = true; term.focus(); }
    else { term.write('\r\n\x1b[31m' + ((res && res.error) || 'falha ao iniciar') + '\x1b[0m\r\n'); }
  }

  window.OKFTerminal = {
    open() { ensure(); requestAnimationFrame(() => { doFit(); if (!started) start(); else term.focus(); }); },
    fit: doFit,
    startClaude() { if (started) { window.okf.term.input('claude\r'); } },
    applyTheme() { if (term) term.options.theme = themeColors(); }
  };
})();
```

- [ ] **Step 4: Toggle, habilitar botão e resize (renderer.js)**

Em `renderer/renderer.js`, adicionar as funções da doca (perto do fim, antes de `init`):
```js
/* ---------- Terminal dock ---------- */
function openTerminal() {
  if (!state.root) return;
  $('term-cwd').textContent = state.root;
  $('terminal-dock').classList.remove('hidden');
  $('btn-terminal').classList.add('active');
  window.OKFTerminal.open();
}
function closeTerminal() {
  $('terminal-dock').classList.add('hidden');
  $('btn-terminal').classList.remove('active');
}
function toggleTerminal() {
  if ($('terminal-dock').classList.contains('hidden')) openTerminal();
  else closeTerminal();
}
function wireTerminalResize() {
  const grip = $('term-grip'); const dock = $('terminal-dock');
  let startY = 0, startH = 0, dragging = false;
  grip.addEventListener('mousedown', (e) => { dragging = true; startY = e.clientY; startH = dock.offsetHeight; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const h = Math.max(120, Math.min(window.innerHeight * 0.75, startH + (startY - e.clientY)));
    dock.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; window.OKFTerminal.fit(); } });
}
```

Em `renderer/renderer.js`, na função `loadBundle`, na linha que habilita botões, **incluir** `'btn-terminal'`:
```js
  ['btn-reload','btn-new','btn-graph','btn-validate','btn-terminal','search','type-filter'].forEach(id => $(id).disabled = false);
```

Em `renderer/renderer.js`, dentro de `init()`, adicionar as ligações:
```js
  $('btn-terminal').onclick = toggleTerminal;
  $('term-close').onclick = closeTerminal;
  $('term-claude').onclick = () => window.OKFTerminal.startClaude();
  wireTerminalResize();
```

Em `renderer/renderer.js`, no listener de `keydown` (onde trata Escape), adicionar o atalho Ctrl+J (no início do handler):
```js
    if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); if (state.root) toggleTerminal(); return; }
```

Em `renderer/renderer.js`, na função `applyTheme(theme)` (tema), ao final, atualizar o tema do terminal se existir:
```js
  if (window.OKFTerminal && window.OKFTerminal.applyTheme) window.OKFTerminal.applyTheme();
```

- [ ] **Step 5: Estilo do botão ativo (CSS)**

Em `renderer/styles.css`, junto ao `#btn-terminal`, adicionar:
```css
#btn-terminal.active{background:var(--accent);border-color:var(--accent);color:#fff}
```

- [ ] **Step 6: Verificar manualmente**

Run: `npm start`
- Abra **✨ Exemplo**; o botão **⌨ Terminal** fica ativo. Clique nele (ou `Ctrl+J`): a doca abre embaixo com o PowerShell na pasta da biblioteca.
- Clique em **▸ Iniciar Claude Code**: o `claude` inicia no terminal.
- Arraste a alça do topo da doca para redimensionar; feche com **Fechar** ou `Ctrl+J`.
Feche o app.

- [ ] **Step 7: Commit**
```bash
git add renderer/index.html renderer/styles.css renderer/terminal.js renderer/renderer.js
git commit -m "feat: doca do terminal (xterm) com toggle Ctrl+J e Iniciar Claude Code"
```

---

## Task 5: Atualização ao vivo + proteção de edição

**Files:**
- Modify: `renderer/index.html` (banner de mudança no disco)
- Modify: `renderer/styles.css` (estilo do banner)
- Modify: `renderer/renderer.js` (reloadFromDisk + onBundleChanged)

- [ ] **Step 1: Banner de mudança no disco (HTML)**

Em `renderer/index.html`, logo antes de `<div id="toast" class="toast hidden"></div>`, adicionar:
```html
  <div id="disk-banner" class="disk-banner hidden">
    <span>Este conceito mudou no disco.</span>
    <button id="disk-reload" class="primary">Recarregar</button>
    <button id="disk-keep">Manter minha edição</button>
  </div>
```

- [ ] **Step 2: Estilo do banner (CSS)**

Em `renderer/styles.css`, ao final, adicionar:
```css
.disk-banner{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:70;
  display:flex;align-items:center;gap:10px;background:var(--panel);color:var(--text);
  border:1px solid var(--warn);border-radius:9px;padding:10px 14px;
  box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:13px}
```

- [ ] **Step 3: Recarga ao vivo + proteção de edição (renderer.js)**

Em `renderer/renderer.js`, adicionar (perto de `reload`):
```js
/* ---------- Recarga ao vivo (watcher) ---------- */
async function reloadFromDisk() {
  if (!state.root) return;
  let res;
  try { res = await window.okf.readBundle(state.root); } catch (e) { return; }
  const newDocs = res.docs || [];

  // Edição em andamento: nunca sobrescrever o editor.
  if (state.editing && state.current) {
    const old = state.docs.find(d => d.relPath === state.current);
    const cur = newDocs.find(d => d.relPath === state.current);
    state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree();
    $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
    if (cur && old && cur.content !== old.content) $('disk-banner').classList.remove('hidden');
    return;
  }

  // Sem edição: atualização completa preservando a seleção.
  state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  if (state.current && state.docs.some(d => d.relPath === state.current)) {
    renderConcept(state.docs.find(d => d.relPath === state.current));
  } else if (state.docs.length) {
    const first = state.docs.find(d => !d.reserved) || state.docs[0];
    openDoc(first.relPath);
  } else {
    showEmpty();
  }
}
```

Em `renderer/renderer.js`, dentro de `init()`, ligar o watcher e os botões do banner:
```js
  window.okf.onBundleChanged(reloadFromDisk);
  $('disk-reload').onclick = () => { $('disk-banner').classList.add('hidden'); cancelEdit(); reloadFromDisk(); };
  $('disk-keep').onclick = () => $('disk-banner').classList.add('hidden');
```

Em `renderer/renderer.js`, na função `openDoc`, no início, esconder o banner ao trocar de conceito:
```js
  $('disk-banner').classList.add('hidden');
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm start`, abra **✨ Exemplo**, abra a doca e rode `claude` (ou edite um `.md` por fora). 
- Sem estar editando no app: ao salvar uma mudança no arquivo, a árvore e o conceito aberto atualizam sozinhos.
- Editando um conceito no app e alterando o **mesmo** arquivo por fora: aparece o banner "mudou no disco" com Recarregar / Manter. "Recarregar" descarta a edição e mostra a versão do disco.
Feche o app.

- [ ] **Step 5: Commit**
```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js
git commit -m "feat: recarga ao vivo da biblioteca com proteção de edição"
```

---

## Task 6: Smoke da ponte, build de produção e README

**Files:**
- Modify: `test-renderer.js` (ponte do terminal + xterm + CSP)
- Modify: `README.md`

- [ ] **Step 1: Smoke da ponte e do xterm (test-renderer.js)**

Em `test-renderer.js`, no objeto retornado pelo `executeJavaScript` (junto aos demais campos), adicionar:
```js
    termBridge: !!(window.okf && window.okf.term && typeof window.okf.term.start === 'function' &&
      typeof window.okf.onBundleChanged === 'function'),
    xterm: typeof window.Terminal === 'function' && typeof (window.FitAddon && window.FitAddon.FitAddon) === 'function',
```
Adicionar à apuração do veredito e ao log:
```js
  const okTerm = result.termBridge === true && result.xterm === true;
  console.log('  terminal bridge + xterm:', result.termBridge, result.xterm);
```
E incluir `okTerm` nas DUAS linhas do veredito (no `console.log` do `RESULT` e no `app.exit`).

- [ ] **Step 2: Rodar a suíte**

Run: `npm test && npm run test:watch && npm run test:pty && npm run test:ui`
Expected: `TESTE OK`; `RESULT: PASS` (watcher); `RESULT: PASS` (pty); `RESULT: PASS` (ui) com `terminal bridge + xterm: true true` e `CSP violations: none`.

- [ ] **Step 3: Build de produção**

Run: `npm run dist`
Expected: conclui sem erro; o electron-builder recompila o `node-pty` e aplica o `asarUnpack`. Gera `dist/OKF-Studio-Setup-1.x.y-x64.exe`, portátil, `latest.yml`. (Se o rebuild do node-pty falhar no build, confira a versão do Electron e rode `npm run rebuild`.)

- [ ] **Step 4: Atualizar o README**

Em `README.md`, na lista de recursos ("## O que o app faz"), após a linha do editor visual, adicionar:
```markdown
- **Terminal Claude Code acoplado** (doca inferior, `Ctrl+J`): um terminal real
  (PowerShell) na pasta da biblioteca, com botão **Iniciar Claude Code**. A
  biblioteca se atualiza sozinha conforme os arquivos mudam no disco.
```
Em `README.md`, na seção "## Estrutura do projeto", após a linha do `src/editor/`, adicionar:
```markdown
├── pty.js               Terminal embutido (node-pty) — processo principal
├── watcher.js           Observador de arquivos (chokidar) — recarga ao vivo
```
Em `README.md`, na seção "## Como rodar", após a nota do `build:editor`, adicionar:
```markdown
> O terminal embutido usa `node-pty` (módulo nativo). Em desenvolvimento, rode
> `npm run rebuild` após `npm install` para recompilá-lo para o Electron. O
> `npm run dist` já recompila no empacotamento. É necessário ter o **Claude
> Code** instalado e no PATH para o botão "Iniciar Claude Code".
```

- [ ] **Step 5: Commit + push**
```bash
git add test-renderer.js README.md
git commit -m "test+docs: smoke da ponte do terminal e README do terminal acoplado"
git push origin HEAD
```

---

## Notas de verificação

- **node-pty / Electron:** se `require('node-pty')` falhar no app, o terminal
  degrada (mensagem "Terminal indisponível") em vez de derrubar o app — mas o
  esperado é rodar `npm run rebuild` para corrigir. A versão do Electron muda a
  ABI; ao atualizar o Electron, rode `npm run rebuild`.
- **Caminhos UMD do xterm (v6):** `node_modules/@xterm/xterm/lib/xterm.js`
  (global `Terminal`), `node_modules/@xterm/xterm/css/xterm.css`,
  `node_modules/@xterm/addon-fit/lib/addon-fit.js` (global `FitAddon`, classe
  `FitAddon.FitAddon`). Se algum diferir, confira o campo `main`/`style` do
  `package.json` do pacote.
- **chokidar v4:** `ignored` aceita função `(path) => boolean`; eventos
  `add`/`change`/`unlink`.
```
