# "Tipo é a pasta" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o `type` a pasta do conceito (flat, `slug(type)/slug(titulo).md`), agrupar o índice raiz por tipo, corrigir links quebrados no `index.md` após mover, oferecer migração legada opcional, e reusar o editor visual no modal de import de PDF.

**Architecture:** A lógica pura (slug, mapeamento tipo→pasta, listagem do índice, reescrita de links, planejador de migração) vive em `OKF.auto` (em `renderer/okf.js`), testável em Node. A UI (`renderer/renderer.js`, `renderer/convert-ui.js`, `renderer/index.html`) apenas liga essa lógica. O editor Milkdown (`src/editor/index.js`) ganha uma API por instância para ser reusado no modal de import sem colidir com a edição de conceito.

**Tech Stack:** Electron, JavaScript (sem framework), Milkdown (editor), js-yaml, esbuild (bundle do editor). Testes: scripts Node simples com `assert` (padrão de `test-okf.js`), rodados por `npm test`.

---

## File Structure

- `renderer/okf.js` — **modificar**: adicionar helpers puros em `OKF.auto` (`slugify`, `folderForType`, `pathForConcept`, `typeLabelLookup`, `canonicalType`, `moveTargetForType`, `planReorg`); reescrever `rootListing` (agrupa por tipo); corrigir `rewriteRenameLinks` (não pular `index.md`).
- `test-tipo-pasta.js` — **criar**: testes Node (assert) das funções puras e da regressão do item 3.
- `package.json` — **modificar**: incluir `test-tipo-pasta.js` no script `test`.
- `renderer/renderer.js` — **modificar**: datalist de tipos; `createConcept`/`openModal` (sem caminho); `saveEdit` (troca de tipo = move); helper `performMove`; refator de `doRename` para usar `performMove`; UI de "Reorganizar por tipo"; `metaChanged` inclui `type`.
- `renderer/index.html` — **modificar**: `<datalist>` de tipos; inputs `e-type`/`m-type` com `list=`; remover `m-path`/`m-category`; modal de import com editor visual + `import-type`; modal de prévia de reorganização; botão na barra.
- `src/editor/index.js` — **modificar**: API `createInstance` + wrappers da instância padrão.
- `renderer/convert-ui.js` — **modificar**: modal de import usa editor visual + `import-type`; `saveImport` deriva caminho do tipo.
- `CLAUDE.md` — **modificar**: regra "app é dono da listagem; pasta = tipo".

---

## Task 1: Helpers puros de slug e caminho em `OKF.auto`

**Files:**
- Modify: `renderer/okf.js` (objeto `auto`, ~linha 365)
- Test: `test-tipo-pasta.js` (criar)
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Criar o teste que falha**

Criar `test-tipo-pasta.js`:

```js
const fs = require('fs'), assert = require('assert');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const A = OKF.auto;

// --- Task 1: slugify / folderForType / pathForConcept ---
assert.strictEqual(A.slugify('Referência'), 'referencia');
assert.strictEqual(A.slugify('  Projeto  Atlas '), 'projeto-atlas');
assert.strictEqual(A.slugify('IN_SPU 98/060325'), 'in-spu-98-060325');
assert.strictEqual(A.slugify('***'), '');
assert.strictEqual(A.folderForType('Referência'), 'referencia');
assert.strictEqual(A.folderForType('   '), 'sem-tipo');

const taken = new Set(['referencia/in-spu-98.md']);
assert.strictEqual(A.pathForConcept('Referência', 'IN SPU 98', new Set()), 'referencia/in-spu-98.md');
assert.strictEqual(A.pathForConcept('Referência', 'IN SPU 98', taken), 'referencia/in-spu-98-2.md');
assert.strictEqual(A.pathForConcept('Tabela', '', new Set()), 'tabela/conceito.md');

console.log('Task 1 OK');
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `node test-tipo-pasta.js`
Expected: FAIL — `TypeError: A.slugify is not a function`.

- [ ] **Step 3: Implementar os helpers**

Em `renderer/okf.js`, antes da linha `const auto = { ... }` (~365), adicionar:

```js
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function folderForType(type) { return slugify(type) || 'sem-tipo'; }
  function pathForConcept(type, title, taken) {
    const dir = folderForType(type);
    const base = slugify(title) || 'conceito';
    let name = base, k = 2;
    const has = (n) => (taken && (taken.has ? taken.has(dir + '/' + n + '.md') : false));
    while (has(name)) { name = base + '-' + (k++); }
    return dir + '/' + name + '.md';
  }
```

Adicionar `slugify, folderForType, pathForConcept` à lista do objeto `auto`:

```js
  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor, dirListing, rootListing, mergeManagedBlock, appendLog, relativePath, rewriteRenameLinks, suggestLinks, applySuggestions, libraryFiles, slugify, folderForType, pathForConcept };
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `node test-tipo-pasta.js`
Expected: PASS — imprime `Task 1 OK`.

- [ ] **Step 5: Registrar no `npm test`**

Em `package.json`, alterar a linha do script `test` para:

```json
    "test": "node test-okf.js && node test-tipo-pasta.js && node test-convert.js && node test-watcher-error.js",
```

- [ ] **Step 6: Commit**

```bash
git add renderer/okf.js test-tipo-pasta.js package.json
git commit -m "feat(okf): slugify/folderForType/pathForConcept + harness de teste tipo-pasta"
```

---

## Task 2: `typeLabelLookup` e `canonicalType` (guarda anti-duplicata)

**Files:**
- Modify: `renderer/okf.js`
- Test: `test-tipo-pasta.js`

- [ ] **Step 1: Adicionar teste que falha**

