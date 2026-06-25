# Conversão Documentos↔Markdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao OKF Studio a importação de documentos (PDF/DOCX/HTML/TXT) para Markdown — com heurística de tabelas e OCR local — e a exportação de um conceito Markdown para PDF, tudo 100% local/offline.

**Architecture:** O núcleo de conversão são módulos puros em `src/convert/` (testáveis em Node), bundlados via esbuild para `renderer/vendor/convert.bundle.js` (global `OKFConvert`) para a importação, que roda no renderer (precisa de canvas/WASM). A exportação MD→PDF roda no main via `webContents.printToPDF` num `BrowserWindow` oculto, num módulo `convert-pdf.js` no estilo de `git.js`/`templates.js`. Toda comunicação usa o padrão IPC existente (`ipcMain.handle` + `preload.js` + `window.okf`).

**Tech Stack:** Electron, Node, esbuild; `pdfjs-dist` (extração/rasterização de PDF), `tesseract.js` (OCR WASM), `mammoth` (DOCX→HTML), `turndown` + `turndown-plugin-gfm` (HTML→MD), `marked` (MD→HTML, já presente).

---

## File Structure

**Núcleo puro (Node-testável), novo dir `src/convert/`:**
- `src/convert/txt.js` — `txtToMarkdown(text)`.
- `src/convert/html.js` — `htmlToMarkdown(html)` (turndown + gfm).
- `src/convert/reconstruct.js` — `reconstructMarkdown(items)`: heurística de layout do PDF (títulos, parágrafos, listas, tabelas) a partir de itens de texto com coordenadas.
- `src/convert/assets.js` — `slugifyAsset(name)`, `rewriteImageLinks(markdown, map)`.
- `src/convert/pdf-html.js` — `buildPdfHtml(markdown, frontmatter, opts)` e `PRINT_CSS` (usado pela exportação).
- `src/convert/index.js` — dispatcher de browser `convert(bytes, ext, opts)`; re-exporta o núcleo; é o entry-point do bundle.

**Main process:**
- `convert-pdf.js` (novo, raiz) — `registerPdfHandlers(ipcMain, getRoot)`; handler `pdf:export`.
- `main.js` (modificar) — handlers `dialog:openDocument`, `file:readBinary`; itens de menu; registrar `registerPdfHandlers`.
- `preload.js` (modificar) — expor `openDocumentDialog`, `readBinary`, `exportPdf`; novos canais de menu.

**Renderer:**
- `renderer/convert-ui.js` (novo) — fluxo de importação (escolher arquivo → converter → preview → salvar) e de exportação (chamar `exportPdf` com o conceito atual).
- `renderer/index.html` (modificar) — `<script src="vendor/convert.bundle.js">`, `<script src="convert-ui.js">`, CSP para WASM/worker, botões e modal de importação.
- `renderer/renderer.js` (modificar) — fiação de menu/paleta/botões para as funções de `convert-ui.js`.

**Build/empacotamento:**
- `package.json` (modificar) — deps; script `build:convert` (esbuild) e `prestart`; `build.files`/`extraResources`; scripts de teste.
- `scripts/copy-convert-assets.mjs` (novo) — copia worker do pdf.js e core/worker/traineddata do tesseract para `renderer/vendor/`.

**Testes (raiz, padrão `test-*.js`):**
- `test-convert.js` (novo) — núcleo puro (html, txt, reconstruct, assets, pdf-html).
- `test-pdf-export.js` (novo) — roda sob Electron; gera um PDF e valida o cabeçalho `%PDF`.

---

# PHASE A — Exportar Markdown → PDF

Independente e sem dependências novas. Entrega utilizável ao final.

## Task A1: `buildPdfHtml` + CSS de impressão (núcleo puro)

**Files:**
- Create: `src/convert/pdf-html.js`
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test**

Crie `test-convert.js` com o mesmo estilo de `test-templates.js`:

```js
// test-convert.js — testes do núcleo de conversão (puro, sem DOM/Electron)
const assert = require('assert');
let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }
function has(hay, needle, msg) { ok(String(hay).includes(needle), msg + ' (faltou: ' + needle + ')'); }

// ---- Task A1: buildPdfHtml ----
const { buildPdfHtml, PRINT_CSS } = require('./src/convert/pdf-html.js');
{
  const html = buildPdfHtml('# Título\n\nParágrafo com **negrito**.', { title: 'Doc', type: 'reference' }, {});
  has(html, '<!DOCTYPE html>', 'pdf-html: tem doctype');
  has(html, '<h1>Título</h1>', 'pdf-html: renderiza heading via marked');
  has(html, '<strong>negrito</strong>', 'pdf-html: renderiza negrito');
  has(html, '@page', 'pdf-html: inclui CSS @page');
  has(html, 'Doc', 'pdf-html: inclui o title do frontmatter no cabeçalho');
  const withBase = buildPdfHtml('![x](assets/a.png)', {}, { baseHref: 'file:///C:/lib/proj/' });
  has(withBase, '<base href="file:///C:/lib/proj/">', 'pdf-html: injeta base href quando fornecido');
  ok(PRINT_CSS.includes('@page'), 'PRINT_CSS exporta o CSS de impressão');
}

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('CONVERT OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/pdf-html.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/convert/pdf-html.js — monta o HTML de impressão a partir de Markdown.
'use strict';
const { marked } = require('marked');

const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body { font: 12pt/1.5 -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; background: #fff; margin: 0; }
h1,h2,h3,h4 { line-height: 1.25; margin: 1.2em 0 .5em; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
p, li { font-size: 12pt; }
code, pre { font-family: Consolas, "Courier New", monospace; }
pre { background: #f4f4f5; padding: 10px; border-radius: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
code { background: #f4f4f5; padding: 1px 4px; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: .6em 0; }
th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f0f0f2; }
img { max-width: 100%; }
blockquote { margin: .6em 0; padding: .2em 1em; border-left: 3px solid #ccc; color: #444; }
.okf-pdf-header { border-bottom: 1px solid #ddd; margin-bottom: 1.2em; padding-bottom: .6em; }
.okf-pdf-header .t { font-size: 20pt; font-weight: 700; }
.okf-pdf-header .m { font-size: 10pt; color: #666; margin-top: .2em; }
`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function headerBlock(fm) {
  if (!fm || (!fm.title && !fm.type)) return '';
  const meta = [fm.type && ('type: ' + fm.type), fm.timestamp && ('timestamp: ' + fm.timestamp)]
    .filter(Boolean).join('  ·  ');
  return `<div class="okf-pdf-header">` +
    (fm.title ? `<div class="t">${esc(fm.title)}</div>` : '') +
    (meta ? `<div class="m">${esc(meta)}</div>` : '') + `</div>`;
}

