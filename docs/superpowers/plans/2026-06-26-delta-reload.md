# Delta-reload (Leva 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar a re-leitura O(n) de toda a biblioteca a cada mutação do app e a cada evento do watcher, aplicando apenas o delta.

**Architecture:** Funções puras `opsToDelta(ops)` e `applyDelta(docs, delta)` em `okf.js`. (A) `applyOpsAndRefresh` patcha `state.docs` a partir das ops no sucesso (sem `readBundle`). (B) o watcher acumula os paths mudados, o main relê só esses `.md` e envia um delta em `bundle:changed`, e `reloadFromDisk(delta)` patcha. Fallback full reload em falha; `loadBundle`/"Recarregar" continuam full.

**Tech Stack:** Electron (main/preload/renderer), JS puro, testes Node `node:assert` + harness Electron.

**Spec:** `docs/superpowers/specs/2026-06-26-delta-reload-design.md`

**Branch:** `perf/delta-reload` (criada a partir de `fix/review-batch-1`).

---

## File Structure

| Arquivo | Mudança |
|---------|---------|
| `renderer/okf.js` *(mod)* | `opsToDelta`, `applyDelta` (puros) + export. |
| `test-delta.js` *(novo)* | Testes de `opsToDelta`/`applyDelta`. |
| `package.json` *(mod)* | `test-delta.js` no script `test`. |
| `renderer/renderer.js` *(mod)* | `rerenderFromState`; `applyOpsAndRefresh` (delta no sucesso); `refreshFromDisk` usa o helper; `reloadFromDisk(delta)`. |
| `watcher.js` *(mod)* | acumula paths, `onChange(paths)`. |
| `main.js` *(mod)* | `computeWatchDelta`; callback do watcher envia o delta. |
| `preload.js` *(mod)* | `onBundleChanged` repassa o payload. |
| `test-renderer.js` *(mod)* | smoke: `reloadFromDisk(delta)` patcha a árvore sem `readBundle`. |

---

## Task 1: `opsToDelta` + `applyDelta` (puros) + teste

**Files:** Modify `renderer/okf.js`, Create `test-delta.js`, Modify `package.json`

- [ ] **Step 1: Criar o teste que falha.** Create `test-delta.js`:

```js
'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;

// opsToDelta: create/write .md -> upsert (doc completo); delete -> deletes; ignora binária/não-.md
{
  const ops = [
    { op: 'write', relPath: 'projeto/a.md', content: 'A' },
    { op: 'create', relPath: 'index.md', content: 'I' },
    { op: 'delete', relPath: 'projeto/b.md' },
    { op: 'create', relPath: 'assets/x.png', content: 'bytes', binary: true },
    { op: 'write', relPath: 'assets/y.txt', content: 'txt' },
  ];
  const d = OKF.opsToDelta(ops);
  assert.deepStrictEqual(d.deletes, ['projeto/b.md']);
  assert.strictEqual(d.upserts.length, 2);
  const a = d.upserts.find(u => u.relPath === 'projeto/a.md');
  assert.strictEqual(a.content, 'A');
  assert.strictEqual(a.name, 'a.md');
  assert.strictEqual(a.reserved, false);
  const idx = d.upserts.find(u => u.relPath === 'index.md');
  assert.strictEqual(idx.reserved, true); // index.md é reservado
}

// applyDelta: upsert substitui, novo é acrescentado, delete remove, não muta entrada
{
  const docs = [
    { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: 'old' },
    { relPath: 'projeto/b.md', name: 'b.md', reserved: false, content: 'B' },
  ];
  const delta = {
    upserts: [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: 'new' },
      { relPath: 'processo/c.md', name: 'c.md', reserved: false, content: 'C' },
    ],
    deletes: ['projeto/b.md'],
  };
  const out = OKF.applyDelta(docs, delta);
  assert.strictEqual(out.find(d => d.relPath === 'projeto/a.md').content, 'new'); // substituído
  assert.ok(out.find(d => d.relPath === 'processo/c.md')); // novo
  assert.ok(!out.find(d => d.relPath === 'projeto/b.md')); // removido
  assert.strictEqual(out.length, 2);
  assert.strictEqual(docs.length, 2); // entrada não mutada
  assert.strictEqual(docs[0].content, 'old'); // doc de entrada não mutado
}

console.log('test-delta OK');
```

- [ ] **Step 2: Rodar e confirmar a falha.** Run: `node test-delta.js` → FAIL (`OKF.opsToDelta is not a function`).

- [ ] **Step 3: Implementar em `renderer/okf.js`.** Logo APÓS a função `parseDoc` (ou perto das outras funções de topo, antes de `global.OKF = {...}`), adicione:

```js
  // Deriva um delta {upserts, deletes} de uma lista de ops do fs:applyOps.
  // create/write não-binária e .md → upsert (doc completo); delete .md → deletes.
  function opsToDelta(ops) {
    const upserts = [], deletes = [];
    for (const op of (ops || [])) {
      if (!op || op.binary) continue;
      if (!/\.md$/i.test(op.relPath || '')) continue;
      if (op.op === 'create' || op.op === 'write') {
        upserts.push({
          relPath: op.relPath,
          name: op.relPath.split('/').pop(),
          reserved: isReserved(op.relPath),
          content: op.content
        });
      } else if (op.op === 'delete') {
        deletes.push(op.relPath);
      }
    }
    return { upserts, deletes };
  }

  // Aplica um delta a um array de docs SEM mutar a entrada. Upserts substituem o
  // doc de mesmo relPath ou são acrescentados; deletes removem. Ordem não importa.
  function applyDelta(docs, delta) {
    const ups = (delta && delta.upserts) || [];
    const del = new Set((delta && delta.deletes) || []);
    const byPath = new Map(ups.map(d => [d.relPath, d]));
    const out = [];
    for (const d of (docs || [])) {
      if (del.has(d.relPath)) continue;
      if (byPath.has(d.relPath)) { out.push(byPath.get(d.relPath)); byPath.delete(d.relPath); }
      else out.push(d);
    }
    for (const d of byPath.values()) out.push(d);
    return out;
  }
```

- [ ] **Step 4: Exportar.** Em `global.OKF = { ... }`, acrescente `opsToDelta, applyDelta`.

- [ ] **Step 5: Rodar e confirmar.** Run: `node test-delta.js` → `test-delta OK`.

- [ ] **Step 6: Ligar ao `npm test`.** Em `package.json`, no script `test`, acrescente ` && node test-delta.js` ao final. Run: `npm test` → todos passam.

- [ ] **Step 7: Commit.**

```bash
git add renderer/okf.js test-delta.js package.json
git commit -m "perf(delta): opsToDelta e applyDelta puros para patch incremental"
```

---

## Task 2: (A) Mutações do app patcham sem reler o disco

**Files:** Modify `renderer/renderer.js`

- [ ] **Step 1: Extrair `rerenderFromState`.** Em `renderer/renderer.js`, imediatamente ANTES de `async function applyOpsAndRefresh(`, insira:

```js
// Re-renderiza tudo a partir do state.docs atual (sem I/O) e seleciona selectRel.
function rerenderFromState(selectRel) {
  indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  const want = selectRel || state.current;
  if (want && state.docs.some(d => d.relPath === want)) openDoc(want);
  else if (state.docs.length) { const f = state.docs.find(d => !d.reserved) || state.docs[0]; openDoc(f.relPath); }
  else showEmpty();
}
```

- [ ] **Step 2: `applyOpsAndRefresh` usa o delta no sucesso.** Substitua a função inteira:

```js
async function applyOpsAndRefresh(ops, selectRel) {
  const r = await window.okf.applyOps({ root: state.root, ops });
  if (!r || !r.ok) {
    toast('Erro ao gravar: ' + ((r && r.error) || 'desconhecido'), 'bad');
    await refreshFromDisk(null);
    return false;
  }
  await refreshFromDisk(selectRel);
  if (!$('git-view').classList.contains('hidden')) refreshGit();
  return true;
}
```

por:

```js
async function applyOpsAndRefresh(ops, selectRel) {
  const r = await window.okf.applyOps({ root: state.root, ops });
  if (!r || !r.ok) {
    toast('Erro ao gravar: ' + ((r && r.error) || 'desconhecido'), 'bad');
    await refreshFromDisk(null);
    return false;
  }
  state.docs = OKF.applyDelta(state.docs, OKF.opsToDelta(ops)); // patch sem reler o disco
  rerenderFromState(selectRel);
  if (!$('git-view').classList.contains('hidden')) refreshGit();
  return true;
}
```

- [ ] **Step 3: `refreshFromDisk` usa o helper.** Substitua a função inteira:

```js
async function refreshFromDisk(selectRel) {
  const res = await window.okf.readBundle(state.root);
  state.docs = res.docs || [];
  indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  const want = selectRel || state.current;
  if (want && state.docs.some(d => d.relPath === want)) openDoc(want);
  else if (state.docs.length) { const f = state.docs.find(d => !d.reserved) || state.docs[0]; openDoc(f.relPath); }
  else showEmpty();
}
```

por:

```js
async function refreshFromDisk(selectRel) {
  const res = await window.okf.readBundle(state.root);
  state.docs = res.docs || [];
  rerenderFromState(selectRel);
}
```

