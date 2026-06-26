# Revisão — Leva 1 (segurança + performance + estabilidade) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar as correções de alto impacto e baixo risco da revisão de código: sanitizar o markdown (XSS) + endurecer CSP, eliminar reparse redundante e debouncar a busca, e adicionar guards de estabilidade.

**Architecture:** Sanitização via DOMPurify (UMD local, referenciado como `marked`). Parse-once: um `parseDoc(d)` memoizado em `okf.js` (mesmos campos `_p`/`_pSrc` que o `parsedOf` do renderer já usa), aplicado em `buildGraph`/`typeLabelLookup`/`groupConcepts` — colapsa ~4N parses por ciclo em ~N. Busca com debounce + corpo em minúsculas cacheado. Guards defensivos em fluxos que podem receber estado ausente.

**Tech Stack:** Electron renderer (JS puro), DOMPurify (UMD), testes Node `node:assert` + harness Electron `test-renderer.js`.

**Branch:** `fix/review-batch-1` (criar a partir da `main`).

**Origem dos requisitos:** revisão de código (segurança/estabilidade/performance) de 2026-06-26. NÃO inclui o refator de delta-reload (peça separada).

---

## File Structure

| Arquivo | Mudança |
|---------|---------|
| `package.json` *(mod)* | `dompurify` em `dependencies`. |
| `renderer/index.html` *(mod)* | `<script>` do DOMPurify; CSP endurecido. |
| `renderer/renderer.js` *(mod)* | sanitizar sink :712; debounce da busca; `bodyLcOf` cache; guards (cancelEdit, performMove, openFolder/reload/openSample). |
| `renderer/okf.js` *(mod)* | `parseDoc(d)` memoizado; usar em `buildGraph`/`typeLabelLookup`/`groupConcepts`. |
| `test-grouping.js` *(mod)* | teste de `parseDoc` (memoização + equivalência). |
| `test-renderer.js` *(mod)* | smokes: DOMPurify presente+sanitiza; `cancelEdit` sem doc não quebra. |

---

## Task 1: parse-once — `OKF.parseDoc` e uso nas funções de okf.js

Feito primeiro porque é pura e testável, e reduz o reparse já existente.

**Files:** Modify `renderer/okf.js`, Modify `test-grouping.js`

- [ ] **Step 1: Teste que falha.** Em `test-grouping.js`, ANTES da linha final `console.log('test-grouping OK');`, insira:

```js
// parseDoc: equivale a parse e memoiza no doc (_p/_pSrc)
{
  const d = { relPath: 'p/a.md', content: OKF.serialize({ type: 'Projeto', title: 'A' }, '# A') };
  const p1 = OKF.parseDoc(d);
  assert.strictEqual(p1.frontmatter.type, 'Projeto');
  assert.strictEqual(d._pSrc, d.content);          // memoizou
  d._p = { frontmatter: { type: 'SENTINELA' }, body: '' };  // se reusar o cache, retorna isto
  assert.strictEqual(OKF.parseDoc(d).frontmatter.type, 'SENTINELA');
  d.content = OKF.serialize({ type: 'Outro', title: 'A' }, '# A'); // muda conteúdo → invalida
  assert.strictEqual(OKF.parseDoc(d).frontmatter.type, 'Outro');
  // tolera doc/content ausente
  assert.deepStrictEqual(OKF.parseDoc({}).frontmatter, {});
}
```

- [ ] **Step 2: Rodar e confirmar a falha.** Run: `node test-grouping.js` → FAIL (`OKF.parseDoc is not a function`).

- [ ] **Step 3: Implementar em `renderer/okf.js`.**

(a) Logo após a função `parse(...)` (antes de `serialize`), adicione:

```js
  // Igual a parse(d.content), mas memoiza no próprio doc (campos _p/_pSrc —
  // os mesmos que o parsedOf do renderer usa, compartilhando o cache).
  function parseDoc(d) {
    if (d && d._pSrc === d.content) return d._p;
    const p = parse(d == null || d.content == null ? '' : d.content);
    if (d) { d._p = p; d._pSrc = d.content; }
    return p;
  }
```

(b) Em `buildGraph` — substitua as DUAS chamadas `parse(d.content)` (uma na construção dos nós, outra na extração de links) por `parseDoc(d)`. Procure por `const p = parse(d.content)` / `parse(d.content)` dentro de `buildGraph` e troque para `parseDoc(d)`.

(c) Em `typeLabelLookup` — substitua `const t = parse(d.content).frontmatter.type;` por `const t = parseDoc(d).frontmatter.type;`.

(d) Em `groupConcepts` — substitua `const f = parse(d.content == null ? '' : d.content).frontmatter || {};` por `const f = parseDoc(d).frontmatter || {};`.

(e) Exportar: no objeto retornado por `global.OKF = { ... }`, acrescente `parseDoc` (ao lado de `parse`).

- [ ] **Step 4: Rodar e confirmar.** Run: `node test-grouping.js` → `test-grouping OK`. Run: `npm test` → todos passam (o `test-okf.js` exercita `buildGraph`/`validate` e deve continuar com os mesmos números).