function buildPdfHtml(markdown, frontmatter, opts) {
  opts = opts || {};
  const body = marked.parse(String(markdown || ''));
  const base = opts.baseHref ? `<base href="${esc(opts.baseHref)}">` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${base}<style>${PRINT_CSS}</style></head>` +
    `<body>${headerBlock(frontmatter)}${body}</body></html>`;
}

module.exports = { buildPdfHtml, PRINT_CSS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-convert.js`
Expected: PASS — `CONVERT OK`.

- [ ] **Step 5: Commit**

```bash
git add src/convert/pdf-html.js test-convert.js
git commit -m "feat(pdf): buildPdfHtml + CSS de impressão (núcleo puro testado)"
```

## Task A2: módulo main `convert-pdf.js` (printToPDF)

**Files:**
- Create: `convert-pdf.js`
- Test: `test-pdf-export.js` (Task A6)

- [ ] **Step 1: Write the implementation**

`printToPDF` exige Electron, então a verificação real é a Task A6. Escreva o módulo:

```js
// convert-pdf.js — exporta um conceito Markdown para PDF via printToPDF (Chromium embutido).
'use strict';
const { BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { buildPdfHtml } = require('./src/convert/pdf-html.js');

// Gera o PDF a partir de markdown+frontmatter; grava em destPath. Retorna o buffer também (para testes).
async function renderPdf({ markdown, frontmatter, baseHref }) {
  const html = buildPdfHtml(markdown, frontmatter, { baseHref });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, sandbox: true, contextIsolation: true, javascript: false }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } // polegadas
    });
    return buf;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function registerPdfHandlers(ipcMain, getRoot) {
  ipcMain.handle('pdf:export', async (_e, { markdown, frontmatter, conceptRelPath, defaultName }) => {
    try {
      const root = getRoot && getRoot();
      let baseHref;
      if (root && conceptRelPath) {
        const dir = path.dirname(path.join(root, conceptRelPath));
        baseHref = 'file:///' + dir.replace(/\\/g, '/').replace(/^\/+/, '') + '/';
      }
      const res = await dialog.showSaveDialog({
        title: 'Exportar conceito como PDF',
        defaultPath: (defaultName || 'conceito') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const buf = await renderPdf({ markdown, frontmatter, baseHref });
      await fsp.writeFile(res.filePath, buf);
      shell.showItemInFolder(res.filePath);
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

module.exports = { registerPdfHandlers, renderPdf };
```

- [ ] **Step 2: Commit**

```bash
git add convert-pdf.js
git commit -m "feat(pdf): módulo main convert-pdf (printToPDF + save dialog)"
```

## Task A3: registrar handler + canais no main e preload

**Files:**
- Modify: `main.js:11` (require), `main.js:380-381` (registro), `main.js:44-109` (menu), `preload.js:36-43` (canais), `preload.js:5-21` (API)

- [ ] **Step 1: require + registrar handler em main.js**

Em `main.js`, após a linha 11 (`const { registerTemplateHandlers } = require('./templates.js');`), adicione:

```js
const { registerPdfHandlers } = require('./convert-pdf.js');
```

E logo após a linha 381 (`registerTemplateHandlers(ipcMain);`), adicione:

```js
registerPdfHandlers(ipcMain, () => currentRoot);
```

- [ ] **Step 2: item de menu "Exportar como PDF…"**

Em `main.js`, no submenu "Arquivo", logo após o bloco do item "Salvar" (linha 77, depois do `}` e antes do `{ type: 'separator' }` da linha 78), insira:

```js
        {
          label: 'Exportar como PDF…',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('menu:export-pdf')
        },
```

- [ ] **Step 3: expor canal de menu e API no preload.js**

Em `preload.js`, no array `valid` (linhas 37-41), acrescente `'menu:export-pdf'` e `'menu:import-doc'` (este último já adianta a Phase B):

```js
    const valid = [
      'menu:open-folder', 'menu:open-sample', 'menu:new-concept', 'menu:new-library',
      'menu:save', 'menu:reload', 'menu:validate', 'menu:graph', 'menu:about', 'menu:manual',
      'menu:rebuild-indexes', 'menu:templates', 'menu:export-pdf', 'menu:import-doc'
    ];
```

E na API exposta (após a linha 21, `openClaude: ...`), adicione:

```js
  exportPdf: (payload) => ipcRenderer.invoke('pdf:export', payload),
```

- [ ] **Step 4: validar que o app empacotado não quebra**

Run: `node scripts/check-package-files.mjs`
Expected: PASS. (Adiciona `convert-pdf.js` como require de main.js — a Task A5/A7 garante que está em `build.files`.) Se reclamar de `convert-pdf.js` ou `src/convert/pdf-html.js` ausentes de `build.files`, prossiga — corrigido na Task A7; aqui só confirme que o erro é exatamente esse.

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "feat(pdf): fiação main/preload (handler, menu Exportar como PDF, canais)"
```

## Task A4: UI da exportação no renderer

**Files:**
- Create: `renderer/convert-ui.js`
- Modify: `renderer/index.html:595-596` (scripts) e `renderer/index.html:56-60` (botões), `renderer/renderer.js` (init/paleta)

- [ ] **Step 1: criar `renderer/convert-ui.js` com a função de exportar**

Reusa o estado e helpers globais já existentes em `renderer.js` (`state`, `$`, `parsedOf`, `currentBodyMarkdown`, `toast`, `baseNameOf`). Como `renderer.js` carrega depois, exponha as funções num objeto global:

```js
// renderer/convert-ui.js — fluxos de importação/exportação de documentos.
'use strict';
(function () {
  // Exporta o conceito atualmente aberto para PDF.
  async function exportCurrentPdf() {
    if (!state.current) { toast('Abra um conceito primeiro.', 'bad'); return; }
    const doc = state.docs.find(d => d.relPath === state.current);
    if (!doc) { toast('Conceito não encontrado.', 'bad'); return; }
    const parsed = parsedOf(doc);
    const markdown = state.editing ? currentBodyMarkdown(doc) : parsed.body;
    const defaultName = (parsed.frontmatter.title || baseNameOf(doc.relPath).replace(/\.md$/i, ''));
    toast('Gerando PDF…', 'good');
    const res = await window.okf.exportPdf({
      markdown,
      frontmatter: parsed.frontmatter,
      conceptRelPath: doc.relPath,
      defaultName
    });
    if (res && res.ok) toast('PDF salvo: ' + res.path, 'good');
    else if (res && res.canceled) {/* silencioso */}
    else toast('Falha ao gerar PDF: ' + ((res && res.error) || 'desconhecida'), 'bad');
  }

  window.OKFConvertUI = { exportCurrentPdf };
})();
```

- [ ] **Step 2: incluir os scripts no index.html**

Em `renderer/index.html`, entre as linhas 595 e 596 (depois de `vendor/editor.bundle.js` e antes de `renderer.js`), adicione:

```html
  <script src="convert-ui.js"></script>
```

(O `vendor/convert.bundle.js` será adicionado na Phase B.)

- [ ] **Step 3: botão de exportar no cabeçalho do conceito**

Em `renderer/index.html`, no grupo de botões do conceito (linhas 56-60), após o botão `btn-rename` (linha 59), adicione:

```html
            <button id="btn-export-pdf" title="Exportar este conceito como PDF (Ctrl+E)">⭳ PDF</button>
```

- [ ] **Step 4: fiar menu, botão e paleta em renderer.js**

Em `renderer/renderer.js`, dentro de `init()` (perto das outras `onMenu`, ~linha 1362), adicione:

```js
  window.okf.onMenu('menu:export-pdf', () => window.OKFConvertUI.exportCurrentPdf());
```

Ainda em `init()`, junto aos outros `addEventListener` de botões, adicione:

```js
  $('btn-export-pdf').addEventListener('click', () => window.OKFConvertUI.exportCurrentPdf());
```

E em `paletteActions()` (renderer.js:890), acrescente uma entrada ao array (antes do `.filter`):

```js
    { label: 'Exportar conceito como PDF', run: () => window.OKFConvertUI.exportCurrentPdf(), needsLib: true },
```

- [ ] **Step 5: verificação manual no app**

Run: `npm start`
Faça: abra a biblioteca de exemplo → abra um conceito → clique **⭳ PDF** (ou `Ctrl+E`) → escolha o destino.
Expected: um `.pdf` é gerado, abre na pasta destacado, e o conteúdo bate com a visualização (títulos, tabelas, imagens relativas resolvidas).

- [ ] **Step 6: Commit**

```bash
git add renderer/convert-ui.js renderer/index.html renderer/renderer.js
git commit -m "feat(pdf): UI de exportar conceito como PDF (botão, menu, paleta)"
```

## Task A5: teste automatizado da exportação (Electron)

**Files:**
- Create: `test-pdf-export.js`
- Modify: `package.json` (script `test:pdf`)

- [ ] **Step 1: escrever o teste que roda sob Electron**

```js
// test-pdf-export.js — roda com `electron test-pdf-export.js`. Gera um PDF e valida o cabeçalho.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderPdf } = require('./convert-pdf.js');

app.whenReady().then(async () => {
  let code = 0;
  try {
    const md = '# Teste\n\nParágrafo.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    const buf = await renderPdf({ markdown: md, frontmatter: { title: 'Teste', type: 'reference' } });
    const head = buf.slice(0, 5).toString('latin1');
    if (head !== '%PDF-') { console.error('FAIL: buffer não começa com %PDF- (got: ' + head + ')'); code = 1; }
    if (buf.length < 1000) { console.error('FAIL: PDF muito pequeno (' + buf.length + ' bytes)'); code = 1; }
    const out = path.join(os.tmpdir(), 'okf-test-' + process.pid + '.pdf');
    fs.writeFileSync(out, buf);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) { console.error('FAIL: arquivo PDF não gravado'); code = 1; }
    fs.rmSync(out, { force: true });
    if (!code) console.log('PDF EXPORT OK (' + buf.length + ' bytes)');
  } catch (e) {
    console.error('FAIL:', e); code = 1;
  }
  app.exit(code);
});
```

- [ ] **Step 2: adicionar script de teste**

Em `package.json`, em `"scripts"`, após `"test:templates"` adicione:

```json
    "test:pdf": "electron test-pdf-export.js",