- [ ] **Step 4: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test`. Run: `npm run test:ui` → `RESULT: PASS` (a árvore continua sendo construída do `state.docs`; os smokes existentes não usam `applyOpsAndRefresh`).

- [ ] **Step 5: Commit.**

```bash
git add renderer/renderer.js
git commit -m "perf(delta): applyOpsAndRefresh patcha via delta (sem readBundle no sucesso)"
```

---

## Task 3: (B) Watcher carrega os paths e o main computa o delta

**Files:** Modify `watcher.js`, Modify `main.js`, Modify `preload.js`

- [ ] **Step 1: Watcher acumula paths.** Em `watcher.js`, substitua o corpo de `createWatcher`:

```js
function createWatcher(onChange) {
  let w = null;
  let timer = null;
  let paused = false;
  const fire = () => { if (paused) return; clearTimeout(timer); timer = setTimeout(onChange, 300); };
```

por (acumulando os paths e entregando-os):

```js
function createWatcher(onChange) {
  let w = null;
  let timer = null;
  let paused = false;
  let pending = new Set();
  const fire = (p) => {
    if (paused) return;
    if (p) pending.add(p);
    clearTimeout(timer);
    timer = setTimeout(() => { const paths = [...pending]; pending.clear(); onChange(paths); }, 300);
  };
```

E em `pause()`, limpe o acumulado. Substitua:

```js
    pause() { paused = true; clearTimeout(timer); },
```

por:

```js
    pause() { paused = true; clearTimeout(timer); pending.clear(); },
```

(Os listeners `w.on('add', fire).on('change', fire).on('unlink', fire)` já recebem o path do chokidar como 1º argumento — `fire(path)` passa a usá-lo. Não mude essa linha.)

- [ ] **Step 2: `computeWatchDelta` no main.** Em `main.js`, logo após a função `walk` (perto da linha 155), adicione:

```js
// Lê só os .md que mudaram (paths absolutos do watcher) e devolve um delta.
async function computeWatchDelta(root, absPaths) {
  const upserts = [], deletes = [];
  for (const abs of (absPaths || [])) {
    if (!String(abs).toLowerCase().endsWith('.md')) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // fora da raiz
    const name = path.basename(abs);
    try {
      const content = await fsp.readFile(abs, 'utf8');
      upserts.push({ relPath: rel, name, reserved: RESERVED.has(name.toLowerCase()), content });
    } catch (e) {
      deletes.push(rel); // removido/ilegível
    }
  }
  return { upserts, deletes };
}
```

- [ ] **Step 3: Callback do watcher envia o delta.** Em `main.js`, substitua:

```js
const libWatcher = createWatcher(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bundle:changed');
});
```

por:

```js
const libWatcher = createWatcher(async (paths) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const delta = await computeWatchDelta(currentRoot, paths);
    mainWindow.webContents.send('bundle:changed', delta);
  } catch (e) {
    mainWindow.webContents.send('bundle:changed'); // sem payload = full reload
  }
});
```

- [ ] **Step 4: Preload repassa o payload.** Em `preload.js`, substitua:

```js
  onBundleChanged: (cb) => ipcRenderer.on('bundle:changed', () => cb()),
```

por:

```js
  onBundleChanged: (cb) => ipcRenderer.on('bundle:changed', (_e, delta) => cb(delta)),
