# Revisão — Leva 2 (resto seguro: integridade + limpezas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a concorrência/integridade restante da revisão (escrita serializada do recents; ordem segura de ops no applyOps) e aplicar limpezas de baixo risco (parseTags, constantes de localStorage, baseNameOf).

**Architecture:** Mutex (fila de promessas) nos handlers de `recents.js`. Helper puro `orderOps` (creates/writes antes de deletes) em um módulo novo `ops.js`, usado pelo `fs:applyOps`. Helper puro `OKF.auto.parseTags`. Constantes para as chaves de `localStorage`. Reuso de `baseNameOf`.

**Tech Stack:** Electron (main/renderer), JS puro, testes Node `node:assert`.

**Branch:** `chore/review-batch-2` (criar a partir de `perf/delta-reload`).

**Origem dos requisitos:** revisão de código (estabilidade H4, integridade C1; consistência). **Fora deste lote (decidido):** split do `renderer.js`; dedup do `INVALID` (cross-process, sem módulo compartilhado); remoção do `setTheme` no-op (exigiria rebuildar o bundle do editor); rename `templates.remove→delete` (cosmético cross-file).

---

## File Structure

| Arquivo | Mudança |
|---------|---------|
| `recents.js` *(mod)* | Serializar os 4 handlers numa fila. |
| `ops.js` *(novo)* | `orderOps(ops)` puro. |
| `test-ops.js` *(novo)* | Teste de `orderOps`. |
| `main.js` *(mod)* | `fs:applyOps` itera `orderOps(ops)`. |
| `renderer/okf.js` *(mod)* | `OKF.auto.parseTags` puro. |
| `test-grouping.js` *(mod)* | Teste de `parseTags`. |
| `renderer/renderer.js` *(mod)* | Usa `parseTags` (3 sites); constantes de localStorage; `baseNameOf` nos splits de relPath. |
| `package.json` *(mod)* | `test-ops.js` no script `test`. |

---

## Task 1: Serializar as escritas do `recents.js`

Evita perda de update quando `recents:add`/`remove`/`toggleFavorite` chegam concorrentes.

**Files:** Modify `recents.js`

- [ ] **Step 1: Adicionar a fila e envolver os handlers.** Em `recents.js`, substitua a função `registerRecentsHandlers` inteira por:

```js
function registerRecentsHandlers(ipcMain) {
  // Serializa as operações para evitar leitura/gravação concorrente do JSON.
  let queue = Promise.resolve();
  const serialize = (fn) => { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r; };

  ipcMain.handle('recents:list', () => serialize(async () => {
    const list = sortAndCap(await readStore(recentsFile()));
    return enrichExists(list);
  }));
  ipcMain.handle('recents:add', (_e, { path: p, name }) => serialize(async () => {
    if (!p || typeof p !== 'string') return enrichExists(sortAndCap(await readStore(recentsFile())));
    const file = recentsFile();
    const list = addEntry(await readStore(file), { path: p, name }, Date.now());
    await writeStore(file, list);
    return enrichExists(list);
  }));
  ipcMain.handle('recents:remove', (_e, { path: p }) => serialize(async () => {
    if (!p || typeof p !== 'string') return enrichExists(sortAndCap(await readStore(recentsFile())));
    const file = recentsFile();
    const list = sortAndCap(removeEntry(await readStore(file), p));
    await writeStore(file, list);
    return enrichExists(list);
  }));
  ipcMain.handle('recents:toggleFavorite', (_e, { path: p }) => serialize(async () => {
    if (!p || typeof p !== 'string') return enrichExists(sortAndCap(await readStore(recentsFile())));
    const file = recentsFile();
    const list = toggleFavorite(await readStore(file), p);
    await writeStore(file, list);
    return enrichExists(list);
  }));
}
```

(A lógica de cada handler é idêntica à atual; só foi envolvida em `serialize(async () => { ... })`. `queue.then(fn, fn)` roda `fn` independente de a anterior ter falhado; `queue = r.catch(()=>{})` mantém a corrente viva.)

- [ ] **Step 2: Verificar.** Run: `node --check recents.js`. Run: `npm test` → `test-recents` e os demais passam (as funções puras não mudaram).

- [ ] **Step 3: Commit.**

```bash
git add recents.js
git commit -m "fix(recents): serializa escritas dos handlers (evita perda de update)"
```

---

## Task 2: `orderOps` puro + `fs:applyOps` aplica creates/writes antes de deletes

**Files:** Create `ops.js`, Create `test-ops.js`, Modify `main.js`, Modify `package.json`

- [ ] **Step 1: Criar o teste que falha.** Create `test-ops.js`:

```js
'use strict';
const assert = require('node:assert');
const { orderOps } = require('./ops.js');

{
  const ops = [
    { op: 'delete', relPath: 'a.md' },
    { op: 'create', relPath: 'b.md' },
    { op: 'write', relPath: 'c.md' },
    { op: 'delete', relPath: 'd.md' },
  ];
  const out = orderOps(ops);
  assert.deepStrictEqual(out.map(o => o.op), ['create', 'write', 'delete', 'delete']);
  assert.deepStrictEqual(out.map(o => o.relPath), ['b.md', 'c.md', 'a.md', 'd.md']); // estável
  assert.deepStrictEqual(orderOps(null), []);
  assert.strictEqual(orderOps(ops).length, ops.length); // não perde ops
}
console.log('test-ops OK');
```

- [ ] **Step 2: Rodar e confirmar a falha.** Run: `node test-ops.js` → FAIL (`Cannot find module './ops.js'`).

- [ ] **Step 3: Criar `ops.js`:**

```js
'use strict';
// Ordena ops do fs:applyOps: creates/writes antes de deletes (estável dentro de
// cada grupo). Garante que uma falha parcial nunca apague conteúdo antes de a
// substituição existir no disco.
function orderOps(ops) {
  const arr = Array.isArray(ops) ? ops : [];
  const writes = arr.filter(o => o && o.op !== 'delete');
  const deletes = arr.filter(o => o && o.op === 'delete');
  return writes.concat(deletes);
}

module.exports = { orderOps };
```

- [ ] **Step 4: Usar no `main.js`.** No topo de `main.js`, junto aos outros `require`, adicione:

```js
const { orderOps } = require('./ops.js');
```

No handler `fs:applyOps`, substitua a linha:

```js
    for (const op of (ops || [])) {
```

por:

```js
    for (const op of orderOps(ops)) {
```

- [ ] **Step 5: Rodar e confirmar.** Run: `node test-ops.js` → `test-ops OK`. Run: `node --check main.js`.

- [ ] **Step 6: Ligar ao `npm test`.** Em `package.json`, no script `test`, acrescente ` && node test-ops.js` ao final. Run: `npm test` → todos passam.

- [ ] **Step 7: Commit.**

```bash
git add ops.js test-ops.js main.js package.json
git commit -m "fix(applyOps): aplica creates/writes antes de deletes (orderOps puro)"
```

---

## Task 3: `OKF.auto.parseTags` puro + uso no renderer

**Files:** Modify `renderer/okf.js`, Modify `test-grouping.js`, Modify `renderer/renderer.js`

- [ ] **Step 1: Teste que falha.** Em `test-grouping.js`, ANTES da linha final `console.log('test-grouping OK');`, insira:

```js
// parseTags: split por vírgula, trim, remove vazios
{
  assert.deepStrictEqual(OKF.auto.parseTags('a, b ,,c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(OKF.auto.parseTags(''), []);
  assert.deepStrictEqual(OKF.auto.parseTags(null), []);
  assert.deepStrictEqual(OKF.auto.parseTags('  '), []);
}
```

- [ ] **Step 2: Rodar e confirmar a falha.** Run: `node test-grouping.js` → FAIL (`OKF.auto.parseTags is not a function`).

- [ ] **Step 3: Implementar em `renderer/okf.js`.** Junto às outras funções de `auto` (antes da linha `const auto = { ... }`), adicione:

```js
  // Divide uma string "a, b, c" em ['a','b','c'] (trim; remove vazios).
  function parseTags(s) {
    return String(s == null ? '' : s).split(',').map(x => x.trim()).filter(Boolean);
  }
```

E acrescente `parseTags` ao objeto `const auto = { ... }`.

- [ ] **Step 4: Usar no renderer.** Em `renderer/renderer.js`, substitua os 3 splits de tags:

Em `saveEdit` (a linha com `$('e-tags')`):
```js
    const tags = $('e-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
```
por:
```js
    const tags = OKF.auto.parseTags($('e-tags').value);
```

Em `createConcept` (a linha com `$('m-tags')`):
```js
  const tags = $('m-tags').value.split(',').map(s => s.trim()).filter(Boolean);
```
por:
```js
  const tags = OKF.auto.parseTags($('m-tags').value);
```

Em `saveTpl` (a linha com `$('tpl-tags')`):
```js
  const tags = $('tpl-tags').value.split(',').map(s => s.trim()).filter(Boolean); if (tags.length) fm.tags = tags;
```
por:
```js
  const tags = OKF.auto.parseTags($('tpl-tags').value); if (tags.length) fm.tags = tags;
```

- [ ] **Step 5: Rodar e confirmar.** Run: `node test-grouping.js` → `test-grouping OK`. Run: `node --check renderer/renderer.js`. Run: `npm test` → todos passam.