```

- [ ] **Step 3: rodar o teste**

Run: `npm run test:pdf`
Expected: `PDF EXPORT OK (NNNN bytes)` e código de saída 0.

- [ ] **Step 4: Commit**

```bash
git add test-pdf-export.js package.json
git commit -m "test(pdf): exportação gera PDF válido (Electron)"
```

## Task A6: empacotamento da exportação

**Files:**
- Modify: `package.json` (`build.files`)

- [ ] **Step 1: incluir os novos arquivos no build**

Em `package.json`, no array `build.files` (após `"templates.js",`), adicione:

```json
      "convert-pdf.js",
      "src/convert/**/*",
```

- [ ] **Step 2: validar empacotamento**

Run: `node scripts/check-package-files.mjs`
Expected: `check-package-files: OK …` (agora `convert-pdf.js` e `src/convert/pdf-html.js` estão cobertos).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build(pdf): inclui convert-pdf.js e src/convert no pacote"
```

---

# PHASE B — Importar Documentos → Markdown

Adiciona dependências e o bundle do renderer. Cada task termina compilando/testando.

## Task B1: dependências e script de cópia de assets

**Files:**
- Modify: `package.json` (dependencies, scripts)
- Create: `scripts/copy-convert-assets.mjs`

- [ ] **Step 1: instalar dependências**

Run:
```bash
npm install pdfjs-dist@4 tesseract.js@5 mammoth@1 turndown@7 turndown-plugin-gfm@1
```
Expected: as 5 dependências aparecem em `package.json > dependencies`.

- [ ] **Step 2: script que copia worker/wasm/traineddata para `renderer/vendor/`**

Copiamos para um diretório versionável servido sob CSP `'self'`. (O pacote `tesseract.js` baixa core/lang em runtime por padrão; aqui apontaremos para arquivos locais para funcionar offline.)

```js
// scripts/copy-convert-assets.mjs — copia assets de runtime de pdf.js/tesseract para renderer/vendor/.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const VENDOR = path.resolve('renderer/vendor');
mkdirSync(VENDOR, { recursive: true });

function copy(from, toName) {
  if (!existsSync(from)) { console.error('AVISO: não encontrado: ' + from); return false; }
  copyFileSync(from, path.join(VENDOR, toName));
  console.log('copiado:', toName);
  return true;
}

// pdf.js worker (legacy build = sem top-level await, melhor p/ <script>).
const pdfDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
copy(path.join(pdfDir, 'legacy/build/pdf.worker.min.mjs'), 'pdf.worker.min.mjs');

// tesseract.js: worker + core wasm.
const tjsDir = path.dirname(require.resolve('tesseract.js/package.json'));
copy(path.join(tjsDir, 'dist/worker.min.js'), 'tesseract-worker.min.js');
const coreDir = path.dirname(require.resolve('tesseract.js-core/package.json'));
copy(path.join(coreDir, 'tesseract-core-simd.wasm.js'), 'tesseract-core.wasm.js');
copy(path.join(coreDir, 'tesseract-core-simd.wasm'), 'tesseract-core.wasm');

console.log('copy-convert-assets: concluído');
```

