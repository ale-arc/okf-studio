# Modelos do usuário (fora da biblioteca) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar os modelos de conceito propriedade do usuário — arquivos `.md` em `userData/templates/`, reutilizáveis em qualquer biblioteca, com CRUD via um diálogo dedicado e os 5 padrões semeados na 1ª execução.

**Architecture:** Um módulo novo `templates.js` no processo principal faz o IO em `app.getPath('userData')/templates/`, guarda os defaults e helpers puros. O renderer carrega os `.md` por IPC e os parseia com o `OKF` já existente (sem duplicar parsing). `CONCEPT_TEMPLATES` (objeto fixo no renderer) é removido.

**Tech Stack:** Electron, JavaScript puro, `js-yaml`/`OKF` (parse/serialize), IPC `ipcMain.handle`/`contextBridge`. Testes: Node (`node test-*.js`) + smoke Electron (`npm run test:ui`).

**Spec:** `docs/superpowers/specs/2026-06-25-modelos-do-usuario-design.md`

---

## Estrutura de arquivos

- `templates.js` — **CRIAR** (módulo do processo principal): `DEFAULTS`, `sanitizeName`, `templatesDir`, `safeTemplatePath`, `registerTemplateHandlers(ipcMain)`.
- `test-templates.js` — **CRIAR**: testes Node das partes puras (`DEFAULTS`, `sanitizeName`) + parse dos defaults via `OKF`.
- `main.js` — **MODIFICAR**: `require('./templates.js')` + `registerTemplateHandlers(ipcMain)`; item de menu **Arquivo ▸ Modelos…**.
- `preload.js` — **MODIFICAR**: `window.okf.templates.*` + canal `menu:templates`.
- `renderer/renderer.js` — **MODIFICAR**: remover `CONCEPT_TEMPLATES`; `loadTemplates`/`applyTemplateToForm`; refatorar `openModal`/troca de modelo/`createConcept`; diálogo "Modelos"; wiring.
- `renderer/index.html` — **MODIFICAR**: `#templates-modal` + botão ⚙ no "Novo conceito".
- `renderer/styles.css` — **MODIFICAR**: estilos do diálogo de modelos.
- `package.json` — **MODIFICAR**: `templates.js` em `build.files`; script `test:templates`.
- `test-renderer.js` — **MODIFICAR**: smoke dos modelos passa a aguardar o bridge.

## Convenções fixadas (usar exatamente)

- Pasta: `path.join(app.getPath('userData'), 'templates')`.
- Modelo = `<Nome>.md`; nome = arquivo sem `.md`.
- `DEFAULTS`: array `[{name, content}]` (6 itens). "Em branco" sem frontmatter; os demais com `type`.
- `sanitizeName(name)`: trim; rejeita vazio e qualquer um de `/ \ : * ? " < > |`.
- IPC: `templates:list`, `templates:save` (`{name, content, oldName}`), `templates:delete` (`{name}`), `templates:restoreDefaults`, `templates:dir`.
- Bridge: `window.okf.templates.{list,save,remove,restoreDefaults,dir}`.
- Renderer: `state.templates = [{name,type,description,tags,body}]`.

---

## Task 1: Módulo `templates.js` + testes puros

**Files:**
- Create: `templates.js`
- Create: `test-templates.js`
- Modify: `package.json` (script `test:templates`)

- [ ] **Step 1: Escrever `test-templates.js` (vai falhar — módulo não existe)**