- [ ] **Step 5: Commit.**

```bash
git add renderer/okf.js test-grouping.js
git commit -m "perf(okf): parseDoc memoizado reaproveitado em buildGraph/typeLabelLookup/groupConcepts"
```

---

## Task 2: Sanitizar markdown (DOMPurify) + endurecer CSP

**Files:** Modify `package.json` (via npm), Modify `renderer/index.html`, Modify `renderer/renderer.js`, Modify `test-renderer.js`

- [ ] **Step 1: Instalar DOMPurify.** Run: `npm install dompurify@^3` then confirm `node -e "require('fs').accessSync('node_modules/dompurify/dist/purify.min.js'); console.log('ok')"` prints `ok`. (Isto adiciona `dompurify` em `package.json` dependencies; o `build.files` já inclui `node_modules/**/*`, então entra no app empacotado.)

- [ ] **Step 2: Referenciar o UMD no `index.html`.** Em `renderer/index.html`, logo APÓS a linha `<script src="../node_modules/marked/lib/marked.umd.js"></script>`, adicione:

```html
  <script src="../node_modules/dompurify/dist/purify.min.js"></script>
```

- [ ] **Step 3: Endurecer a CSP.** Em `renderer/index.html`, na meta CSP, acrescente `object-src 'none'; base-uri 'none'; frame-src 'none';` ao final do `content`. A diretiva atual:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' data: blob:;
```

passa a:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-src 'none';
```

- [ ] **Step 4: Sanitizar o sink.** Em `renderer/renderer.js`, na função `renderConcept`, substitua:

```js
  bodyEl.innerHTML = marked.parse(p.body || '');
```

por:

```js
  bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(p.body || ''));
```

(Não altere o sink do manual — é conteúdo estático do próprio app.)

- [ ] **Step 5: Smoke de sanitização.** Em `test-renderer.js`, logo APÓS a linha `console.log('  dnd drop favoritar:', JSON.stringify(dndFav));` (ou após o último bloco de smoke existente, antes do agregado `const okGlobals`), insira:

```js
  // Segurança: DOMPurify presente no renderer e remove handlers/scripts.
  const sani = await win.webContents.executeJavaScript(`(() => {
    if (typeof window.DOMPurify === 'undefined') return { present: false };
    const out = window.DOMPurify.sanitize('<img src=x onerror="alert(1)"><b>ok</b><script>alert(2)<\\/script>');
    return { present: true, noOnerror: out.indexOf('onerror') === -1, noScript: out.toLowerCase().indexOf('<script') === -1, keepsText: out.indexOf('ok') !== -1 };
  })()`);
  const okSani = sani && sani.present === true && sani.noOnerror === true && sani.noScript === true && sani.keepsText === true;
  console.log('  sanitização (DOMPurify):', JSON.stringify(sani));
```

Depois acrescente `&& okSani` à condição do `console.log(... RESULT ...)` e do `app.exit(...)` (em ambas), e antes do RESULT adicione `console.log('  sanitização OK:', okSani);`.

- [ ] **Step 6: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test` (passa). Run: `npm run test:ui` → `RESULT: PASS` e `sanitização OK: true`.

- [ ] **Step 7: Commit.**

```bash
git add package.json package-lock.json renderer/index.html renderer/renderer.js test-renderer.js
git commit -m "fix(sec): sanitiza markdown com DOMPurify e endurece CSP"
```

---

## Task 3: Debounce da busca + corpo em minúsculas cacheado

**Files:** Modify `renderer/renderer.js`

- [ ] **Step 1: Helper de corpo em minúsculas.** Em `renderer/renderer.js`, logo após a função `parsedOf`, adicione:

```js
/* Corpo do doc em minúsculas, memoizado (para a busca não re-baixar toda vez). */
function bodyLcOf(doc) {
  if (doc._blcSrc !== doc.content) { doc._blc = (parsedOf(doc).body || '').toLowerCase(); doc._blcSrc = doc.content; }
  return doc._blc;
}
```

- [ ] **Step 2: Usar o cache no filtro do `renderTree`.** Em `renderTree`, dentro do bloco `if (q) { ... }`, substitua a linha:

```js
      const body = (p.body || '').toLowerCase();
```

por:

```js
      const body = bodyLcOf(d);
```

- [ ] **Step 3: Debounce do input de busca.** Em `init()`, substitua a linha:

```js
  $('search').addEventListener('input', renderTree);
```

por:

```js
  let searchTimer = null;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderTree, 150); });
```

(O `change` do `type-filter` e os botões de agrupar continuam chamando `renderTree` imediatamente — só a digitação é debouncada.)

- [ ] **Step 4: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test` (passa). Run: `npm run test:ui` → `RESULT: PASS` (o smoke da sidebar exercita `renderTree`/grupos e deve continuar passando).

- [ ] **Step 5: Commit.**

```bash
git add renderer/renderer.js
git commit -m "perf(busca): debounce de 150ms e corpo em minúsculas cacheado"
```

---

## Task 4: Guards de estabilidade