- [ ] **Step 3: obter os dados de idioma do tesseract (offline)**

Baixe `por.traineddata.gz` e `eng.traineddata.gz` (tessdata_fast) e coloque em `renderer/vendor/tessdata/`. Use o helper:

```bash
mkdir -p renderer/vendor/tessdata
node -e "const https=require('https'),fs=require('fs');for(const l of ['por','eng']){const f=fs.createWriteStream('renderer/vendor/tessdata/'+l+'.traineddata.gz');https.get('https://github.com/naptha/tessdata/raw/gh-pages/4.0.0_fast/'+l+'.traineddata.gz',r=>r.pipe(f));}"
```
Expected: `renderer/vendor/tessdata/por.traineddata.gz` e `eng.traineddata.gz` existem (cada ~1-8 MB). Se offline, registre como pendência e siga; o OCR usará fallback de download na 1ª vez.

- [ ] **Step 4: adicionar scripts de build**

Em `package.json > scripts`, adicione/edite:

```json
    "build:convert": "esbuild src/convert/index.js --bundle --format=iife --global-name=OKFConvert --outfile=renderer/vendor/convert.bundle.js --legal-comments=none && node scripts/copy-convert-assets.mjs",
    "prestart": "npm run build:editor && npm run build:convert",
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/copy-convert-assets.mjs renderer/vendor/tessdata/.gitkeep
git commit -m "build(import): deps (pdfjs/tesseract/mammoth/turndown) + cópia de assets"
```

## Task B2: `txtToMarkdown` (núcleo puro)

**Files:**
- Create: `src/convert/txt.js`
- Modify: `test-convert.js`

- [ ] **Step 1: Write the failing test** (adicione ao `test-convert.js`, antes do bloco final de contagem)

```js
// ---- Task B2: txtToMarkdown ----
const { txtToMarkdown } = require('./src/convert/txt.js');
{
  ok(txtToMarkdown('linha 1\nlinha 2') === 'linha 1\nlinha 2\n', 'txt: preserva linhas e garante \\n final');
  ok(txtToMarkdown('a\r\nb') === 'a\nb\n', 'txt: normaliza CRLF');
  ok(txtToMarkdown('') === '', 'txt: vazio vira vazio');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/txt.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/convert/txt.js
'use strict';
function txtToMarkdown(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!s) return '';
  return s.endsWith('\n') ? s : s + '\n';
}
module.exports = { txtToMarkdown };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-convert.js`
Expected: PASS — `CONVERT OK`.

- [ ] **Step 5: Commit**

```bash
git add src/convert/txt.js test-convert.js
git commit -m "feat(import): txtToMarkdown"
```

## Task B3: `htmlToMarkdown` (turndown + GFM)

**Files:**
- Create: `src/convert/html.js`
- Modify: `test-convert.js`

- [ ] **Step 1: Write the failing test**

```js
// ---- Task B3: htmlToMarkdown ----
const { htmlToMarkdown } = require('./src/convert/html.js');
{
  has(htmlToMarkdown('<h1>Olá</h1>'), '# Olá', 'html: h1 vira #');
  has(htmlToMarkdown('<p><strong>x</strong></p>'), '**x**', 'html: strong vira **');
  has(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>'), '-   a', 'html: lista');
  const t = htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  has(t, '| A | B |', 'html: tabela GFM (cabeçalho)');
  has(t, '| 1 | 2 |', 'html: tabela GFM (linha)');
  has(htmlToMarkdown('<a href="https://x.com">link</a>'), '[link](https://x.com)', 'html: link');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/html.js'`.

- [ ] **Step 3: Write minimal implementation**

`turndown` roda em Node (usa um DOM interno). Plugin GFM habilita tabelas/strikethrough/task-lists.

```js
// src/convert/html.js — HTML → Markdown (com tabelas GFM). Funciona em Node e no browser.
'use strict';
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

function makeService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*'
  });
  td.use(gfm);
  return td;
}

function htmlToMarkdown(html) {
  const md = makeService().turndown(String(html || ''));
  return md ? (md.endsWith('\n') ? md : md + '\n') : '';
}

module.exports = { htmlToMarkdown, makeService };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-convert.js`
Expected: PASS — `CONVERT OK`. (Se a asserção exata da lista `-   a` divergir da formatação do turndown, ajuste o `has` para o espaçamento real observado — mantenha as demais.)

- [ ] **Step 5: Commit**

```bash
git add src/convert/html.js test-convert.js
git commit -m "feat(import): htmlToMarkdown (turndown + GFM)"
```

## Task B4: `reconstructMarkdown` — heurística de layout do PDF (núcleo puro)

**Files:**
- Create: `src/convert/reconstruct.js`
- Modify: `test-convert.js`

A entrada é um array de itens normalizados de uma página: `{ str, x, y, w, h, fontSize, bold, italic }` (origem no canto superior-esquerdo, `y` cresce para baixo). O adaptador pdf.js→itens fica na Task B6.

- [ ] **Step 1: Write the failing test**