- [ ] **Step 6: Commit.**

```bash
git add renderer/okf.js test-grouping.js renderer/renderer.js
git commit -m "refactor(tags): OKF.auto.parseTags reaproveitado nos 3 formulários"
```

---

## Task 4: Constantes de localStorage + `baseNameOf` nos splits de relPath

**Files:** Modify `renderer/renderer.js`

- [ ] **Step 1: Definir as constantes.** Em `renderer/renderer.js`, logo após `const state = { ... };` (perto do topo), adicione:

```js
/* Chaves de localStorage (centralizadas). */
const LS = {
  THEME: 'okf-theme',
  AUTO_INDEX: 'okf-auto-index',
  GROUP_MODE: 'okf-group-mode',
  COLLAPSED: 'okf-collapsed:',   // prefixo + state.root
  FAVORITES: 'okf-favorites:',   // prefixo + state.root
};
```

- [ ] **Step 2: Substituir os literais.** Troque cada literal pela constante:
  - `localStorage.getItem('okf-auto-index')` → `localStorage.getItem(LS.AUTO_INDEX)` e o `setItem` correspondente.
  - `localStorage.setItem('okf-theme', theme)` e `localStorage.getItem('okf-theme')` → `LS.THEME`.
  - `localStorage.getItem('okf-group-mode')` e `localStorage.setItem('okf-group-mode', mode)` → `LS.GROUP_MODE`.
  - Em `collapseKey()`: `return 'okf-collapsed:' + (state.root || '');` → `return LS.COLLAPSED + (state.root || '');`.
  - Em `favoritesKey()`: `return 'okf-favorites:' + (state.root || '');` → `return LS.FAVORITES + (state.root || '');`.

(Procure por cada string `'okf-...'` no arquivo e troque pela constante correspondente. Não deve sobrar nenhum literal `'okf-theme'`/`'okf-auto-index'`/`'okf-group-mode'`/`'okf-collapsed:'`/`'okf-favorites:'`.)

- [ ] **Step 3: `baseNameOf` nos splits de relPath.** `baseNameOf(rel)` já existe (`rel.split('/').pop()`). Troque os splits inline de **relPath** (que usam `'/'`, NÃO os de caminho de SO que usam `/[\\/]/`):
  - Em `indexDirs` (a linha `const parts = d.relPath.split('/'); parts.pop();`) — **deixe como está** (precisa das partes, não do basename).
  - Na verificação de index.md em `indexOpsFrom` — a linha `if (d.relPath.split('/').pop().toLowerCase() !== 'index.md')` → `if (baseNameOf(d.relPath).toLowerCase() !== 'index.md')`.
  - **NÃO** altere os `dir.split(/[\\/]/).pop()` (caminhos de SO).

  (Aplique apenas onde for exatamente `x.relPath.split('/').pop()` → `baseNameOf(x.relPath)`, comportamento idêntico. Se algum site for ambíguo, deixe como está.)

- [ ] **Step 4: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test`. Run: `npm run test:ui` → `RESULT: PASS` (tema/colapso/favoritos/grupo continuam persistindo).

- [ ] **Step 5: Commit.**

```bash
git add renderer/renderer.js
git commit -m "refactor: constantes de localStorage e baseNameOf nos splits de relPath"
```

---

## Task 5: Verificação + PR

**Files:** nenhum (verificação).

- [ ] **Step 1:** Run `npm test` (inclui `test-ops OK`, `parseTags`, e os demais) e `npm run test:ui` (`RESULT: PASS`).

- [ ] **Step 2: No app (`npm start`):**
1. Abrir/favoritar/remover bibliotecas rapidamente em sequência → a lista de recentes fica consistente (sem perder favorito/entrada).
2. Criar/editar com tags separadas por vírgula → tags salvas corretamente (sem espaços/vazios).
3. Mover/renomear/excluir conceitos → funciona como antes (ordem de ops não mudou o resultado visível).
4. Tema/colapso de grupos/favoritos/modo de agrupamento continuam persistindo ao reabrir.

- [ ] **Step 3: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(revisão): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura)

- **Concorrência (recents H4)** → Task 1 (fila/mutex).
- **Integridade (applyOps C1)** → Task 2 (`orderOps`: creates/writes antes de deletes; nunca perde conteúdo).
- **Dedup de tags** → Task 3 (`parseTags`).
- **Constantes de localStorage + baseNameOf** → Task 4.
- **Decididamente fora:** split do `renderer.js`; dedup do `INVALID` (cross-process); `setTheme` no-op (rebuild do bundle); `templates.remove→delete` (cosmético).