```

- [ ] **Step 5: Verificar.** Run: `node --check watcher.js && node --check main.js && node --check preload.js` → sem erro. Run: `npm test` → passa.

- [ ] **Step 6: Commit.**

```bash
git add watcher.js main.js preload.js
git commit -m "perf(delta): watcher carrega paths e main computa delta de mudanças externas"
```

---

## Task 4: (B) `reloadFromDisk(delta)` patcha preservando o banner de edição

**Files:** Modify `renderer/renderer.js`

- [ ] **Step 1: `reloadFromDisk` aceita um delta.** Substitua a função inteira:

```js
async function reloadFromDisk() {
  if (!state.root) return;
  let res;
  try { res = await window.okf.readBundle(state.root); } catch (e) { return; }
  const newDocs = res.docs || [];

  // Edição em andamento: nunca sobrescrever o editor.
  if (state.editing && state.current) {
    const old = state.docs.find(d => d.relPath === state.current);
    const cur = newDocs.find(d => d.relPath === state.current);
    state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
    $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
    if (cur && old && cur.content !== old.content) $('disk-banner').classList.remove('hidden');
    return;
  }

  // Sem edição: atualização completa preservando a seleção.
  state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
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

por:

```js
async function reloadFromDisk(delta) {
  if (!state.root) return;
  let newDocs;
  if (delta && (delta.upserts || delta.deletes)) {
    newDocs = OKF.applyDelta(state.docs, delta); // mudança externa: só o delta
  } else {
    let res;
    try { res = await window.okf.readBundle(state.root); } catch (e) { return; } // full (fallback)
    newDocs = res.docs || [];
  }

  // Edição em andamento: nunca sobrescrever o editor.
  if (state.editing && state.current) {
    const old = state.docs.find(d => d.relPath === state.current);
    const cur = newDocs.find(d => d.relPath === state.current);
    state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
    $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
    if (cur && old && cur.content !== old.content) $('disk-banner').classList.remove('hidden');
    return;
  }

  // Sem edição: atualização preservando a seleção.
  state.docs = newDocs; indexDocs(); buildTypeFilter(); renderTree(); refreshTypeDatalist();
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

- [ ] **Step 2: Repassar o delta no `onBundleChanged`.** Em `init()`, substitua:

```js
  window.okf.onBundleChanged(() => { reloadFromDisk(); if (!$('git-view').classList.contains('hidden')) refreshGit(); });
```

por:

```js
  window.okf.onBundleChanged((delta) => { reloadFromDisk(delta); if (!$('git-view').classList.contains('hidden')) refreshGit(); });
```

- [ ] **Step 3: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test`. Run: `npm run test:ui` → `RESULT: PASS`.

- [ ] **Step 4: Commit.**

```bash
git add renderer/renderer.js
git commit -m "perf(delta): reloadFromDisk aplica delta do watcher (full reload como fallback)"
```

---

## Task 5: Smoke de DOM + verificação

**Files:** Modify `test-renderer.js`

- [ ] **Step 1: Smoke do `reloadFromDisk(delta)`.** Em `test-renderer.js`, logo após o bloco de estabilidade (a linha `console.log('  cancelEdit sem doc:', JSON.stringify(cancel));`), insira:

```js
  // Delta-reload: reloadFromDisk(delta) patcha a árvore sem readBundle.
  const delta = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake5';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' },
      { relPath: 'projeto/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: B\\n---\\n# B\\n' }
    ];
    indexDocs(); state.collapsed = new Set(); state.favorites = new Set(); state.editing = false; state.current = null;
    document.getElementById('type-filter').value = ''; document.getElementById('search').value = '';
    setGroupMode('type');
    await reloadFromDisk({ upserts: [{ relPath: 'processo/c.md', name: 'c.md', reserved: false, content: '---\\ntype: Processo\\ntitle: C\\n---\\n# C\\n' }], deletes: ['projeto/b.md'] });
    const paths = state.docs.map(d => d.relPath).sort();
    return { paths, count: state.docs.length };
  })()`);
  const okDelta = delta && delta.count === 2 && delta.paths.indexOf('processo/c.md') !== -1 && delta.paths.indexOf('projeto/b.md') === -1 && delta.paths.indexOf('projeto/a.md') !== -1;
  console.log('  delta-reload:', JSON.stringify(delta));
```

Acrescente `&& okDelta` à condição do `console.log(... RESULT ...)` e do `app.exit(...)`, e antes do RESULT adicione `console.log('  delta-reload OK:', okDelta);`.

- [ ] **Step 2: Rodar.** Run: `npm run test:ui` → `RESULT: PASS` e `delta-reload OK: true`.

- [ ] **Step 3: Commit.**

```bash
git add test-renderer.js
git commit -m "test(delta): smoke de reloadFromDisk(delta) patchando a árvore"
```

- [ ] **Step 4: Verificação manual (`npm start`):**
1. Abrir uma biblioteca; criar/editar/excluir/renomear/mover conceitos → tudo reflete na árvore **sem** travamento (sem re-leitura total). Índices/log atualizados como antes.
2. Trocar o tipo de um conceito (move o arquivo) → aparece no novo grupo corretamente.
3. Editar um conceito por fora (ex.: salvar via Claude Code/editor externo) → a árvore atualiza só aquele item; se o conceito **aberto em edição** mudou, aparece o banner (não sobrescreve).
4. Criar/excluir um arquivo `.md` por fora → aparece/some na árvore.
5. "Recarregar" (menu) e abrir outra biblioteca continuam funcionando (full reload).

- [ ] **Step 5: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(delta): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura do spec)

- **(A) patch via ops, sem readBundle** → Task 1 (`opsToDelta`/`applyDelta`) + Task 2 (`applyOpsAndRefresh`).
- **Fallback full em falha do applyOps** → Task 2 (ramo `!r.ok` → `refreshFromDisk`).
- **(B) watcher carrega paths; main relê só esses; envia delta** → Task 3.
- **reloadFromDisk patcha + banner de edição preservado + fallback full** → Task 4.
- **Funções puras testadas; smoke do consumo** → Task 1 + Task 5.
- **loadBundle/Recarregar full** → inalterados (não tocados).
- **Fora de escopo:** grafo/árvore incrementais (continuam rebuild O(n) em CPU, sem I/O).