Acrescentar ao fim de `test-tipo-pasta.js` (antes do `console.log` final, ou em novo bloco):

```js
// --- Task 2: typeLabelLookup / canonicalType ---
const docsT2 = [
  { relPath: 'referencia/a.md', content: '---\ntype: Referência\n---\n# A' },
  { relPath: 'tabela/b.md', content: '---\ntype: Tabela\n---\n# B' },
];
const lk = A.typeLabelLookup(docsT2);
assert.strictEqual(lk.get('referencia'), 'Referência');
assert.strictEqual(A.canonicalType('referência', docsT2), 'Referência'); // reaproveita rótulo
assert.strictEqual(A.canonicalType('Processo', docsT2), 'Processo');     // novo, mantém
console.log('Task 2 OK');
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `node test-tipo-pasta.js`
Expected: FAIL — `A.typeLabelLookup is not a function`.

- [ ] **Step 3: Implementar**

Em `renderer/okf.js`, junto aos helpers da Task 1:

```js
  function typeLabelLookup(docs) {
    const map = new Map();
    for (const d of docs) {
      if (isReserved(d.relPath)) continue;
      const t = parse(d.content).frontmatter.type;
      if (t == null || String(t).trim() === '') continue;
      const label = String(t).trim();
      const slug = folderForType(label);
      if (!map.has(slug)) map.set(slug, label);
    }
    return map;
  }
  function canonicalType(input, docs) {
    const label = String(input == null ? '' : input).trim();
    const existing = typeLabelLookup(docs).get(folderForType(label));
    return existing || label;
  }
```

Adicionar `typeLabelLookup, canonicalType` ao objeto `auto`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `node test-tipo-pasta.js`
Expected: PASS — `Task 2 OK`.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-tipo-pasta.js
git commit -m "feat(okf): typeLabelLookup + canonicalType (guarda anti-duplicata de tipo)"
```

---

## Task 3: `rootListing` agrupa por tipo (rótulo do frontmatter)

**Files:**
- Modify: `renderer/okf.js` (função `rootListing`, ~linha 195)
- Test: `test-tipo-pasta.js`

- [ ] **Step 1: Adicionar teste que falha**

Acrescentar a `test-tipo-pasta.js`:

```js
// --- Task 3: rootListing agrupa por tipo, rótulo acentuado ---
const docsT3 = [
  { relPath: 'referencia/a.md', name: 'a.md', content: '---\ntype: Referência\ntitle: Conceito A\n---\n# A' },
  { relPath: 'referencia/b.md', name: 'b.md', content: '---\ntype: Referência\ntitle: Conceito B\n---\n# B' },
  { relPath: 'tabela/c.md', name: 'c.md', content: '---\ntype: Tabela\ntitle: Tabela C\n---\n# C' },
  { relPath: 'd.md', name: 'd.md', content: '---\ntitle: Sem Tipo D\n---\n# D' },
];
const listing = A.rootListing(docsT3);
assert.ok(listing.includes('## Referência'), 'tem seção Referência com acento');
assert.ok(listing.includes('## Tabela'), 'tem seção Tabela');
assert.ok(listing.includes('## Sem tipo'), 'conceito sem type cai em Sem tipo');
assert.ok(listing.indexOf('Conceito A') < listing.indexOf('## Tabela'), 'A está sob Referência');
console.log('Task 3 OK');
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `node test-tipo-pasta.js`
Expected: FAIL — hoje `rootListing` agrupa por pasta (`## Referencia` sem acento; sem `## Sem tipo`).

- [ ] **Step 3: Reescrever `rootListing`**

Substituir a função `rootListing` (em `renderer/okf.js`, ~linha 195-212) por:

```js
  function typeOfDoc(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.type != null && String(f.type).trim() !== '') ? String(f.type).trim() : 'Sem tipo';
  }
  function rootListing(docs) {
    const concepts = docs.filter(d => !isReserved(d.relPath));
    const byType = new Map();
    for (const d of concepts) {
      const t = typeOfDoc(d);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(d);
    }
    const parts = [];
    for (const t of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
      parts.push('## ' + t + '\n' + sortedBullets(byType.get(t)).join('\n'));
    }
    return parts.join('\n\n');
  }
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `node test-tipo-pasta.js`
Expected: PASS — `Task 3 OK`.

- [ ] **Step 5: Rodar a suíte para checar regressões**

Run: `npm test`
Expected: todos os scripts terminam sem erro (saída inclui `TESTE OK` do `test-okf.js`).

- [ ] **Step 6: Commit**

```bash
git add renderer/okf.js test-tipo-pasta.js
git commit -m "feat(okf): rootListing agrupa o índice raiz por tipo (rótulo acentuado)"
```

---

## Task 4: Corrigir `rewriteRenameLinks` para não pular `index.md` (bug do item 3)

**Files:**
- Modify: `renderer/okf.js` (`rewriteRenameLinks`, ~linha 295-324)
- Test: `test-tipo-pasta.js`

- [ ] **Step 1: Adicionar teste de regressão que falha**

Acrescentar a `test-tipo-pasta.js`:

```js
// --- Task 4: regressão item 3 — link em index.md fora do bloco gerenciado ---
const docsT4 = [
  { relPath: 'index.md', name: 'index.md',
    content: '---\nokf_version: "0.1"\n---\n\n# Lib\n\n* [Velho](/referencia/velho.md) - desc\n' },
  { relPath: 'referencia/velho.md', name: 'velho.md',
    content: '---\ntype: Referência\ntitle: Velho\n---\n# Velho' },
];
const changes = A.rewriteRenameLinks(docsT4, 'referencia/velho.md', 'tabela/velho.md');
const idx = changes.find(c => c.relPath === 'index.md');
assert.ok(idx, 'index.md deve estar entre as mudanças (não mais pulado)');
assert.ok(idx.newContent.includes('/tabela/velho.md'), 'link do index aponta para o novo caminho');
assert.ok(!idx.newContent.includes('/referencia/velho.md'), 'link antigo não permanece');
console.log('Task 4 OK');
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `node test-tipo-pasta.js`
Expected: FAIL — `index.md` é pulado, `changes` não o contém.