```js
// ---- Task B4: reconstructMarkdown ----
const { reconstructMarkdown } = require('./src/convert/reconstruct.js');
function it(str, x, y, fontSize, extra) { return Object.assign({ str, x, y, w: str.length * fontSize * 0.5, h: fontSize, fontSize, bold: false, italic: false }, extra || {}); }
{
  // Título grande + parágrafo normal
  const md1 = reconstructMarkdown([
    it('Capítulo 1', 50, 50, 24),
    it('Texto normal do parágrafo.', 50, 90, 12)
  ]);
  has(md1, '# Capítulo 1', 'reconstruct: fonte grande vira heading');
  has(md1, 'Texto normal do parágrafo.', 'reconstruct: parágrafo preservado');

  // Itens na mesma linha (mesmo y) juntam-se
  const md2 = reconstructMarkdown([ it('Olá ', 50, 50, 12), it('mundo', 90, 50, 12) ]);
  has(md2, 'Olá mundo', 'reconstruct: itens na mesma linha juntam');

  // Lista por marcador
  const md3 = reconstructMarkdown([ it('• Item um', 50, 50, 12), it('• Item dois', 50, 70, 12) ]);
  has(md3, '- Item um', 'reconstruct: bullet vira "-"');
  has(md3, '- Item dois', 'reconstruct: 2º bullet');

  // Tabela: 2 colunas alinhadas em x, 2 linhas
  const md4 = reconstructMarkdown([
    it('Nome', 50, 50, 12), it('Idade', 200, 50, 12),
    it('Ana', 50, 70, 12),  it('30', 200, 70, 12)
  ]);
  has(md4, '| Nome | Idade |', 'reconstruct: tabela cabeçalho');
  has(md4, '| --- | --- |', 'reconstruct: separador GFM');
  has(md4, '| Ana | 30 |', 'reconstruct: linha da tabela');

  // Negrito
  const md5 = reconstructMarkdown([ it('forte', 50, 50, 12, { bold: true }) ]);
  has(md5, '**forte**', 'reconstruct: negrito');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/reconstruct.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/convert/reconstruct.js — reconstrói Markdown a partir de itens de texto posicionados (uma página).
'use strict';

// Agrupa itens em linhas por proximidade vertical.
function groupLines(items) {
  const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  for (const it of sorted) {
    const tol = Math.max(3, it.fontSize * 0.6);
    let line = lines.find(l => Math.abs(l.y - it.y) <= tol);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

function lineText(line) {
  let out = '';
  let prev = null;
  for (const it of line.items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > prev.fontSize * 0.3) out += ' ';
    }
    out += emph(it);
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function emph(it) {
  let s = it.str;
  if (!s.trim()) return s;
  if (it.bold && it.italic) return '***' + s.trim() + '*** ';
  if (it.bold) return '**' + s.trim() + '** ';
  if (it.italic) return '*' + s.trim() + '* ';
  return s;
}

function medianFontSize(items) {
  const sizes = items.map(i => i.fontSize).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
}

function headingHashes(size, median) {
  const r = size / median;
  if (r >= 1.8) return '# ';
  if (r >= 1.4) return '## ';
  if (r >= 1.15) return '### ';
  return '';
}

const BULLET = /^([•\-\*•●▪]|\d+[.)])\s+/;

// Detecta um bloco de linhas como tabela: ≥2 linhas que compartilham ≥2 colunas (clusters de x).
function detectColumns(lines) {
  const xs = [];
  for (const l of lines) for (const it of l.items) xs.push(it.x);
  xs.sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const c = cols.find(c => Math.abs(c - x) <= 12);
    if (c == null) cols.push(x);
  }
  return cols.sort((a, b) => a - b);
}

function cellsFor(line, cols) {
  const cells = cols.map(() => '');
  for (const it of line.items) {
    let bi = 0, best = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c - it.x); if (d < best) { best = d; bi = i; } });
    cells[bi] += (cells[bi] ? ' ' : '') + emph(it).trim();
  }
  return cells.map(c => c.trim());
}

function isTableBlock(lines) {
  if (lines.length < 2) return null;
  const cols = detectColumns(lines);
  if (cols.length < 2) return null;
  // exige que a maioria das linhas tenha itens em ≥2 colunas distintas
  const multi = lines.filter(l => {
    const hit = new Set();
    for (const it of l.items) {
      let bi = 0, best = Infinity;
      cols.forEach((c, i) => { const d = Math.abs(c - it.x); if (d < best) { best = d; bi = i; } });
      hit.add(bi);
    }
    return hit.size >= 2;
  });
  return multi.length >= Math.max(2, Math.ceil(lines.length * 0.6)) ? cols : null;
}

function tableMarkdown(lines, cols) {
  const rows = lines.map(l => cellsFor(l, cols));
  const head = rows[0];
  let md = '| ' + head.join(' | ') + ' |\n';
  md += '| ' + head.map(() => '---').join(' | ') + ' |\n';
  for (const r of rows.slice(1)) md += '| ' + r.join(' | ') + ' |\n';
  return md;
}

function reconstructMarkdown(items) {
  const clean = (items || []).filter(i => i && typeof i.str === 'string' && i.str.trim() !== '');
  if (!clean.length) return '';
  const median = medianFontSize(clean);
  const lines = groupLines(clean);

  const out = [];
  let i = 0;
  while (i < lines.length) {
    // tenta agrupar uma sequência de linhas próximas como tabela
    let j = i + 1;
    while (j < lines.length && (lines[j].y - lines[j - 1].y) < median * 2) j++;
    const block = lines.slice(i, j);
    const cols = block.length >= 2 ? isTableBlock(block) : null;
    if (cols) {
      out.push(tableMarkdown(block, cols).trimEnd());
      i = j;
      continue;
    }
    // linha simples
    const line = lines[i];
    const text = lineText(line);
    const sizeMax = Math.max(...line.items.map(it => it.fontSize));
    const h = headingHashes(sizeMax, median);
    if (h) out.push(h + text.replace(/\*\*/g, '').trim());
    else if (BULLET.test(text)) out.push('- ' + text.replace(BULLET, ''));
    else out.push(text);
    i++;
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { reconstructMarkdown, groupLines, isTableBlock };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-convert.js`
Expected: PASS — `CONVERT OK`. (Se algum espaçamento de célula/linha divergir por arredondamento, ajuste o `has` esperado para o texto real, sem afrouxar a intenção do teste.)

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(import): reconstructMarkdown (heurística de títulos/listas/tabelas)"
```

## Task B5: `assets.js` — nomes e reescrita de links de imagem (núcleo puro)

**Files:**
- Create: `src/convert/assets.js`
- Modify: `test-convert.js`

Convenção: os conversores emitem imagens como `![alt](okf-img:<tempId>)`. Ao salvar, `rewriteImageLinks` troca cada `okf-img:<tempId>` pelo caminho relativo final.

- [ ] **Step 1: Write the failing test**

```js
// ---- Task B5: assets ----
const { slugifyAsset, rewriteImageLinks } = require('./src/convert/assets.js');
{
  ok(slugifyAsset('Minha Foto.PNG') === 'minha-foto.png', 'assets: slug minúsculo com hífens');
  ok(slugifyAsset('a/b\\c.jpg') === 'a-b-c.jpg', 'assets: remove separadores');
  const md = 'Veja ![diagrama](okf-img:img1) e ![](okf-img:img2).';
  const out = rewriteImageLinks(md, { img1: 'assets/diagrama.png', img2: 'assets/img2.png' });
  has(out, '![diagrama](assets/diagrama.png)', 'assets: reescreve 1º link');
  has(out, '![](assets/img2.png)', 'assets: reescreve 2º link');
  ok(!out.includes('okf-img:'), 'assets: não sobra placeholder');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/assets.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/convert/assets.js — utilidades de nomes e reescrita de links de imagem.
'use strict';

function slugifyAsset(name) {
  const s = String(name || 'imagem');
  const dot = s.lastIndexOf('.');
  let base = dot > 0 ? s.slice(0, dot) : s;
  let ext = dot > 0 ? s.slice(dot + 1) : 'png';
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imagem';
  ext = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return base + '.' + ext;
}

// map: { tempId: 'assets/arquivo.ext' }
function rewriteImageLinks(markdown, map) {
  let out = String(markdown || '');
  for (const [id, target] of Object.entries(map || {})) {
    const re = new RegExp('okf-img:' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, target);
  }
  return out;
}

module.exports = { slugifyAsset, rewriteImageLinks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-convert.js`
Expected: PASS — `CONVERT OK`.

- [ ] **Step 5: Commit**

```bash
git add src/convert/assets.js test-convert.js
git commit -m "feat(import): assets (slug + rewriteImageLinks)"
```

## Task B6: dispatcher de browser `src/convert/index.js` + bundle

**Files:**
- Create: `src/convert/index.js`
- Verifica: `renderer/vendor/convert.bundle.js` (gerado)

Este é o glue de browser (pdf.js, OCR, mammoth, extração de imagem). A lógica pura já está testada; aqui a verificação é a compilação do bundle + smoke manual.

- [ ] **Step 1: escrever o dispatcher**

```js
// src/convert/index.js — entry-point do bundle do renderer (global OKFConvert).
'use strict';
const { txtToMarkdown } = require('./txt.js');
const { htmlToMarkdown } = require('./html.js');
const { reconstructMarkdown } = require('./reconstruct.js');
const { slugifyAsset, rewriteImageLinks } = require('./assets.js');

// pdf.js (legacy ESM build interoperável via esbuild bundle).
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

const mammoth = require('mammoth');

const dec = new TextDecoder('utf-8');

function firstHeading(md) {
  const m = String(md).match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

// Normaliza um item textContent do pdf.js para o formato de reconstruct.js.
function normItems(textContent, viewport) {
  const out = [];
  for (const it of textContent.items) {
    if (!it.str) continue;
    const tr = pdfjs.Util.transform(viewport.transform, it.transform);
    const x = tr[4];
    const y = tr[5];
    const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 12;
    const name = (it.fontName || '').toLowerCase();
    out.push({
      str: it.str, x, y, w: it.width || it.str.length * fontSize * 0.5, h: it.height || fontSize,
      fontSize, bold: /bold|black|semibold/.test(name), italic: /italic|oblique/.test(name)
    });
  }
  return out;
}

async function pageToDataUrl(page, scale) {
  const viewport = page.getViewport({ scale: scale || 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function ocrDataUrl(dataUrl, onProgress) {
  const Tesseract = require('tesseract.js');
  const result = await Tesseract.recognize(dataUrl, 'por+eng', {
    workerPath: 'vendor/tesseract-worker.min.js',
    corePath: 'vendor/tesseract-core.wasm.js',
    langPath: 'vendor/tessdata',
    logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); }
  });
  return result.data.text || '';
}

async function convertPdf(bytes, opts) {
  opts = opts || {};
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    if (opts.signal && opts.signal.aborted) throw new Error('Cancelado');
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const text = tc.items.map(i => i.str).join('').trim();
    if (text.length >= 10) {
      parts.push(reconstructMarkdown(normItems(tc, viewport)));
    } else {
      if (opts.onStatus) opts.onStatus('OCR na página ' + p + '/' + doc.numPages + '…');
      const url = await pageToDataUrl(page, 2);
      const ocr = await ocrDataUrl(url, opts.onProgress);
      parts.push(ocr.trim());
    }
  }
  const markdown = parts.filter(Boolean).join('\n\n');
  return { markdown, images: [], meta: { title: firstHeading(markdown) } };
}

async function convertDocx(bytes) {
  const images = [];
  let n = 0;
  const conv = await mammoth.convertToHtml(
    { arrayBuffer: bytes.buffer ? bytes.buffer : bytes },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.readAsArrayBuffer();
        const id = 'img' + (++n);
        const ext = (image.contentType && image.contentType.split('/')[1]) || 'png';
        images.push({ tempId: id, bytes: new Uint8Array(buf), mime: image.contentType, suggestedName: id + '.' + ext });
        return { src: 'okf-img:' + id };
      })
    }
  );
  const markdown = htmlToMarkdown(conv.value);
  return { markdown, images, meta: { title: firstHeading(markdown) } };
}