```js
// test-templates.js — testes das partes puras de templates.js (sem Electron)
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const T = require('./templates.js');

let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }
function throws(fn, msg) { n++; let t = false; try { fn(); } catch (e) { t = true; } if (!t) { fail++; console.error('FAIL (esperava erro):', msg); } }

// DEFAULTS: 6 itens, nomes únicos
ok(Array.isArray(T.DEFAULTS) && T.DEFAULTS.length === 6, 'DEFAULTS tem 6 modelos');
ok(new Set(T.DEFAULTS.map(d => d.name)).size === 6, 'nomes de DEFAULTS são únicos');
ok(T.DEFAULTS.some(d => d.name === 'Em branco'), 'inclui "Em branco"');

// Cada default parseia; só "Em branco" sem type
for (const d of T.DEFAULTS) {
  const p = OKF.parse(d.content);
  if (d.name === 'Em branco') ok(!p.frontmatter.type, '"Em branco" sem type');
  else ok(!!p.frontmatter.type, d.name + ' tem type');
}

// sanitizeName
ok(T.sanitizeName('Projeto') === 'Projeto', 'aceita nome simples');
ok(T.sanitizeName('  Notas de reunião  ') === 'Notas de reunião', 'apara espaços');
throws(() => T.sanitizeName(''), 'rejeita vazio');
throws(() => T.sanitizeName('   '), 'rejeita só-espaços');
throws(() => T.sanitizeName('a/b'), 'rejeita barra');
throws(() => T.sanitizeName('a\\b'), 'rejeita contra-barra');
throws(() => T.sanitizeName('x:y'), 'rejeita dois-pontos');
throws(() => T.sanitizeName('x*?'), 'rejeita curinga');

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('TEMPLATES OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-templates.js`
Expected: FAIL — `Cannot find module './templates.js'`.

- [ ] **Step 3: Criar `templates.js`**

```js
'use strict';
// Modelos de conceito do USUÁRIO (fora de qualquer biblioteca).
// Cada modelo é um .md em app.getPath('userData')/templates/. Nome do arquivo = nome do modelo.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULTS = [
  { name: 'Em branco', content: 'Descreva aqui.\n' },
  { name: 'Projeto', content: '---\ntype: Projeto\n---\n\n## Objetivo\n\n\n## Status\n\n\n## Marcos\n\n' },
  { name: 'Processo', content: '---\ntype: Processo\n---\n\n## Quando usar\n\n\n## Passos\n\n1. \n\n## Responsáveis\n\n' },
  { name: 'Métrica', content: '---\ntype: Métrica\n---\n\n## Definição\n\n\n## Como calcular\n\n\n## Fonte\n\n' },
  { name: 'Referência', content: '---\ntype: Referência\n---\n\n## Resumo\n\n\n## Detalhes\n\n' },
  { name: 'Playbook', content: '---\ntype: Playbook\n---\n\n## Gatilho\n\n\n## Passos\n\n1. \n\n## Pós-ação\n\n' },
];

const INVALID = /[\/\\:*?"<>|]/;
function sanitizeName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw new Error('Nome do modelo vazio.');
  if (INVALID.test(n)) throw new Error('Nome inválido (não use / \\ : * ? " < > |).');
  return n;
}

function templatesDir() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'templates');
}

function safeTemplatePath(name) {
  const dir = templatesDir();
  const target = path.resolve(dir, sanitizeName(name) + '.md');
  if (path.dirname(target) !== path.resolve(dir)) throw new Error('Caminho de modelo inválido.');
  return target;
}

function registerTemplateHandlers(ipcMain) {
  ipcMain.handle('templates:list', async () => {
    const dir = templatesDir();
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      for (const t of DEFAULTS) await fsp.writeFile(path.join(dir, t.name + '.md'), t.content, 'utf8');
    }
    const out = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/i, ''), content: await fsp.readFile(path.join(dir, e.name), 'utf8') });
      }
    }
    out.sort((a, b) => a.name === 'Em branco' ? -1 : b.name === 'Em branco' ? 1 : a.name.localeCompare(b.name));
    return out;
  });

  ipcMain.handle('templates:save', async (_e, { name, content, oldName }) => {
    try {
      const safeNew = sanitizeName(name);
      const target = safeTemplatePath(safeNew);
      const renaming = oldName && sanitizeName(oldName) !== safeNew;
      const creating = !oldName;
      if ((creating || renaming) && fs.existsSync(target)) {
        return { ok: false, error: 'Já existe um modelo chamado "' + safeNew + '".' };
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
      if (renaming) await fsp.rm(safeTemplatePath(oldName), { force: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('templates:delete', async (_e, { name }) => {
    try { await fsp.rm(safeTemplatePath(name), { force: true }); return { ok: true }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('templates:restoreDefaults', async () => {
    const dir = templatesDir();
    await fsp.mkdir(dir, { recursive: true });
    let created = 0;
    for (const t of DEFAULTS) {
      const p = path.join(dir, t.name + '.md');
      if (!fs.existsSync(p)) { await fsp.writeFile(p, t.content, 'utf8'); created++; }
    }
    return { ok: true, created };
  });

  ipcMain.handle('templates:dir', async () => templatesDir());
}

module.exports = { DEFAULTS, sanitizeName, templatesDir, safeTemplatePath, registerTemplateHandlers };
```