- [ ] **Step 3: Remover o skip de `index.md`**

Em `renderer/okf.js`, na função `rewriteRenameLinks`, remover a linha que pula `index.md` (~linha 299):

```js
      if (d.relPath.split('/').pop().toLowerCase() === 'index.md') continue; // index é reconstruído à parte
```

(apagar essa linha inteira; o restante do loop trata `index.md` como qualquer outro arquivo, reescrevendo links que apontam para o conceito movido.)

- [ ] **Step 4: Rodar e verificar que passa**

Run: `node test-tipo-pasta.js`
Expected: PASS — `Task 4 OK`.

- [ ] **Step 5: Rodar a suíte**

Run: `npm test`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add renderer/okf.js test-tipo-pasta.js
git commit -m "fix(okf): rewriteRenameLinks reescreve links em index.md ao mover (corrige link quebrado)"
```

---

## Task 5: `moveTargetForType` e `planReorg` (migração legada)

**Files:**
- Modify: `renderer/okf.js`
- Test: `test-tipo-pasta.js`

- [ ] **Step 1: Adicionar teste que falha**

Acrescentar a `test-tipo-pasta.js`:

```js
// --- Task 5: moveTargetForType / planReorg ---
assert.strictEqual(A.moveTargetForType('referencia/velho.md', 'Tabela'), 'tabela/velho.md');
assert.strictEqual(A.moveTargetForType('a/b/x.md', 'Referência'), 'referencia/x.md');

const docsT5 = [
  { relPath: 'misc/atlas.md', name: 'atlas.md', content: '---\ntype: Projeto\ntitle: Atlas\n---\n# Atlas' },
  { relPath: 'projeto/aurora.md', name: 'aurora.md', content: '---\ntype: Projeto\ntitle: Aurora\n---\n# Aurora' },
  { relPath: 'index.md', name: 'index.md', content: '# i' },
];
const plan = A.planReorg(docsT5);
// atlas está em misc/ mas type Projeto -> deve mover; aurora já está em projeto/ -> não move
assert.strictEqual(plan.length, 1);
assert.strictEqual(plan[0].from, 'misc/atlas.md');
assert.strictEqual(plan[0].to, 'projeto/atlas.md');
assert.strictEqual(plan[0].title, 'Atlas');
console.log('Task 5 OK');
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `node test-tipo-pasta.js`
Expected: FAIL — funções inexistentes.

- [ ] **Step 3: Implementar**

Em `renderer/okf.js`, junto aos helpers:

```js
  function moveTargetForType(relPath, type) {
    const base = relPath.split('/').pop();
    return folderForType(type) + '/' + base;
  }
  function planReorg(docs) {
    const taken = new Set(docs.map(d => d.relPath));
    const out = [];
    for (const d of docs) {
      if (isReserved(d.relPath)) continue;
      const f = parse(d.content).frontmatter;
      const type = (f && f.type != null) ? String(f.type).trim() : '';
      if (!type) continue;
      const dir = folderForType(type);
      const curDir = d.relPath.includes('/') ? d.relPath.replace(/\/[^/]*$/, '') : '';
      if (curDir === dir) continue; // já no lugar
      let to = dir + '/' + d.relPath.split('/').pop();
      let k = 2;
      while (taken.has(to)) { to = dir + '/' + d.relPath.split('/').pop().replace(/\.md$/i, '') + '-' + (k++) + '.md'; }
      taken.add(to);
      out.push({ from: d.relPath, to, title: (f && f.title) ? String(f.title) : d.relPath.split('/').pop().replace(/\.md$/i, '') });
    }
    return out;
  }
```

Adicionar `moveTargetForType, planReorg` ao objeto `auto`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `node test-tipo-pasta.js`
Expected: PASS — `Task 5 OK`.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-tipo-pasta.js
git commit -m "feat(okf): moveTargetForType + planReorg (plano de migração por tipo)"
```

---

## Task 6: `<datalist>` de tipos na UI (item 2)

**Files:**
- Modify: `renderer/index.html` (inputs `e-type` ~74, `m-type` ~221; adicionar `<datalist>`)
- Modify: `renderer/renderer.js` (função nova `refreshTypeDatalist`; chamá-la em `refreshFromDisk`)

- [ ] **Step 1: Adicionar o datalist e ligar os inputs**

Em `renderer/index.html`, dentro de `<body>` (logo após a abertura de `<body>`, antes de `<header id="toolbar">`), adicionar:

```html
  <datalist id="type-options"></datalist>
```

Alterar o input `e-type` (linha ~74) para:

```html
              <input id="e-type" type="text" list="type-options" placeholder="Ex.: Projeto, Processo, Métrica" />
```

Alterar o input `m-type` (linha ~221) para:

```html
          <input id="m-type" type="text" list="type-options" placeholder="Projeto" />
```

- [ ] **Step 2: Popular o datalist a partir dos docs**

Em `renderer/renderer.js`, adicionar a função (perto de `buildTypeFilter`, ~linha 349):

```js
function refreshTypeDatalist() {
  const dl = $('type-options');
  if (!dl) return;
  const labels = [...OKF.auto.typeLabelLookup(state.docs).values()].sort((a, b) => a.localeCompare(b));
  dl.innerHTML = labels.map(t => `<option value="${escapeAttr(t)}"></option>`).join('');
}
```

Chamá-la em `refreshFromDisk` (linha ~130, junto de `buildTypeFilter(); renderTree();`):

```js
  indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