// bytes: Uint8Array; ext: 'pdf'|'docx'|'html'|'htm'|'txt'
async function convert(bytes, ext, opts) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'pdf') return convertPdf(bytes, opts);
  if (e === 'docx') return convertDocx(bytes);
  if (e === 'html' || e === 'htm') {
    const md = htmlToMarkdown(dec.decode(bytes));
    return { markdown: md, images: [], meta: { title: firstHeading(md) } };
  }
  const md = txtToMarkdown(dec.decode(bytes));
  return { markdown: md, images: [], meta: { title: '' } };
}

module.exports = { convert, slugifyAsset, rewriteImageLinks, txtToMarkdown, htmlToMarkdown };
```

- [ ] **Step 2: compilar o bundle**

Run: `npm run build:convert`
Expected: gera `renderer/vendor/convert.bundle.js` (sem erros do esbuild) e copia os assets (`pdf.worker.min.mjs`, worker/core do tesseract). Se o esbuild reclamar de import de `.mjs`, confirme a versão `pdfjs-dist@4` e o caminho `legacy/build/pdf.mjs`.

- [ ] **Step 3: incluir o bundle no index.html**

Em `renderer/index.html`, antes de `<script src="convert-ui.js"></script>` (adicionado na Task A4), insira:

```html
  <script src="vendor/convert.bundle.js"></script>
```

- [ ] **Step 4: ajustar a CSP para WASM + worker**

Em `renderer/index.html:6`, substitua a meta CSP por (adiciona `wasm-unsafe-eval`, `blob:` para worker e mantém o resto):

```html
        content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' data: blob:;" />