**Files:** Modify `renderer/renderer.js`, Modify `test-renderer.js`

- [ ] **Step 1: `cancelEdit` tolera doc ausente.** Em `cancelEdit`, substitua a linha final:

```js
  renderConcept(doc);
```

por:

```js
  if (doc) renderConcept(doc); else showEmpty();
```

- [ ] **Step 2: `performMove` aborta se a origem sumiu.** Na função `async function performMove(fromRel, toRel, logEntry, movedContentOverride) {`, como PRIMEIRA instrução do corpo, adicione:

```js
  if (!docByRel(fromRel)) return false;
```

- [ ] **Step 3: try/catch em `openFolder`, `reload`, `openSample`.**

Em `openFolder`, substitua:

```js
  const res = await window.okf.readBundle(dir);
  const name = dir.split(/[\\/]/).pop();
  loadBundle(res, name);
  await window.okf.recents.add({ path: dir, name });
```

por:

```js
  let res;
  try { res = await window.okf.readBundle(dir); }
  catch (e) { toast('Não foi possível abrir a biblioteca.', 'bad'); return; }
  const name = dir.split(/[\\/]/).pop();
  loadBundle(res, name);
  await window.okf.recents.add({ path: dir, name });
```

Em `reload`, substitua:

```js
  const res = await window.okf.readBundle(state.root);
  loadBundle(res, state.name);
  toast('Biblioteca recarregada', 'good');
```

por:

```js
  let res;
  try { res = await window.okf.readBundle(state.root); }
  catch (e) { toast('Não foi possível recarregar a biblioteca.', 'bad'); return; }
  loadBundle(res, state.name);
  toast('Biblioteca recarregada', 'good');
```

Em `openSample`, substitua:

```js
  const res = await window.okf.readSample();
  loadBundle(res, 'Biblioteca de exemplo');
```

por:

```js
  let res;
  try { res = await window.okf.readSample(); }
  catch (e) { toast('Não foi possível abrir a biblioteca de exemplo.', 'bad'); return; }
  loadBundle(res, 'Biblioteca de exemplo');
```

- [ ] **Step 4: Smoke de `cancelEdit` sem doc.** Em `test-renderer.js`, logo após o bloco de sanitização (Task 2 Step 5), insira:

```js
  // Estabilidade: cancelEdit com state.current inexistente não quebra.
  const cancel = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake4';
    state.docs = [];
    indexDocs();
    state.current = 'sumiu/x.md';
    state.editing = true;
    try { await cancelEdit(); return { ok: true }; } catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  const okCancel = cancel && cancel.ok === true;
  console.log('  cancelEdit sem doc:', JSON.stringify(cancel));
```

Acrescente `&& okCancel` à condição do `console.log(... RESULT ...)` e do `app.exit(...)`, e antes do RESULT adicione `console.log('  estabilidade OK:', okCancel);`.

- [ ] **Step 5: Verificar.** Run: `node --check renderer/renderer.js`. Run: `npm test` (passa). Run: `npm run test:ui` → `RESULT: PASS` e `estabilidade OK: true`.

- [ ] **Step 6: Commit.**

```bash
git add renderer/renderer.js test-renderer.js
git commit -m "fix(estabilidade): guards em cancelEdit, performMove e abertura de biblioteca"
```

---

## Task 5: Verificação manual

**Files:** nenhum.

- [ ] **Step 1:** Run `npm test` (inclui `parseDoc` e `test-grouping OK`) e `npm run test:ui` (`RESULT: PASS` com `sanitização OK`, `estabilidade OK`, `sidebar OK`, `favoritos OK`, `dnd OK`).

- [ ] **Step 2: No app (`npm start`):**
1. Criar um conceito cujo corpo contenha `<img src=x onerror="alert(1)">` e `<script>alert(2)</script>` → ao visualizar, **nada executa** e o conteúdo perigoso é removido (texto normal continua).
2. Abrir uma biblioteca grande e digitar rápido na busca → sem travamento perceptível (debounce).
3. Editar um conceito, deletar o arquivo por fora, clicar **Cancelar** → sem crash (volta ao estado vazio/viewer).
4. Abrir/recarregar uma pasta que foi removida no meio → toast de erro, sem falha silenciosa.
5. Agrupar/buscar/abrir conceitos funcionam normalmente (sem regressão do parse-once).

- [ ] **Step 3: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(revisão): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura)

- **Segurança:** sanitização (Task 2 Step 4) + CSP (Task 2 Step 3) + smoke (Step 5).
- **Performance:** parse-once (Task 1) + debounce/corpo-cacheado (Task 3).
- **Estabilidade:** cancelEdit (Task 4 S1), performMove (S2), open/reload/sample try-catch (S3), smoke (S4). (H2 "view morta na troca de tipo" foi descartado: `applyOpsAndRefresh` sempre chama `refreshFromDisk`, que recupera a view — não é regressão real.)
- **Fora desta leva:** delta-reload (refator maior), serialização de escrita do recents (H4), partial-failure do applyOps no move (C1), e os itens de consistência (split do renderer.js, etc.).