```

E também na primeira renderização após abrir biblioteca: na função `refreshFromDisk` já cobre. Verificar que `escapeAttr` existe (é usado em `renderConceptList`).

- [ ] **Step 3: Verificar no app**

Run: `npm start`
Manual: abrir um conceito → Editar → clicar no campo Tipo → deve listar os tipos existentes; digitar um novo continua possível. Fechar o app.

- [ ] **Step 4: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat(ui): combobox de tipos (datalist) na edição e no novo conceito"
```

---

## Task 7: Novo conceito = tipo + título (sem campo de caminho)

**Files:**
- Modify: `renderer/index.html` (modal "Novo conceito" ~205-237: remover `m-category` e `m-path`)
- Modify: `renderer/renderer.js` (`openModal` ~951, `createConcept` ~971)

- [ ] **Step 1: Ajustar o markup do modal**

Em `renderer/index.html`, no modal `#modal`, remover os dois blocos:

```html
        <label>Categoria
          <select id="m-category"></select>
        </label>
        <label class="full">Caminho dentro da biblioteca
          <input id="m-path" type="text" placeholder="ex.: projetos/novo.md" />
        </label>
```

(O campo Tipo passa a definir a pasta. Manter o restante: Modelo, Tipo, Título, Descrição, Tags.)

- [ ] **Step 2: Ajustar `openModal`**

Em `renderer/renderer.js`, substituir o corpo de `openModal` (linhas ~951-969) por:

```js
function openModal() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  ['m-type', 'm-title', 'm-description', 'm-tags'].forEach(id => $(id).value = '');
  const tplSel = $('m-template');
  tplSel.innerHTML = state.templates.map(t => `<option>${escapeHtml(t.name)}</option>`).join('');
  tplSel.value = state.templates.some(t => t.name === 'Em branco') ? 'Em branco'
    : (state.templates[0] ? state.templates[0].name : '');
  applyTemplateToForm(tplSel.value);
  refreshTypeDatalist();
  $('modal').classList.remove('hidden');
  $('m-type').focus();
}
```

- [ ] **Step 3: Ajustar `createConcept`**

Em `renderer/renderer.js`, substituir o início de `createConcept` (linhas ~971-987, até a montagem de `content`) por:

```js
async function createConcept() {
  const typeRaw = $('m-type').value.trim();
  if (!typeRaw) { toast('O campo "type" é obrigatório.', 'bad'); return; }
  const type = OKF.auto.canonicalType(typeRaw, state.docs);
  const title = $('m-title').value.trim();
  if (!title) { toast('Informe o título.', 'bad'); return; }
  const taken = new Set(state.docs.map(d => d.relPath));
  const rel = OKF.auto.pathForConcept(type, title, taken);
  if (docByRel(rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }
  const fm = { type, title };
  if ($('m-description').value.trim()) fm.description = $('m-description').value.trim();
  const tags = $('m-tags').value.split(',').map(s => s.trim()).filter(Boolean);
  if (tags.length) fm.tags = tags;
  fm.timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const tpl = state.templates.find(t => t.name === $('m-template').value);
  const body = tpl ? tpl.body.replace(/^\n+/, '') : '';
  const content = OKF.serialize(fm, '# ' + title + '\n\n' + body);
```

(O restante de `createConcept` — `newDoc`, `ops`, `applyOpsAndRefresh` — permanece igual.)

- [ ] **Step 4: Verificar no app**

Run: `npm start`
Manual: Novo conceito → Tipo "Referência", Título "Teste X" → criar. O arquivo deve nascer em `referencia/teste-x.md`; o índice raiz deve mostrá-lo sob `## Referência`. Excluir o conceito de teste depois. Fechar o app.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat(ui): novo conceito usa tipo+título; caminho derivado de slug(type)/slug(titulo)"
```

---

## Task 8: `performMove` + troca de tipo = mover (item 3)

**Files:**
- Modify: `renderer/renderer.js` (`doRename` ~831-866; `saveEdit` ~765-815; `metaChanged` ~803)

- [ ] **Step 1: Extrair `performMove` e refatorar `doRename`**

Em `renderer/renderer.js`, adicionar a função `performMove` logo acima de `doRename` (~linha 831):

```js
// Move/renomeia fromRel -> toRel: reescreve links, regenera índices e (opcional) loga.
// movedContentOverride: conteúdo já editado do arquivo movido (ex.: troca de tipo).
async function performMove(fromRel, toRel, logEntry, movedContentOverride) {
  const changes = OKF.auto.rewriteRenameLinks(state.docs, fromRel, toRel);
  const movedChange = changes.find(c => c.relPath === fromRel);
  const movedContent = movedContentOverride != null ? movedContentOverride
    : (movedChange ? movedChange.newContent : docByRel(fromRel).content);
  let nextDocs = state.docs.filter(d => d.relPath !== fromRel).map(d => {
    const c = changes.find(x => x.relPath === d.relPath);
    return c ? { ...d, content: c.newContent } : d;
  });
  nextDocs.push({ relPath: toRel, name: baseNameOf(toRel), reserved: OKF.isReserved(toRel), content: movedContent });
  const ops = [{ op: 'create', relPath: toRel, content: movedContent }, { op: 'delete', relPath: fromRel }];
  for (const c of changes) {
    if (c.relPath === fromRel) continue;
    const isIndex = c.relPath.split('/').pop().toLowerCase() === 'index.md';
    if (isIndex && autoIndexEnabled()) continue; // indexOpsFrom regenera estes
    ops.push({ op: 'write', relPath: c.relPath, content: c.newContent });
  }
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    if (logEntry) ops.push(logOpFrom(nextDocs, logEntry));
  }
  return applyOpsAndRefresh(ops, toRel);
}
```

Substituir o corpo de `doRename` (após as validações, da linha `const changes = ...` até o fim) por uma chamada a `performMove`:

```js
async function doRename() {
  const fromRel = renameFrom;
  let toRel = $('rn-path').value.trim().replace(/^\/+/, '');
  if (!fromRel) return;
  if (!toRel) { toast('Informe o novo caminho.', 'bad'); return; }
  if (!toRel.toLowerCase().endsWith('.md')) toRel += '.md';
  if (toRel === fromRel) { closeRename(); return; }
  if (docByRel(toRel)) { toast('Já existe um conceito em ' + toRel, 'bad'); return; }

  const sameDir = (fromRel.includes('/') ? fromRel.replace(/\/[^/]*$/, '') : '') ===
                  (toRel.includes('/') ? toRel.replace(/\/[^/]*$/, '') : '');
  const movedContent = docByRel(fromRel).content;
  const title = OKF.parse(movedContent).frontmatter.title || baseNameOf(toRel).replace(/\.md$/i, '');
  const verbo = sameDir ? 'Renomeação' : 'Movimentação';
  const logEntry = autoIndexEnabled()
    ? '**' + verbo + '**: `' + fromRel + '` → [' + title + '](/' + toRel + ').' : null;
  closeRename();
  const ok = await performMove(fromRel, toRel, logEntry);
  if (ok) toast('Movido para ' + toRel, 'good');
}
```

- [ ] **Step 2: `metaChanged` inclui `type`**

Em `renderer/renderer.js`, dentro de `saveEdit` (~linha 803), alterar:

```js
    const metaChanged = (before.title || '') !== (after.title || '') ||
                        (before.description || '') !== (after.description || '') ||
                        (before.type || '') !== (after.type || '');
