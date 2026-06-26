# Drag-and-drop na árvore (Peça 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrastar um conceito na árvore e soltá-lo sobre um cabeçalho de grupo para trocar seu tipo (movendo o arquivo, com confirmação), adicionar uma tag, ou favoritá-lo.

**Architecture:** Extrai-se o bloco de troca-de-tipo do `saveEdit` para `changeConceptType(rel, newType, content)` (reusa `performMove`), usado pelo save e pelo drop. Um helper puro `OKF.auto.withAddedTag(content, tag)` cuida da adição de tag. `handleDropOnGroup(rel, group)` decide a operação pelo grupo-alvo; `isValidDropTarget(group, rel)` gate o destaque visual. A ligação de eventos HTML5 DnD fica no `renderTree`.

**Tech Stack:** Electron renderer (JS puro), HTML5 drag-and-drop, testes Node `node:assert` (`test-grouping.js`) e o harness Electron (`test-renderer.js`).

**Spec:** `docs/superpowers/specs/2026-06-25-sidebar-drag-drop-design.md`

**Branch:** `feat/sidebar-drag-drop` (já criada a partir de `feat/tela-inicial-recentes`).

---

## File Structure

| Arquivo | Responsabilidade |
|---------|------------------|
| `renderer/okf.js` *(mod)* | `OKF.auto.withAddedTag(content, tag)` (puro). |
| `test-grouping.js` *(mod)* | Testes de `withAddedTag`. |
| `renderer/renderer.js` *(mod)* | `changeConceptType` (refator do `saveEdit`); `handleDropOnGroup`; `isValidDropTarget`; `draggedRel`; wiring de DnD no `renderTree`. |
| `renderer/styles.css` *(mod)* | `.group-head.drag-over`. |
| `test-renderer.js` *(mod)* | Smoke: `isValidDropTarget` + drop em Favoritos. |

---

## Task 1: `OKF.auto.withAddedTag(content, tag)` + teste

**Files:** Modify `renderer/okf.js`, Modify `test-grouping.js`

- [ ] **Step 1: Teste que falha.** Em `test-grouping.js`, ANTES da linha final `console.log('test-grouping OK');`, insira:

```js
// withAddedTag: adiciona, idempotente, cria tags, preserva resto
{
  const c0 = OKF.serialize({ type: 'Projeto', title: 'A' }, '# A\n\nCorpo.');
  const c1 = OKF.auto.withAddedTag(c0, 'alpha');
  const p1 = OKF.parse(c1);
  assert.deepStrictEqual(p1.frontmatter.tags, ['alpha']);
  assert.strictEqual(p1.frontmatter.type, 'Projeto');
  assert.ok(/Corpo\./.test(p1.body));
  const c2 = OKF.auto.withAddedTag(c1, 'beta');
  assert.deepStrictEqual(OKF.parse(c2).frontmatter.tags, ['alpha', 'beta']);
  const c3 = OKF.auto.withAddedTag(c2, 'alpha'); // já presente
  assert.strictEqual(c3, c2);
  // tag vazia: inalterado
  assert.strictEqual(OKF.auto.withAddedTag(c0, '  '), c0);
}
```

- [ ] **Step 2: Rodar e confirmar a falha.**

Run: `node test-grouping.js`
Expected: FAIL — `OKF.auto.withAddedTag is not a function`.

- [ ] **Step 3: Implementar em `renderer/okf.js`.** Logo APÓS a função `groupConcepts` (antes da linha `const auto = { ... };`), adicione:

```js
  // Retorna o conteúdo com `tag` adicionada ao frontmatter (idempotente; cria
  // `tags` se ausente; preserva o resto). Tag vazia → conteúdo inalterado.
  function withAddedTag(content, tag) {
    const t = String(tag == null ? '' : tag).trim();
    if (!t) return content;
    const p = parse(content == null ? '' : content);
    const fm = Object.assign({}, p.frontmatter);
    const tags = Array.isArray(fm.tags)
      ? fm.tags.slice()
      : (fm.tags != null && String(fm.tags).trim() !== '' ? [String(fm.tags).trim()] : []);
    if (tags.some(x => String(x).trim() === t)) return content;
    tags.push(t);
    fm.tags = tags;
    return serialize(fm, p.body);
  }
```

- [ ] **Step 4: Exportar.** Na linha `const auto = { ..., FAVORITES_GROUP_KEY };`, acrescente `withAddedTag` ao objeto.