- [ ] **Step 4: Adicionar o script `test:templates` em `package.json`**

Em `"scripts"`, após `"test:auto": "node test-auto.js",` adicionar:

```json
    "test:templates": "node test-templates.js",
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node test-templates.js`
Expected: PASS — termina com `TEMPLATES OK`.

- [ ] **Step 6: Confirmar que `templates.js` carrega em Node sem Electron**

Run: `node -e "const t=require('./templates.js'); console.log('DEFAULTS', t.DEFAULTS.length, 'fns', typeof t.sanitizeName, typeof t.registerTemplateHandlers)"`
Expected: `DEFAULTS 6 fns function function` (electron só é exigido dentro das funções, não no topo).

- [ ] **Step 7: Commit**

```bash
git add templates.js test-templates.js package.json
git commit -m "feat(templates): módulo templates.js (defaults + sanitizeName + IPC) e testes puros"
```

---

## Task 2: Integração no main + preload + empacotamento

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `package.json` (`build.files`)

- [ ] **Step 1: Registrar o módulo em `main.js`**

Após `const { registerGitHandlers } = require('./git.js');` (linha ~10), adicionar:

```js
const { registerTemplateHandlers } = require('./templates.js');
```

Após `registerGitHandlers(ipcMain, () => currentRoot);` (linha ~375), adicionar:

```js
registerTemplateHandlers(ipcMain);
```

- [ ] **Step 2: Adicionar o item de menu "Modelos…" em `main.js`**

No submenu `Arquivo`, logo após o item "Novo conceito…" (o que envia `menu:new-concept`), inserir:

```js
        {
          label: 'Modelos…',
          click: () => mainWindow.webContents.send('menu:templates')
        },
```

- [ ] **Step 3: Expor o bridge em `preload.js`**

Após o objeto `git: {...}` (antes de `onMenu`), inserir:

```js
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (payload) => ipcRenderer.invoke('templates:save', payload),
    remove: (payload) => ipcRenderer.invoke('templates:delete', payload),
    restoreDefaults: () => ipcRenderer.invoke('templates:restoreDefaults'),
    dir: () => ipcRenderer.invoke('templates:dir')
  },
```

E adicionar `'menu:templates'` ao array `valid` de `onMenu`:

```js
    const valid = [
      'menu:open-folder', 'menu:open-sample', 'menu:new-concept', 'menu:new-library',
      'menu:save', 'menu:reload', 'menu:validate', 'menu:graph', 'menu:about', 'menu:manual',
      'menu:rebuild-indexes', 'menu:templates'
    ];
```

- [ ] **Step 4: Adicionar `templates.js` ao `build.files` em `package.json`**

No array `build.files`, após `"git.js",` adicionar:

```json
      "templates.js",
```

- [ ] **Step 5: Verificações estáticas**

Run: `node --check main.js`
Expected: sem erro.

Run: `node --check preload.js`
Expected: sem erro.

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: `package.json OK`.