```

- [ ] **Step 3: Troca de tipo = move em `saveEdit`**

Em `renderer/renderer.js`, em `saveEdit`, logo após a linha `const after = OKF.parse(content).frontmatter;` (~linha 802) e antes de calcular `metaChanged`/montar ops, inserir o desvio de move:

```js
    const folderChanged = !doc.reserved && autoIndexEnabled() &&
      OKF.auto.folderForType(before.type || '') !== OKF.auto.folderForType(after.type || '');
    if (folderChanged) {
      const toRel = OKF.auto.moveTargetForType(doc.relPath, after.type || '');
      let dest = toRel, k = 2;
      while (docByRel(dest) && dest !== doc.relPath) {
        dest = OKF.auto.folderForType(after.type || '') + '/' +
               baseNameOf(doc.relPath).replace(/\.md$/i, '') + '-' + (k++) + '.md';
      }
      doc.content = content; // o arquivo movido carrega o frontmatter novo
      const title = after.title || baseNameOf(dest).replace(/\.md$/i, '');
      const logEntry = '**Troca de tipo**: `' + doc.relPath + '` → [' + title + '](/' + dest + ') (Tipo: ' + (after.type || '') + ').';
      if (state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      state.editing = false;
      const okMove = await performMove(doc.relPath, dest, logEntry, content);
      if (okMove) toast('Tipo alterado; movido para ' + dest, 'good');
      return;
    }
```

(O fluxo existente de `metaChanged`/`indexOpsFrom` continua para edições sem troca de pasta.)

- [ ] **Step 4: Verificar no app**

Run: `npm start`
Manual:
1. Criar conceito Tipo "Projeto", Título "Alfa" → nasce em `projeto/alfa.md`, índice sob `## Projeto`.
2. Editar Alfa, trocar Tipo para "Referência", salvar → arquivo vira `referencia/alfa.md`; índice raiz move Alfa para `## Referência`; nenhum link vermelho tachado no `index.md`.
3. Conferir `log.md` com a entrada "Troca de tipo".
Excluir o conceito de teste. Fechar o app.

- [ ] **Step 5: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(ui): trocar o tipo move o conceito p/ a pasta do tipo (DRY via performMove)"
```

---

## Task 9: UI "Reorganizar por tipo" (migração legada opcional)

**Files:**
- Modify: `renderer/index.html` (modal de prévia; entrada na paleta já existe via ação)
- Modify: `renderer/renderer.js` (ações de paleta ~888; funções `openReorg`/`applyReorg`)

- [ ] **Step 1: Adicionar o modal de prévia**

Em `renderer/index.html`, após o modal de renomear (`#rename-modal`, ~linha 253), adicionar:

```html
  <!-- Reorganizar por tipo -->
  <div id="reorg-modal" class="modal hidden">
    <div class="modal-card">
      <h2>Reorganizar por tipo</h2>
      <p class="muted" id="reorg-hint"></p>
      <div id="reorg-list" class="reorg-list"></div>
      <div class="modal-actions">
        <button id="reorg-cancel">Cancelar</button>
        <button id="reorg-ok" class="primary">Mover tudo</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Implementar `openReorg`/`closeReorg`/`applyReorg`**

Em `renderer/renderer.js`, adicionar (perto de `doRename`):

```js
function openReorg() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  const plan = OKF.auto.planReorg(state.docs);
  const hint = $('reorg-hint'); const list = $('reorg-list');
  if (!plan.length) {
    hint.textContent = 'Tudo já está organizado por tipo. Nada a mover.';
    list.innerHTML = ''; $('reorg-ok').disabled = true;
  } else {
    hint.textContent = plan.length + ' conceito(s) serão movidos para a pasta do seu tipo:';
    list.innerHTML = plan.map(p =>
      `<div class="reorg-row"><code>${escapeHtml(p.from)}</code> → <code>${escapeHtml(p.to)}</code></div>`).join('');
    $('reorg-ok').disabled = false;
  }
  $('reorg-modal').classList.remove('hidden');
}
function closeReorg() { $('reorg-modal').classList.add('hidden'); }
async function applyReorg() {
  const plan = OKF.auto.planReorg(state.docs);
  closeReorg();
  if (!plan.length) return;
  let okCount = 0;
  for (const p of plan) {
    const title = p.title;
    const logEntry = autoIndexEnabled()
      ? '**Reorganização por tipo**: `' + p.from + '` → [' + title + '](/' + p.to + ').' : null;
    const ok = await performMove(p.from, p.to, logEntry);
    if (ok) okCount++;
  }
  toast('Reorganização concluída: ' + okCount + '/' + plan.length, 'good');
}
```

- [ ] **Step 3: Adicionar a ação na paleta e ligar os botões**

Em `renderer/renderer.js`, em `paletteActions` (~linha 890), acrescentar ao array (após "Reconstruir índices"):

```js
    { label: 'Reorganizar por tipo (mover para a pasta do tipo)', run: openReorg, needsLib: true },