- [ ] **Step 5: Rodar e confirmar.** Run: `node test-grouping.js` → `test-grouping OK`. Run: `npm test` → todos passam.

- [ ] **Step 6: Commit.**

```bash
git add renderer/okf.js test-grouping.js
git commit -m "feat(dnd): OKF.auto.withAddedTag (adiciona tag idempotente ao frontmatter)"
```

---

## Task 2: Extrair `changeConceptType` do `saveEdit` (refator)

**Files:** Modify `renderer/renderer.js`

Refator que preserva comportamento: a troca-de-tipo-que-move-pasta do `saveEdit` vira uma função reusável.

- [ ] **Step 1: Adicionar `changeConceptType`.** Em `renderer/renderer.js`, imediatamente ANTES da função `async function performMove(` , insira:

```js
// Troca o tipo de um conceito movendo o arquivo para a pasta do novo tipo.
// `content` é o conteúdo já com o frontmatter do novo tipo. Retorna o destino
// (relPath) em sucesso, ou null em falha. Reusa performMove.
async function changeConceptType(rel, newType, content) {
  let dest = OKF.auto.moveTargetForType(rel, newType || '');
  let k = 2;
  while (docByRel(dest) && dest !== rel) {
    dest = OKF.auto.folderForType(newType || '') + '/' +
           baseNameOf(rel).replace(/\.md$/i, '') + '-' + (k++) + '.md';
  }
  const titleMv = OKF.parse(content).frontmatter.title || baseNameOf(dest).replace(/\.md$/i, '');
  const logEntry = autoIndexEnabled()
    ? '**Troca de tipo**: `' + rel + '` → [' + titleMv + '](/' + dest + ') (Tipo: ' + (newType || '') + ').'
    : null;
  const ok = await performMove(rel, dest, logEntry, content);
  return ok ? dest : null;
}
```

- [ ] **Step 2: Usar no `saveEdit`.** Em `saveEdit`, substitua o bloco inteiro:

```js
    if (folderChanged) {
      let dest = OKF.auto.moveTargetForType(doc.relPath, after.type || '');
      let k = 2;
      while (docByRel(dest) && dest !== doc.relPath) {
        dest = OKF.auto.folderForType(after.type || '') + '/' +
               baseNameOf(doc.relPath).replace(/\.md$/i, '') + '-' + (k++) + '.md';
      }
      doc.content = content; // o arquivo movido carrega o frontmatter novo
      const titleMv = after.title || baseNameOf(dest).replace(/\.md$/i, '');
      const logEntry = autoIndexEnabled()
        ? '**Troca de tipo**: `' + doc.relPath + '` → [' + titleMv + '](/' + dest + ') (Tipo: ' + (after.type || '') + ').'
        : null;
      if (state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      state.editing = false;
      const okMove = await performMove(doc.relPath, dest, logEntry, content);
      if (okMove) toast('Tipo alterado; movido para ' + dest, 'good');
      return;
    }
```

por:

```js
    if (folderChanged) {
      doc.content = content; // o arquivo movido carrega o frontmatter novo
      if (state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      state.editing = false;
      const dest = await changeConceptType(doc.relPath, after.type || '', content);
      if (dest) toast('Tipo alterado; movido para ' + dest, 'good');
      return;
    }
```

- [ ] **Step 3: Verificar.**

Run: `node --check renderer/renderer.js` → sem erro.
Run: `npm test` → passa.
Run: `npm run test:ui` → `RESULT: PASS` (confirma que o renderer ainda carrega e os fluxos existentes não quebraram).

- [ ] **Step 4: Commit.**

```bash
git add renderer/renderer.js
git commit -m "refactor(dnd): extrai changeConceptType do saveEdit (reuso no drop)"
```

---

## Task 3: Drop dispatch + wiring de DnD no `renderTree`

**Files:** Modify `renderer/renderer.js`

- [ ] **Step 1: Estado do arraste.** Perto da declaração `let treeMenuRel = null;`, adicione:

```js
let draggedRel = null; // relPath do conceito sendo arrastado
```

- [ ] **Step 2: `isValidDropTarget` e `handleDropOnGroup`.** Logo APÓS a função `toggleGroup` (perto dos helpers da árvore), insira:

```js
// Decide se um grupo aceita o conceito arrastado (gate do destaque visual).
function isValidDropTarget(g, rel) {
  if (!rel || !g) return false;
  const doc = docByRel(rel);
  if (!doc || doc.reserved) return false;
  if (g.favorites) return !state.favorites.has(rel);
  if (g.system || g.special) return false;
  if (g.key && g.key.indexOf('type:') === 0) {
    const curType = OKF.parse(doc.content).frontmatter.type || '';
    return OKF.auto.folderForType(curType) !== OKF.auto.folderForType(g.label);
  }
  if (g.key && g.key.indexOf('tag:') === 0) {
    const tags = OKF.parse(doc.content).frontmatter.tags;
    const arr = Array.isArray(tags) ? tags : (tags != null && String(tags).trim() !== '' ? [tags] : []);
    return !arr.some(x => String(x).trim() === g.label);
  }
  return false;
}

// Executa a operação do drop conforme o grupo-alvo.
async function handleDropOnGroup(rel, g) {
  if (!isValidDropTarget(g, rel)) return;
  const doc = docByRel(rel);
  if (g.favorites) {
    state.favorites.add(rel); saveFavorites(); renderTree();
    toast('Favoritado', 'good');
    return;
  }
  if (g.key.indexOf('type:') === 0) {
    const newType = g.label;
    const ok = await window.okf.confirm({
      message: 'Mudar o tipo para "' + newType + '"?',
      detail: 'O arquivo será movido para a pasta do tipo e os links atualizados.'
    });
    if (!ok) return;
    const p = OKF.parse(doc.content);
    const content = OKF.serialize(Object.assign({}, p.frontmatter, { type: newType }), p.body);
    const dest = await changeConceptType(rel, newType, content);
    if (dest) toast('Tipo alterado para ' + newType, 'good');
    return;
  }
  if (g.key.indexOf('tag:') === 0) {
    const content = OKF.auto.withAddedTag(doc.content, g.label);
    const ok = await applyOpsAndRefresh([{ op: 'write', relPath: rel, content }], rel);
    if (ok) toast('Tag "' + g.label + '" adicionada', 'good');
    return;
  }
}
```

- [ ] **Step 3: Tornar os nós arrastáveis.** No `renderTree`, logo APÓS a linha que registra o menu de contexto do nó — `if (!it.reserved) node.addEventListener('contextmenu', (e) => { e.preventDefault(); openTreeMenu(e, it.relPath); });` — adicione:

```js
      if (!it.reserved) {
        node.setAttribute('draggable', 'true');
        node.addEventListener('dragstart', (e) => {
          draggedRel = it.relPath;
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.relPath); } catch (_) {} }
        });
        node.addEventListener('dragend', () => { draggedRel = null; });
      }
```

- [ ] **Step 4: Cabeçalhos como alvos de drop.** No `renderTree`, logo APÓS a linha `head.addEventListener('click', () => toggleGroup(g.key));`, adicione:

```js
      head.dataset.groupKey = g.key;
      head.addEventListener('dragover', (e) => { if (isValidDropTarget(g, draggedRel)) { e.preventDefault(); head.classList.add('drag-over'); } });
      head.addEventListener('dragleave', () => head.classList.remove('drag-over'));
      head.addEventListener('drop', (e) => { e.preventDefault(); head.classList.remove('drag-over'); const rel = draggedRel; draggedRel = null; handleDropOnGroup(rel, g); });
```

- [ ] **Step 5: Verificar.**

Run: `node --check renderer/renderer.js` → sem erro.
Run: `npm test` → passa.

- [ ] **Step 6: Commit.**

```bash
git add renderer/renderer.js
git commit -m "feat(dnd): drop em grupos para trocar tipo, adicionar tag ou favoritar"
```

---

## Task 4: Estilo do alvo de drop

**Files:** Modify `renderer/styles.css`

- [ ] **Step 1: Acrescentar estilo.** Append ao final de `renderer/styles.css`:

```css
/* ---------- Sidebar: alvo de drop (drag-and-drop) ---------- */
.tree .group-head.drag-over { background: var(--active); color: var(--accent); border-radius: 6px; }
```

- [ ] **Step 2: Verificar.** Run: `npm test`. Confirme via `git diff --stat` que só `renderer/styles.css` mudou.

- [ ] **Step 3: Commit.**

```bash
git add renderer/styles.css
git commit -m "feat(dnd): destaque do cabeçalho de grupo no dragover"
```

---

## Task 5: Smoke de DOM (decisão de drop + favoritar)

**Files:** Modify `test-renderer.js`

- [ ] **Step 1: Adicionar o bloco.** Em `test-renderer.js`, logo APÓS a linha `console.log('  favoritos grupo/marcador:', JSON.stringify(fav));`, insira:

```js
  // Drag-and-drop: isValidDropTarget decide alvos; drop em Favoritos favorita.
  const dnd = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake3';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    const rel = 'projeto/a.md';
    const gType = { key: 'type:Processo', label: 'Processo', special: false, system: false, favorites: false };
    const gSameType = { key: 'type:Projeto', label: 'Projeto', special: false, system: false, favorites: false };
    const gTag = { key: 'tag:foo', label: 'foo', special: false, system: false, favorites: false };
    const gSpecial = { key: '__notype__', label: 'Sem tipo', special: true, system: false, favorites: false };
    const gFav = { key: '__favorites__', label: '★ Favoritos', special: false, system: false, favorites: true };
    const validType = isValidDropTarget(gType, rel);
    const invalidSameType = isValidDropTarget(gSameType, rel);
    const validTag = isValidDropTarget(gTag, rel);
    const invalidSpecial = isValidDropTarget(gSpecial, rel);
    const validFav = isValidDropTarget(gFav, rel);
    return { validType, invalidSameType, validTag, invalidSpecial, validFav };
  })()`);
  const okDnd = dnd && dnd.validType === true && dnd.invalidSameType === false &&
    dnd.validTag === true && dnd.invalidSpecial === false && dnd.validFav === true;
  console.log('  dnd isValidDropTarget:', JSON.stringify(dnd));

  // drop em Favoritos favorita (sem IPC)
  const dndFav = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake3';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    setGroupMode('type'); renderTree();
    await handleDropOnGroup('projeto/a.md', { key: '__favorites__', label: '★ Favoritos', favorites: true, special: false, system: false });
    return { favorited: state.favorites.has('projeto/a.md') };
  })()`);
  const okDndFav = dndFav && dndFav.favorited === true;
  console.log('  dnd drop favoritar:', JSON.stringify(dndFav));
```

- [ ] **Step 2: Incluir no agregado.** Acrescente `&& okDnd && okDndFav` à condição do `console.log(... RESULT ...)` e do `app.exit(...)` (em ambas), e antes do console de RESULT adicione:

```js
  console.log('  dnd OK:', okDnd && okDndFav);
```

- [ ] **Step 3: Rodar.** Run: `npm run test:ui` → `RESULT: PASS` e `dnd OK: true`.

- [ ] **Step 4: Commit.**

```bash
git add test-renderer.js
git commit -m "test(dnd): smoke de isValidDropTarget e drop favoritar"
```

---

## Task 6: Verificação manual

**Files:** nenhum.

- [ ] **Step 1:** Run `npm test` (inclui `test-grouping OK`) e `npm run test:ui` (`RESULT: PASS`, `dnd OK: true`).

- [ ] **Step 2: No app (`npm start`):**
1. No modo **Tipo**, arrastar um conceito sobre outro grupo de tipo → confirma; ao aceitar, o tipo muda e o arquivo é movido (aparece no novo grupo). Cancelar não altera nada.
2. Arrastar sobre o **próprio** grupo de tipo, "Sem tipo" ou "Sistema" → não destaca e não faz nada.
3. No modo **Tag**, arrastar sobre um grupo de tag → a tag é adicionada (o conceito passa a aparecer naquele grupo de tag); arrastar sobre uma tag que já tem → não destaca.
4. Arrastar sobre **★ Favoritos** (qualquer modo) → favorita (★ aparece); se já favorito → não destaca.
5. Cabeçalhos válidos destacam (`drag-over`) durante o arraste; inválidos não.
6. Conceitos reservados (Sistema) não são arrastáveis.

- [ ] **Step 3: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(dnd): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura do spec)

- **Drop em grupo de Tipo = trocar tipo (move, com confirmação)** → Task 2 (`changeConceptType`) + Task 3 (`handleDropOnGroup` ramo `type:`).
- **Drop em grupo de Tag = adicionar tag** → Task 1 (`withAddedTag`) + Task 3 (ramo `tag:`).
- **Drop em ★ Favoritos = favoritar** → Task 3 (ramo `favorites`).
- **Só cabeçalhos; alvos inválidos (próprio tipo, Sem tipo/tag, Sistema) rejeitam** → Task 3 (`isValidDropTarget`).
- **Arrastáveis só não reservados; feedback `drag-over`** → Task 3 (steps 3-4) + Task 4 (CSS).
- **DRY com saveEdit** → Task 2 (refator).
- **Testes** → Task 1 (unidade) + Task 5 (smoke).