```

- [ ] **Step 5: Commit**

```bash
git add src/convert/index.js renderer/index.html renderer/vendor/convert.bundle.js
git commit -m "feat(import): dispatcher convert() + bundle + CSP para WASM/worker"
```

## Task B7: IPC para escolher arquivo e ler bytes (main + preload)

**Files:**
- Modify: `main.js` (handlers + menu), `preload.js` (API)

- [ ] **Step 1: handler de diálogo + leitura binária em main.js**

Em `main.js`, após o handler `dialog:openFolder` (linha 246), adicione:

```js
ipcMain.handle('dialog:openDocument', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione um documento para importar',
    properties: ['openFile'],
    filters: [
      { name: 'Documentos', extensions: ['pdf', 'docx', 'html', 'htm', 'txt'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('file:readBinary', async (_e, filePath) => {
  const buf = await fsp.readFile(filePath);
  return {
    name: path.basename(filePath),
    ext: path.extname(filePath).replace(/^\./, '').toLowerCase(),
    bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  };
});
```

- [ ] **Step 2: item de menu "Importar documento…"**

Em `main.js`, no submenu "Arquivo", logo após o item "Modelos…" (linha 72) e antes de "Salvar", insira:

```js
        {
          label: 'Importar documento…',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow.webContents.send('menu:import-doc')
        },
```

- [ ] **Step 3: expor no preload.js** (o canal `menu:import-doc` já entrou no `valid` na Task A3)

Em `preload.js`, na API exposta (junto de `exportPdf`), adicione:

```js
  openDocumentDialog: () => ipcRenderer.invoke('dialog:openDocument'),
  readBinary: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
```

- [ ] **Step 4: validar empacotamento**

Run: `node scripts/check-package-files.mjs`
Expected: `check-package-files: OK …` (sem novos requires locais em main/preload).

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "feat(import): IPC dialog:openDocument + file:readBinary + menu Importar"
```

## Task B8: fluxo de importação no renderer (preview + salvar)

**Files:**
- Modify: `renderer/convert-ui.js`, `renderer/index.html` (modal), `renderer/renderer.js` (fiação)

- [ ] **Step 1: modal de importação no index.html**

Em `renderer/index.html`, antes do `</body>` (próximo ao fim, junto dos outros modais), adicione:

```html
  <div id="import-modal" class="modal hidden">
    <div class="modal-card import-card">
      <h3 id="import-title">Importar documento</h3>
      <div id="import-status" class="import-status"></div>
      <progress id="import-progress" max="100" value="0" class="hidden"></progress>
      <textarea id="import-md" class="import-md" spellcheck="false"
                placeholder="O Markdown convertido aparecerá aqui para revisão…"></textarea>
      <div class="modal-actions">
        <label class="import-path-row full">Salvar em (caminho .md)
          <input id="import-path" type="text" placeholder="referencias/meu-doc.md" />
        </label>
        <div class="row-buttons">
          <button id="import-save" class="primary" disabled>💾 Salvar conceito</button>
          <button id="import-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: estilos mínimos do modal**

Em `renderer/styles.css`, ao final, adicione:

```css
.import-card { width: min(860px, 92vw); max-height: 88vh; display: flex; flex-direction: column; }
.import-md { flex: 1; min-height: 320px; width: 100%; font-family: Consolas, monospace; font-size: 13px; resize: vertical; }
.import-status { font-size: 13px; opacity: .85; margin: 4px 0; min-height: 18px; }
.import-path-row { display: block; margin: 8px 0; }
.row-buttons { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 3: lógica de importação em convert-ui.js**

Acrescente dentro da IIFE de `renderer/convert-ui.js` (antes do `window.OKFConvertUI = …`), e inclua as novas funções no objeto exportado:

```js
  let importDraft = null; // { images: [...] }

  function suggestImportPath(meta, fileName) {
    const base = (meta && meta.title) ? meta.title : fileName.replace(/\.[^.]+$/, '');
    const slug = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
    return 'referencias/' + slug + '.md';
  }

  async function importDocument() {
    if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
    const filePath = await window.okf.openDocumentDialog();
    if (!filePath) return;
    const file = await window.okf.readBinary(filePath);
    const bytes = new Uint8Array(file.bytes);

    $('import-modal').classList.remove('hidden');
    $('import-md').value = '';
    $('import-save').disabled = true;
    $('import-status').textContent = 'Convertendo ' + file.name + '…';
    const prog = $('import-progress');
    prog.classList.add('hidden'); prog.value = 0;

    try {
      const res = await window.OKFConvert.convert(bytes, file.ext, {
        onStatus: (s) => { $('import-status').textContent = s; },
        onProgress: (p) => { prog.classList.remove('hidden'); prog.value = Math.round((p || 0) * 100); }
      });
      importDraft = { images: res.images || [] };
      $('import-md').value = res.markdown || '';
      $('import-path').value = suggestImportPath(res.meta, file.name);
      $('import-status').textContent = 'Pronto — revise e salve. ' +
        (res.images && res.images.length ? res.images.length + ' imagem(ns) serão salvas em assets/.' : '');
      prog.classList.add('hidden');
      $('import-save').disabled = false;
    } catch (e) {
      $('import-status').textContent = 'Falha na conversão: ' + ((e && e.message) || e);
      prog.classList.add('hidden');
    }
  }

  function closeImport() { $('import-modal').classList.add('hidden'); importDraft = null; }

  async function saveImport() {
    let rel = $('import-path').value.trim().replace(/^\/+/, '');
    if (!rel) { toast('Informe o caminho .md.', 'bad'); return; }
    if (!rel.toLowerCase().endsWith('.md')) rel += '.md';
    if (state.docs.some(d => d.relPath === rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }

    let body = $('import-md').value;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const ops = [];
    const images = (importDraft && importDraft.images) || [];

    if (images.length) {
      const assetsDir = (dir ? dir + '/' : '') + 'assets';
      const used = new Set();
      const map = {};
      for (const img of images) {
        let nameBase = window.OKFConvert.slugifyAsset(img.suggestedName || (img.tempId + '.png'));
        let name = nameBase, k = 1;
        while (used.has(name)) { name = nameBase.replace(/(\.[a-z0-9]+)$/, '-' + (k++) + '$1'); }
        used.add(name);
        const relImg = assetsDir + '/' + name;
        map[img.tempId] = 'assets/' + name; // relativo ao .md
        ops.push({ op: 'create', relPath: relImg, content: img.bytes, binary: true });
      }
      body = window.OKFConvert.rewriteImageLinks(body, map);
    }

    const title = (importDraft && importDraft.meta && importDraft.meta.title) ||
      baseNameOf(rel).replace(/\.md$/i, '');
    const fm = { type: 'reference', title, timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    const content = OKF.serialize(fm, body.startsWith('#') ? body : ('# ' + title + '\n\n' + body));
    ops.unshift({ op: 'create', relPath: rel, content });

    closeImport();
    const ok = await applyOpsAndRefresh(ops, rel);
    if (ok) toast('Documento importado: ' + rel, 'good');
  }
```

E atualize o export:

```js
  window.OKFConvertUI = { exportCurrentPdf, importDocument, closeImport, saveImport };
```

- [ ] **Step 4: suportar ops binárias em main.js**

`saveImport` envia `op.binary` com `content` como `Uint8Array`. Ajuste `fs:applyOps` em `main.js` (linhas 289-293) para gravar binário quando marcado. Substitua o ramo de create/write:

```js
      if (op.op === 'create' || op.op === 'write') {
        const target = safeJoin(root, op.relPath);
        if (op.op === 'create' && fs.existsSync(target)) throw new Error('Já existe um arquivo em ' + op.relPath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (op.binary) await fsp.writeFile(target, Buffer.from(op.content));
        else await fsp.writeFile(target, op.content, 'utf8');
      } else if (op.op === 'delete') {
```

- [ ] **Step 5: fiar menu/botão/paleta em renderer.js**

Em `renderer/renderer.js`, em `init()` (junto às outras `onMenu`):

```js
  window.okf.onMenu('menu:import-doc', () => window.OKFConvertUI.importDocument());
```

Ainda em `init()`, fiar os botões do modal:

```js
  $('import-cancel').addEventListener('click', () => window.OKFConvertUI.closeImport());
  $('import-save').addEventListener('click', () => window.OKFConvertUI.saveImport());
```

E em `paletteActions()`, acrescente:

```js
    { label: 'Importar documento (PDF/DOCX/HTML/TXT)', run: () => window.OKFConvertUI.importDocument(), needsLib: true },
```

- [ ] **Step 6: verificação manual no app**

Run: `npm start`
Faça, para cada formato (TXT, HTML, DOCX, PDF de texto, e um PDF escaneado):
1. Abrir biblioteca de exemplo → `Ctrl+I` (Importar documento) → escolher arquivo.
2. Conferir o preview no modal (títulos, listas, tabelas; OCR no escaneado mostra progresso).
3. Ajustar o caminho `.md` → Salvar conceito.
Expected: o conceito aparece na árvore com frontmatter (`type: reference`, `title`, `timestamp`); imagens de DOCX são gravadas em `assets/` e exibidas; nada é gravado se você cancelar.

- [ ] **Step 7: Commit**

```bash
git add renderer/convert-ui.js renderer/index.html renderer/styles.css renderer/renderer.js main.js
git commit -m "feat(import): fluxo de importação (preview, salvar com assets e frontmatter)"
```

## Task B9: empacotamento da importação

**Files:**
- Modify: `package.json` (`build.files`, `build.extraResources`)

- [ ] **Step 1: garantir o bundle e os assets no pacote**

`renderer/**/*` já cobre `renderer/vendor/convert.bundle.js`, `vendor/pdf.worker.min.mjs`, os arquivos do tesseract e `renderer/vendor/tessdata/*`. Confirme que o `.gitignore` não exclui `renderer/vendor/`. Se excluir, adicione exceções:

```
!renderer/vendor/
!renderer/vendor/**
```

- [ ] **Step 2: validar build**

Run: `node scripts/check-package-files.mjs && npm run build:convert`
Expected: check OK e bundle (re)gerado sem erros.

- [ ] **Step 3: (opcional) build empacotado de fumaça**

Run: `npm run dist:portable`
Expected: gera o portável em `dist/` sem erro de "Cannot find module". (Se demorar/sem ambiente, registre como pendência de verificação.)

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "build(import): garante bundle e assets de runtime no pacote"
```

## Task B10: agregação de testes e documentação

**Files:**
- Modify: `package.json` (`scripts.test`), `README.md`

- [ ] **Step 1: incluir os testes na suíte**

Em `package.json`, ajuste o script `test` para incluir o núcleo de conversão (mantendo o existente):

```json
    "test": "node test-okf.js && node test-auto.js && node test-templates.js && node test-convert.js",
```

- [ ] **Step 2: rodar a suíte**

Run: `npm test`
Expected: todas as suítes terminam com OK (incl. `CONVERT OK`).

- [ ] **Step 3: documentar no README**

Em `README.md`, na lista "O que o app faz", adicione dois itens descrevendo: (a) **Importar documento** (PDF/DOCX/HTML/TXT → Markdown, com OCR local para PDFs escaneados, abrindo um preview para revisar e salvar como conceito; imagens vão para `assets/`); (b) **Exportar como PDF** (gera um PDF do conceito atual via Chromium embutido, A4). Use a redação concisa no estilo dos itens existentes.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "test+docs: suíte inclui test-convert; README documenta importar/exportar"
```

---

## Self-Review (preenchido na escrita do plano)

**Cobertura da spec:**
- Motor local heurístico + OCR → Tasks B4 (heurística), B6 (pdf.js + tesseract.js).
- PDF/DOCX/HTML/TXT → B6 dispatcher (B2/B3/B4 núcleo).
- Preview no editor, salvar depois → B8 (modal de preview + salvar manual).
- Imagens em `assets/` + reescrita de links + frontmatter OKF → B5 + B8 (+ ops binárias).
- MD→PDF só do conceito atual via printToPDF → A1–A5.
- Integração UI (menu/paleta/botão) → A4, B8.
- Empacotamento (`build.files`/`extraResources`/check) → A6, B1, B9.
- Tratamento de erros (conversão/printToPDF/cancelar) → try/catch em B6/B8/A2 e diálogo de save cancelável.
- Testes padrão `test-*.js` → A5, B2–B5, B10.

**Notas de risco (não bloqueiam, mas observe na execução):**
- Bundlar `pdfjs-dist` ESM legacy via esbuild e o `workerSrc` apontando para `vendor/pdf.worker.min.mjs` podem exigir ajuste de caminho conforme a versão instalada.
- Caminhos de `workerPath/corePath/langPath` do `tesseract.js` sob CSP `'self'`: validados na verificação manual da B8 (OCR). Se o worker reclamar, confirme `worker-src 'self' blob:` e os arquivos copiados em `renderer/vendor/`.
- Extração de imagens embutidas de **PDF** ficou fora do v1 do dispatcher (B6 retorna `images: []` para PDF); imagens de **DOCX** são primeira-classe. Texto/tabelas do PDF são o foco da fidelidade.

**Consistência de tipos/nomes:** `convert(bytes, ext, opts)`, `reconstructMarkdown(items)`, `htmlToMarkdown`, `txtToMarkdown`, `slugifyAsset`, `rewriteImageLinks`, `buildPdfHtml`, `renderPdf`, `registerPdfHandlers`, placeholder `okf-img:<tempId>`, ops `{op,relPath,content,binary}` — usados de forma idêntica entre tasks.