```

Localizar onde os listeners de botões de modal são registrados (busca por `reorg`/`rn-ok` no arquivo de wiring de eventos — normalmente perto do fim de `renderer.js`, junto de `rn-cancel`/`rn-ok`) e adicionar:

```js
  $('reorg-cancel').addEventListener('click', closeReorg);
  $('reorg-ok').addEventListener('click', applyReorg);
```

- [ ] **Step 4: Verificar no app**

Run: `npm start`
Manual: numa biblioteca onde haja conceito fora do padrão (ex.: criar manualmente `misc/x.md` com `type: Projeto`), abrir a paleta (Ctrl+P) → "Reorganizar por tipo" → conferir a prévia → "Mover tudo" → `x.md` vai para `projeto/`. Fechar o app.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat(ui): Reorganizar por tipo (migração legada com prévia, opcional)"
```

---

## Task 10: Editor Milkdown com API por instância (refator)

**Files:**
- Modify: `src/editor/index.js`
- Build: `npm run build:editor`
- Test: smoke existente do editor (`npm run test:ui` / uso no app)

- [ ] **Step 1: Refatorar para `createInstance` + wrappers**

Em `src/editor/index.js`, reescrever de modo que toda a lógica viva em `createInstance`, e as exportações atuais sejam wrappers sobre uma instância padrão. Substituir o módulo por:

```js
// Módulo do editor (Milkdown) empacotado por esbuild como window.OKFEditor.
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core';
import {
  commonmark,
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, createCodeBlockCommand, insertHrCommand,
  insertImageCommand, toggleLinkCommand, turnIntoTextCommand,
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand
} from '@milkdown/preset-commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/preset-gfm';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { clipboard } from '@milkdown/plugin-clipboard';
import { slashFactory, SlashProvider } from '@milkdown/plugin-slash';
import { callCommand, getMarkdown as getMd, replaceAll, insert } from '@milkdown/utils';

const COMMANDS = {
  bold: [toggleStrongCommand], italic: [toggleEmphasisCommand], strike: [toggleStrikethroughCommand],
  codeInline: [toggleInlineCodeCommand], h1: [wrapInHeadingCommand, 1], h2: [wrapInHeadingCommand, 2],
  h3: [wrapInHeadingCommand, 3], bulletList: [wrapInBulletListCommand], orderedList: [wrapInOrderedListCommand],
  blockquote: [wrapInBlockquoteCommand], codeBlock: [createCodeBlockCommand], hr: [insertHrCommand],
  table: [insertTableCommand], undo: [undoCommand], redo: [redoCommand], clear: [turnIntoTextCommand]
};

export async function createInstance(container, markdown, opts = {}) {
  const slash = slashFactory('okf-slash-' + Math.floor(performance.now()));
  let slashProvider = null;
  const SLASH_ITEMS = [
    { label: 'Título 1', run: () => run('h1') }, { label: 'Título 2', run: () => run('h2') },
    { label: 'Lista', run: () => run('bulletList') }, { label: 'Lista numerada', run: () => run('orderedList') },
    { label: 'Tarefas', run: () => taskList() }, { label: 'Citação', run: () => run('blockquote') },
    { label: 'Tabela', run: () => run('table') }, { label: 'Bloco de código', run: () => run('codeBlock') },
    { label: 'Linha horizontal', run: () => run('hr') }
  ];
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown || '');
      ctx.get(listenerCtx).markdownUpdated((_c, md) => { if (opts.onChange) opts.onChange(md); });
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
              const { state, dispatch } = view;
              const { from } = state.selection;
              dispatch(state.tr.delete(from - 1, from));
              it.run();
              if (slashProvider) slashProvider.hide();
              focus();
            });
            content.appendChild(el);
          });
          slashProvider = new SlashProvider({ content });
          return {
            update: (uv, ps) => { slashProvider.update(uv, ps); },
            destroy: () => { slashProvider.destroy(); slashProvider = null; }
          };
        }
      });
    })
    .use(commonmark).use(gfm).use(history).use(listener).use(clipboard).use(slash).create();

  function run(name) { if (COMMANDS[name]) { const [c, p] = COMMANDS[name]; editor.action(callCommand(c.key, p)); } }
  function taskList() { editor.action(insert('- [ ] ')); }
  function focus() { editor.action((ctx) => { ctx.get(editorViewCtx).focus(); }); }
  return {
    getMarkdown: () => editor.action(getMd()),
    setMarkdown: (md) => editor.action(replaceAll(md || '')),
    runCommand: run,
    taskList,
    link: (href) => { if (href) editor.action(callCommand(toggleLinkCommand.key, { href })); },
    image: (src) => { if (src) editor.action(callCommand(insertImageCommand.key, { src })); },
    insertConceptLink: (path, title) => {
      const p = path.startsWith('/') ? path : '/' + path;
      editor.action(insert('[' + (title || path) + '](' + p + ')', true));
    },
    focus,
    cursorEnd: () => editor.action((ctx) => {
      const view = ctx.get(editorViewCtx); const { doc } = view.state;
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(doc)));
      view.focus();
    }),
    destroy: async () => { await editor.destroy(); }
  };
}

// ---- Instância padrão (compatibilidade com window.OKFEditor.* já usado) ----
let def = null;
export async function create(container, markdown, opts = {}) { await destroy(); def = await createInstance(container, markdown, opts); return def; }
export function getMarkdown() { return def ? def.getMarkdown() : ''; }
export function setMarkdown(md) { if (def) def.setMarkdown(md); }
export function runCommand(name) { if (def) def.runCommand(name); }
export function taskList() { if (def) def.taskList(); }
export function link(href) { if (def) def.link(href); }
export function image(src) { if (def) def.image(src); }
export function insertConceptLink(path, title) { if (def) def.insertConceptLink(path, title); }
export function focus() { if (def) def.focus(); }
export function cursorEnd() { if (def) def.cursorEnd(); }
export function setTheme(theme) { void theme; }
export async function destroy() { if (def) { await def.destroy(); def = null; } }
```