Run: `npm run check:files`
Expected: `check-package-files: OK (...)` — o `require('./templates.js')` está coberto por `build.files`.

Run: `node test-okf.js && node test-auto.js && node test-templates.js`
Expected: `TESTE OK`, `AUTO OK`, `TEMPLATES OK`.

(Verificação interativa do menu via `npm start` fica para o controlador humano.)

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js package.json
git commit -m "feat(templates): registra IPC no main, bridge no preload, menu Modelos… e build.files"
```

---

## Task 3: Renderer — consumir modelos do usuário

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Adicionar `templates: []` ao objeto `state`**

No objeto `state` (linha ~4), após `editorBody: ''`, garantir as linhas (a `linkSuggestions` já existe):

```js
  editorBody: '',
  linkSuggestions: [],
  templates: [],
```

(Se `linkSuggestions: [],` já estiver presente, apenas adicione `templates: [],` logo após.)

- [ ] **Step 2: Remover o objeto fixo `CONCEPT_TEMPLATES`**

Excluir o bloco inteiro (linhas ~17–26):

```js
/* ---------- Modelos de conceito (por tipo) ---------- */
const CONCEPT_TEMPLATES = {
  'Em branco': { type: '', body: 'Descreva aqui.\n' },
  'Projeto':   { type: 'Projeto',   body: '## Objetivo\n\n\n## Status\n\n\n## Marcos\n\n' },
  'Processo':  { type: 'Processo',  body: '## Quando usar\n\n\n## Passos\n\n1. \n\n## Responsáveis\n\n' },
  'Métrica':   { type: 'Métrica',   body: '## Definição\n\n\n## Como calcular\n\n\n## Fonte\n\n' },
  'Referência':{ type: 'Referência',body: '## Resumo\n\n\n## Detalhes\n\n' },
  'Playbook':  { type: 'Playbook',  body: '## Gatilho\n\n\n## Passos\n\n1. \n\n## Pós-ação\n\n' }
};
window.__okfTemplates = CONCEPT_TEMPLATES; // exposto para o smoke test
```

- [ ] **Step 3: Adicionar `loadTemplates` e `applyTemplateToForm`**

No lugar onde estava o bloco removido (logo após o comentário de tema ou antes de `/* ---------- Toast ---------- */`), inserir:

```js
/* ---------- Modelos do usuário (fora da biblioteca) ---------- */
async function loadTemplates() {
  try {
    const raw = await window.okf.templates.list();
    state.templates = (raw || []).map(t => {
      const p = OKF.parse(t.content);
      const f = p.frontmatter || {};
      return {
        name: t.name,
        type: f.type ? String(f.type) : '',
        description: f.description ? String(f.description) : '',
        tags: Array.isArray(f.tags) ? f.tags.map(String) : (f.tags ? [String(f.tags)] : []),
        body: p.body || ''
      };
    });
  } catch (e) { state.templates = []; }
  window.__okfTemplates = state.templates; // usado pelo smoke test
}
function applyTemplateToForm(name) {
  const t = state.templates.find(x => x.name === name);
  if (!t) return;
  $('m-type').value = t.type || '';
  $('m-description').value = t.description || '';
  $('m-tags').value = (t.tags || []).join(', ');
}
```

- [ ] **Step 4: Chamar `loadTemplates()` no `init()`**

Em `init()`, junto às inicializações finais (perto de `initTheme(); loadVersion(); wireUpdates();`), adicionar:

```js
  loadTemplates();
```

- [ ] **Step 5: Refatorar `openModal` para usar `state.templates`**

Em `openModal`, substituir o trecho que popula o select de modelo:

```js
  const tplSel = $('m-template');
  if (!tplSel.options.length) tplSel.innerHTML = Object.keys(CONCEPT_TEMPLATES).map(n => `<option>${escapeHtml(n)}</option>`).join('');
  tplSel.value = 'Em branco';