- [ ] **Step 2: Rebuild do bundle**

Run: `npm run build:editor`
Expected: gera `renderer/vendor/editor.bundle.js` sem erro.

- [ ] **Step 3: Verificar no app (regressão do editor de conceito)**

Run: `npm start`
Manual: editar um conceito no modo Visual; aplicar negrito, lista, inserir tabela, alternar Visual/Código, salvar. Tudo deve funcionar como antes. Fechar o app.

- [ ] **Step 4: Commit**

```bash
git add src/editor/index.js renderer/vendor/editor.bundle.js
git commit -m "refactor(editor): API por instância (createInstance) + wrappers da instância padrão"
```

---

## Task 11: Modal de import de PDF com editor visual + seletor de tipo (item 4)

**Files:**
- Modify: `renderer/index.html` (`#import-modal` ~331-348)
- Modify: `renderer/convert-ui.js` (`importDocument` ~33, `saveImport` ~67, `closeImport` ~65)

- [ ] **Step 1: Ajustar o markup do modal de import**

Em `renderer/index.html`, substituir o conteúdo do `#import-modal` (linhas ~332-347) por:

```html
    <div class="modal-card import-card">
      <h3 id="import-title">Importar documento</h3>
      <div id="import-status" class="import-status"></div>
      <progress id="import-progress" max="100" value="0" class="hidden"></progress>
      <div class="import-toolbar">
        <button type="button" id="import-mode-visual" class="on">👁 Visual</button>
        <button type="button" id="import-mode-source">&lt;&gt; Código</button>
      </div>
      <div id="import-editor" class="milkdown-host"></div>
      <textarea id="import-md" class="import-md hidden" spellcheck="false"
                placeholder="O Markdown convertido aparecerá aqui para revisão…"></textarea>
      <div class="modal-actions">
        <label class="import-path-row full">Tipo (type) <span class="req">*</span>
          <input id="import-type" type="text" list="type-options" placeholder="Referência" />
        </label>
        <div class="row-buttons">
          <button id="import-save" class="primary" disabled>💾 Salvar conceito</button>
          <button id="import-cancel">Cancelar</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Estado do editor de import + abrir/fechar**

Em `renderer/convert-ui.js`, no topo do IIFE (após `let importDraft = null;`), adicionar:

```js
  let importEditor = null;     // handle da instância do editor do modal
  let importMode = 'visual';

  function importMarkdown() {
    return importMode === 'visual' && importEditor ? importEditor.getMarkdown() : $('import-md').value;
  }
  async function setImportMode(mode) {
    if (mode === importMode) return;
    if (mode === 'source') {
      const md = importEditor ? importEditor.getMarkdown() : $('import-md').value;
      if (importEditor) { await importEditor.destroy(); importEditor = null; }
      $('import-editor').classList.add('hidden');
      $('import-md').value = md; $('import-md').classList.remove('hidden');
    } else {
      const md = $('import-md').value;
      $('import-md').classList.add('hidden');
      $('import-editor').classList.remove('hidden');
      importEditor = await window.OKFEditor.createInstance($('import-editor'), md, {});
    }
    importMode = mode;
    $('import-mode-visual').classList.toggle('on', mode === 'visual');
    $('import-mode-source').classList.toggle('on', mode === 'source');
  }
```

- [ ] **Step 3: Carregar o markdown convertido no editor visual**

Em `importDocument`, onde hoje faz `$('import-md').value = res.markdown || '';` (linha ~53), trocar por preencher o editor visual e o tipo sugerido. Substituir o bloco do `try` que monta `importDraft`/preenche campos por:

```js
      importDraft = { images: res.images || [], meta: res.meta || {} };
      const md = res.markdown || '';
      $('import-md').value = md;
      importMode = 'visual';
      $('import-mode-visual').classList.add('on');
      $('import-mode-source').classList.remove('on');
      $('import-editor').classList.remove('hidden');
      $('import-md').classList.add('hidden');
      if (window.OKFEditor && window.OKFEditor.createInstance) {
        if (importEditor) { await importEditor.destroy(); }
        importEditor = await window.OKFEditor.createInstance($('import-editor'), md, {});
      } else {
        $('import-editor').classList.add('hidden');
        $('import-md').classList.remove('hidden');
        importMode = 'source';
      }
      $('import-type').value = (res.meta && res.meta.type) ? res.meta.type : 'Referência';
      $('import-status').textContent = 'Pronto — revise e salve. ' +
        (res.images && res.images.length ? res.images.length + ' imagem(ns) serão salvas em assets/.' : '');
      prog.classList.add('hidden');
      $('import-save').disabled = false;
```

E no início de `importDocument`, onde reseta os campos (linha ~42 `$('import-md').value = '';`), garantir reset do editor anterior — substituir por:

```js
    $('import-modal').classList.remove('hidden');
    $('import-md').value = '';
    if (importEditor) { await importEditor.destroy(); importEditor = null; }
    $('import-save').disabled = true;
    $('import-status').textContent = 'Convertendo ' + file.name + '…';
```

- [ ] **Step 4: `closeImport` destrói o editor**

Substituir `closeImport` por:

```js
  async function closeImport() {
    $('import-modal').classList.add('hidden');
    importDraft = null;
    if (importEditor) { await importEditor.destroy(); importEditor = null; }
  }
```

- [ ] **Step 5: `saveImport` deriva o caminho do tipo e lê o markdown do editor**

Em `saveImport`, substituir o início (linhas ~68-73, cálculo de `rel`/`body`) por:

```js
  async function saveImport() {
    const typeRaw = $('import-type').value.trim();
    if (!typeRaw) { toast('O campo "type" é obrigatório.', 'bad'); return; }
    const type = OKF.auto.canonicalType(typeRaw, state.docs);
    const title = (importDraft && importDraft.meta && importDraft.meta.title) || 'documento';
    const taken = new Set(state.docs.map(d => d.relPath));
    let rel = OKF.auto.pathForConcept(type, title, taken);
    if (state.docs.some(d => d.relPath === rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }
    let body = importMarkdown();
```

E mais abaixo, na montagem do frontmatter (linha ~94-97), trocar o `type` fixo por `type` do seletor:

```js
    const fm = { type, title, timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
```

(remover a antiga linha `const title = ...` duplicada que existia no trecho — `title` já está definido acima.)

- [ ] **Step 6: Ligar os botões de modo e ajustar a chamada de fechar**

`closeImport` agora é `async`. Onde os listeners do modal de import são registrados em `renderer.js` (busca por `import-cancel`), garantir:

```js
  $('import-cancel').addEventListener('click', () => window.OKFConvertUI.closeImport());
  $('import-mode-visual').addEventListener('click', () => window.OKFConvertUI.setImportMode('visual'));
  $('import-mode-source').addEventListener('click', () => window.OKFConvertUI.setImportMode('source'));
```

E exportar as novas funções no fim de `convert-ui.js`:

```js
  window.OKFConvertUI = { exportCurrentPdf, importDocument, closeImport, saveImport, setImportMode };
```

- [ ] **Step 7: Verificar no app**

Run: `npm start`
Manual: Importar documento → escolher um PDF/HTML/TXT → o Markdown aparece no **editor visual**; alternar Visual/Código; escolher Tipo "Referência"; salvar → conceito criado em `referencia/<slug-do-titulo>.md`, com imagens em `assets/` se houver. Fechar o app.

- [ ] **Step 8: Commit**

```bash
git add renderer/index.html renderer/convert-ui.js renderer/renderer.js
git commit -m "feat(import): preview do PDF no editor visual + seletor de tipo (caminho por tipo)"
```

---

## Task 12: Atualizar `CLAUDE.md` (convenção pasta = tipo; app dono da listagem)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Acrescentar a regra**

Em `CLAUDE.md`, na seção "## Regras do formato", após o bullet sobre links bundle-relativos, adicionar:

```markdown
- **Convenção desta biblioteca (OKF Studio):** a pasta de cada conceito é o
  **slug do seu `type`** (`slug(type)/slug(titulo).md`, estrutura plana). Ao criar
  ou mover conceitos, respeite essa correspondência pasta = tipo.
- **Listagem dos `index.md`:** o OKF Studio é o dono da listagem (o bloco entre
  `<!-- okf:index -->` e `<!-- /okf:index -->`). Não edite a listagem à mão; deixe
  o app regenerá-la. Você pode editar o texto fora do bloco gerenciado.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): convenção pasta=tipo e app como dono da listagem do index.md"
```

---

## Task 13: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: Suíte de testes**

Run: `npm test`
Expected: `node test-okf.js && node test-tipo-pasta.js && node test-convert.js && node test-watcher-error.js` terminam sem erro; saída inclui `Task 1 OK`…`Task 5 OK` e `TESTE OK`.

- [ ] **Step 2: Build completo**

Run: `npm run build:editor && npm run build:convert`
Expected: bundles gerados sem erro.

- [ ] **Step 3: Smoke manual de ponta a ponta**

Run: `npm start`
Checklist:
- [ ] Novo conceito por tipo → cai na pasta certa; índice raiz agrupa por tipo (com acento).
- [ ] Trocar o tipo move o arquivo e atualiza `index.md` sem link vermelho tachado.
- [ ] Combobox de tipos lista os existentes e aceita novo.
- [ ] "Reorganizar por tipo" mostra prévia e move em lote.
- [ ] Import de PDF abre o editor visual, alterna Visual/Código e salva na pasta do tipo.
- [ ] Editor de conceito (Visual) continua funcionando (negrito, tabela, salvar).

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore: verificação final tipo-como-pasta"
```