```

por:

```js
  const tplSel = $('m-template');
  tplSel.innerHTML = state.templates.map(t => `<option>${escapeHtml(t.name)}</option>`).join('');
  tplSel.value = state.templates.some(t => t.name === 'Em branco') ? 'Em branco'
    : (state.templates[0] ? state.templates[0].name : '');
  applyTemplateToForm(tplSel.value);
```

(O `applyTemplateToForm` vem DEPOIS da limpeza dos campos `['m-path','m-type','m-title','m-description','m-tags']`, que já é a primeira linha de `openModal` — mantenha essa ordem.)

- [ ] **Step 6: Refatorar `createConcept` para usar o corpo do modelo**

Em `createConcept`, substituir:

```js
  const tpl = CONCEPT_TEMPLATES[$('m-template').value] || CONCEPT_TEMPLATES['Em branco'];
  const content = OKF.serialize(fm, '# ' + title + '\n\n' + tpl.body);
```

por:

```js
  const tpl = state.templates.find(t => t.name === $('m-template').value);
  const body = tpl ? tpl.body : '';
  const content = OKF.serialize(fm, '# ' + title + '\n\n' + body);
```

- [ ] **Step 7: Refatorar o listener de troca de modelo no `init()`**

Substituir o listener atual:

```js
  $('m-template').addEventListener('change', () => {
    const tpl = CONCEPT_TEMPLATES[$('m-template').value];
    if (tpl && tpl.type && !$('m-type').value.trim()) $('m-type').value = tpl.type;
  });
```

por:

```js
  $('m-template').addEventListener('change', () => applyTemplateToForm($('m-template').value));
```

- [ ] **Step 8: Verificações**

Run: `node --check renderer/renderer.js`
Expected: sem erro.

Run: `grep -n "CONCEPT_TEMPLATES" renderer/renderer.js`
Expected: nenhum resultado (referência totalmente removida).

Run: `node test-okf.js && node test-auto.js && node test-templates.js`
Expected: todos OK.

(Verificação GUI fica para o humano: ao abrir "＋ Novo", o seletor de Modelo deve listar os 6 modelos; trocar de modelo preenche Tipo/Descrição/Tags; criar gera o corpo do modelo.)

- [ ] **Step 9: Commit**

```bash
git add renderer/renderer.js
git commit -m "refactor(templates): renderer consome modelos do usuário (remove CONCEPT_TEMPLATES)"
```

---

## Task 4: Diálogo "Modelos" (CRUD)

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Adicionar o botão ⚙ ao lado do seletor de modelo (index.html)**

No `#modal`, substituir o label "Modelo":

```html
        <label>Modelo
          <select id="m-template"></select>
        </label>
```

por:

```html
        <label>Modelo
          <span class="m-tpl-row">
            <select id="m-template"></select>
            <button id="m-templates-manage" type="button" class="mini" title="Gerenciar modelos">⚙</button>
          </span>
        </label>
```

- [ ] **Step 2: Adicionar o `#templates-modal` (index.html)**

Após o `#newlib-modal` (depois do `</div>` que o fecha), inserir:

```html
  <!-- Gerenciar modelos -->
  <div id="templates-modal" class="modal hidden">
    <div class="modal-card tpl-card">
      <h2>Modelos</h2>
      <div class="tpl-wrap">
        <div id="tpl-list" class="tpl-list"></div>
        <div class="tpl-form">
          <label>Nome
            <input id="tpl-name" type="text" placeholder="Ex.: Reunião" />
          </label>
          <label>Tipo (type)
            <input id="tpl-type" type="text" placeholder="Ex.: Reunião" />
          </label>
          <label>Descrição (description)
            <input id="tpl-description" type="text" />
          </label>
          <label>Tags (separadas por vírgula)
            <input id="tpl-tags" type="text" placeholder="vendas, receita" />
          </label>
          <label class="full">Corpo (markdown)
            <textarea id="tpl-body" spellcheck="false"></textarea>
          </label>
        </div>
      </div>
      <p id="tpl-dir" class="tpl-dir"></p>
      <div class="modal-actions tpl-actions">
        <button id="tpl-new">Novo</button>
        <button id="tpl-restore">Restaurar padrões</button>
        <span class="grow"></span>
        <button id="tpl-delete" class="danger">Excluir</button>
        <button id="tpl-save" class="primary">Salvar</button>
        <button id="tpl-close">Fechar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Estilos do diálogo (styles.css)**

Ao final de `renderer/styles.css`, adicionar:

```css
.m-tpl-row{display:flex;gap:6px;margin-top:5px;align-items:center}
.m-tpl-row select{flex:1;font-size:14px;color:var(--text)}
.tpl-card{width:680px}
.tpl-wrap{display:grid;grid-template-columns:190px 1fr;gap:16px}
.tpl-list{border:1px solid var(--line);border-radius:8px;max-height:46vh;overflow:auto}
.tpl-list .tpl-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--line)}
.tpl-list .tpl-item:last-child{border-bottom:none}
.tpl-list .tpl-item.sel{background:var(--hover)}
.tpl-form .full{grid-column:auto}
.tpl-form textarea{display:block;width:100%;height:180px;margin-top:5px;font-family:Consolas,monospace;font-size:13px;color:var(--text)}
.tpl-dir{font-size:11px;color:var(--muted);margin:8px 0 6px;word-break:break-all}
.tpl-actions{align-items:center}
```

- [ ] **Step 4: Lógica do diálogo (renderer.js)**

Antes de `/* ---------- Validation ---------- */` (perto de `rebuildIndexes`), inserir:

```js
/* ---------- Diálogo de Modelos ---------- */
let tplSelected = null; // nome do modelo carregado no formulário (null = novo)
async function openTemplates() {
  await loadTemplates();
  clearTplForm();
  try { $('tpl-dir').textContent = 'Pasta: ' + await window.okf.templates.dir(); } catch (e) {}
  $('templates-modal').classList.remove('hidden');
  $('tpl-name').focus();
}
function closeTemplates() { $('templates-modal').classList.add('hidden'); }
function renderTplList() {
  const list = $('tpl-list');
  list.innerHTML = state.templates.map(t =>
    `<div class="tpl-item${t.name === tplSelected ? ' sel' : ''}" data-name="${escapeAttr(t.name)}">${escapeHtml(t.name)}</div>`
  ).join('') || '<div class="tpl-item">Nenhum modelo.</div>';
  list.querySelectorAll('.tpl-item[data-name]').forEach(el =>
    el.addEventListener('click', () => loadTplToForm(el.dataset.name)));
}
function clearTplForm() {
  tplSelected = null;
  ['tpl-name', 'tpl-type', 'tpl-description', 'tpl-tags', 'tpl-body'].forEach(id => $(id).value = '');
  renderTplList();
  $('tpl-name').focus();
}
function loadTplToForm(name) {
  const t = state.templates.find(x => x.name === name);
  if (!t) return;
  tplSelected = name;
  $('tpl-name').value = t.name;
  $('tpl-type').value = t.type || '';
  $('tpl-description').value = t.description || '';
  $('tpl-tags').value = (t.tags || []).join(', ');
  $('tpl-body').value = t.body || '';
  renderTplList();
}
function refreshTemplateSelect() {
  if ($('modal').classList.contains('hidden')) return;
  const tplSel = $('m-template');
  const cur = tplSel.value;
  tplSel.innerHTML = state.templates.map(t => `<option>${escapeHtml(t.name)}</option>`).join('');
  if (state.templates.some(t => t.name === cur)) tplSel.value = cur;
  else tplSel.value = state.templates.some(t => t.name === 'Em branco') ? 'Em branco'
    : (state.templates[0] ? state.templates[0].name : '');
  applyTemplateToForm(tplSel.value);
}
async function saveTpl() {
  const name = $('tpl-name').value.trim();
  if (!name) { toast('Informe o nome do modelo.', 'bad'); return; }
  if (/[\/\\:*?"<>|]/.test(name)) { toast('Nome inválido (não use / \\ : * ? " < > |).', 'bad'); return; }
  const fm = {};
  const type = $('tpl-type').value.trim(); if (type) fm.type = type;
  const desc = $('tpl-description').value.trim(); if (desc) fm.description = desc;
  const tags = $('tpl-tags').value.split(',').map(s => s.trim()).filter(Boolean); if (tags.length) fm.tags = tags;
  const content = OKF.serialize(fm, $('tpl-body').value);
  const r = await window.okf.templates.save({ name, content, oldName: tplSelected });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  await loadTemplates();
  tplSelected = name; renderTplList(); refreshTemplateSelect();
  toast('Modelo salvo: ' + name, 'good');
}
async function deleteTpl() {
  if (!tplSelected) { toast('Selecione um modelo na lista.', 'bad'); return; }
  const ok = await window.okf.confirm({ message: 'Excluir o modelo?', detail: tplSelected });
  if (!ok) return;
  const r = await window.okf.templates.remove({ name: tplSelected });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  await loadTemplates(); clearTplForm(); refreshTemplateSelect();
  toast('Modelo excluído', 'good');
}
async function restoreTpl() {
  const r = await window.okf.templates.restoreDefaults();
  if (!r || !r.ok) { toast('Erro ao restaurar padrões.', 'bad'); return; }
  await loadTemplates(); renderTplList(); refreshTemplateSelect();
  toast((r.created || 0) + ' modelo(s) padrão restaurado(s).', 'good');
}
```

- [ ] **Step 5: Wiring no `init()` (renderer.js)**

Após o wiring do `#m-create` / `#m-category` (perto das ações do modal de criar), inserir:

```js
  $('m-templates-manage').onclick = openTemplates;
  $('tpl-new').onclick = clearTplForm;
  $('tpl-save').onclick = saveTpl;
  $('tpl-delete').onclick = deleteTpl;
  $('tpl-restore').onclick = restoreTpl;
  $('tpl-close').onclick = closeTemplates;
  window.okf.onMenu('menu:templates', openTemplates);
```

E na `paletteActions()`, adicionar (junto da ação "Reconstruir índices"):

```js
    { label: 'Gerenciar modelos', run: openTemplates, needsLib: false },
```

E no handler de `Escape` (a linha que já chama closeModal/closeRename/closeNewLib/…), adicionar `closeTemplates();` junto aos demais closers.

- [ ] **Step 6: Verificações**

Run: `node --check renderer/renderer.js`
Expected: sem erro.

Run: `grep -n "openTemplates\|saveTpl\|deleteTpl\|restoreTpl\|refreshTemplateSelect" renderer/renderer.js`
Expected: cada função definida 1× e referenciada no wiring.

Run: `node test-okf.js && node test-auto.js && node test-templates.js`
Expected: todos OK.

(GUI humano: ⚙/menu/paleta abrem o diálogo; criar/salvar/renomear/excluir/restaurar refletem na lista e no seletor do "Novo conceito"; a pasta aparece no rodapé.)

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js
git commit -m "feat(templates): diálogo Modelos (CRUD) + atalho ⚙, menu e paleta"
```

---

## Task 5: Atualizar smoke + documentação

**Files:**
- Modify: `test-renderer.js`
- Modify: `README.md`

- [ ] **Step 1: Tornar o check de modelos assíncrono no `test-renderer.js`**

Remover do objeto `result` a linha:

```js
    templates: !!(window.__okfTemplates && Object.keys(window.__okfTemplates).length >= 6),
```

Após o bloco que calcula `const result = await win.webContents.executeJavaScript(...)` (antes de `const roundtrip = ...`), inserir um check dedicado que aguarda o bridge:

```js
  const templatesCheck = await win.webContents.executeJavaScript(`(async () => {
    const t = await window.okf.templates.list();
    return Array.isArray(t) && t.length >= 6;
  })()`);
  console.log('  modelos (bridge):', templatesCheck);
```

Substituir o cálculo de `okExtra`:

```js
  const okExtra = result.paletteUI === true && result.templates === true;
```

por:

```js
  const okExtra = result.paletteUI === true && templatesCheck === true;
```

E na linha de log `console.log('  paleta + modelos:', result.paletteUI, result.templates);` trocar `result.templates` por `templatesCheck`:

```js
  console.log('  paleta + modelos:', result.paletteUI, templatesCheck);
```

- [ ] **Step 2: Rodar o smoke Electron**

Run: `npm run test:ui`
Expected: `RESULT: PASS` (o `templates:list` semeia os 6 padrões no `userData` de teste e retorna ≥ 6; sem violações de CSP). Feche a janela se necessário.

- [ ] **Step 3: Atualizar o README**

Na seção "## O que o app faz", o item "Modelos por tipo" deve refletir a nova realidade. Substituir o bullet existente de modelos por:

```markdown
- **Modelos do usuário** — ao criar um conceito, escolha um modelo que gera a
  estrutura do corpo e pré-preenche `type`/`description`/`tags`. Os modelos são
  **seus** (ficam em `%APPDATA%/OKF Studio/templates/`, não na biblioteca) e
  valem para qualquer biblioteca. Gerencie-os (criar, editar, renomear, excluir,
  restaurar padrões) em **Arquivo ▸ Modelos…** ou pelo ⚙ no "Novo conceito".
```

(Se o texto exato do bullet antigo divergir, localize o item que menciona "Modelos por tipo" e troque-o por este.)

- [ ] **Step 4: Verificação final**

Run: `node test-okf.js && node test-auto.js && node test-templates.js`
Expected: todos OK.

- [ ] **Step 5: Commit**

```bash
git add test-renderer.js README.md
git commit -m "test+docs: smoke de modelos via bridge e README dos modelos do usuário"
```

---

## Self-Review (preenchido pelo autor do plano)

**1. Cobertura do spec:**
- Armazenamento `.md` em `userData/templates` → Task 1 (`templates.js`).
- Seed só na 1ª execução (pasta inexistente) + "Restaurar padrões" → Task 1 (`templates:list`, `templates:restoreDefaults`).
- Conteúdo type+corpo+description/tags pré-preenchendo o form → Task 3 (`loadTemplates`, `applyTemplateToForm`, `createConcept`).
- Módulo `templates.js` no main + bridge + menu → Tasks 1, 2.
- Diálogo "Modelos" (lista+form, Novo/Salvar/Excluir/Restaurar) + ⚙/menu/paleta → Task 4.
- Renomear (oldName) e validação de nome → Task 1 (`templates:save`) + Task 4 (`saveTpl`).
- Empacotamento (`build.files`) → Task 2.
- Testes (Node + smoke) → Tasks 1, 5; pasta exibida via `templates:dir` → Task 4.
- Remoção de `CONCEPT_TEMPLATES` → Task 3.

**2. Placeholders:** nenhum "TBD"/"TODO"; todo passo de código mostra o código.

**3. Consistência de nomes/assinaturas:** IPC `templates:list/save/delete/restoreDefaults/dir` idênticos em `templates.js`, `preload.js` e nas chamadas do renderer (`window.okf.templates.{list,save,remove,restoreDefaults,dir}` — note: o canal é `templates:delete`, exposto como `remove`). `state.templates` com campos `{name,type,description,tags,body}` usados igual em `loadTemplates`/`applyTemplateToForm`/`createConcept`/`loadTplToForm`. `tplSelected`/`oldName` coerentes entre `saveTpl` e `templates:save`. `sanitizeName` (main) e a regex de validação no `saveTpl` (renderer) usam o mesmo conjunto de inválidos.
