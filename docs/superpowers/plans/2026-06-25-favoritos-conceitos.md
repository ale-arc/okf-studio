# Favoritos de conceitos (Peça 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixar conceitos como favoritos, reunidos num grupo "★ Favoritos" fixo no topo da árvore (e ainda presentes no seu grupo normal), marcados via menu de contexto, persistidos por biblioteca.

**Architecture:** `OKF.auto.groupConcepts(docs, mode, favorites)` ganha um 3º parâmetro e emite o grupo Favoritos primeiro (rank −1). O renderer mantém `state.favorites` (Set de relPaths) persistido em `localStorage` por biblioteca (como o colapso da Peça 1), alterna via menu de contexto, desenha um marcador ★ read-only nos nós favoritados, e migra o favorito no `performMove` (rename/move).

**Tech Stack:** Electron renderer (JS puro), `localStorage`, testes Node `node:assert` (`test-grouping.js`) e o harness Electron (`test-renderer.js`).

**Spec:** `docs/superpowers/specs/2026-06-25-favoritos-conceitos-design.md`

---

## File Structure

| Arquivo | Responsabilidade |
|---------|------------------|
| `renderer/okf.js` *(mod)* | `groupConcepts` aceita `favorites`; emite grupo Favoritos (rank −1); `FAVORITES_GROUP_KEY`. |
| `test-grouping.js` *(mod)* | Casos de favoritos no teste de `groupConcepts`. |
| `renderer/index.html` *(mod)* | Botão `data-act="favorite"` no `#tree-menu`. |
| `renderer/renderer.js` *(mod)* | `state.favorites`, helpers, `toggleFavorite`, render (passar favoritos + marcador ★), `loadBundle`, rótulo dinâmico do menu, handler, migração no `performMove`. |
| `renderer/styles.css` *(mod)* | Marcador `.fav-mark`. |
| `test-renderer.js` *(mod)* | Smoke: favoritar mostra o grupo no topo; desfavoritar remove. |

---

## Task 1: `groupConcepts(docs, mode, favorites)` + grupo Favoritos

**Files:** Modify `renderer/okf.js`, Modify `test-grouping.js`

- [ ] **Step 1: Acrescentar os testes que falham.** Em `test-grouping.js`, ANTES da linha final `console.log('test-grouping OK');`, insira:

```js
// favoritos: grupo "★ Favoritos" primeiro; item duplicado no grupo normal
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'Atlas' }),
    doc('projeto/b.md', { type: 'Projeto', title: 'Bravo' }),
  ];
  const g = G(docs, 'type', new Set(['projeto/a.md']));
  assert.strictEqual(g[0].favorites, true);
  assert.strictEqual(g[0].key, OKF.auto.FAVORITES_GROUP_KEY);
  assert.deepStrictEqual(g[0].items.map(i => i.title), ['Atlas']);
  assert.deepStrictEqual(g.find(x => x.label === 'Projeto').items.map(i => i.title), ['Atlas', 'Bravo']);
}

// sem favoritos -> nenhum grupo Favoritos (e compat sem o 3º argumento)
{
  const docs = [doc('p/a.md', { type: 'Projeto', title: 'A' })];
  assert.ok(!G(docs, 'type', new Set()).some(x => x.favorites));
  assert.ok(!G(docs, 'type').some(x => x.favorites));
}

// reservado no set de favoritos é ignorado
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'A' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
  ];
  assert.ok(!G(docs, 'type', new Set(['index.md'])).some(x => x.favorites));
}
```

- [ ] **Step 2: Rodar e confirmar a falha.**

Run: `node test-grouping.js`
Expected: FAIL (ex.: `g[0].favorites` é `undefined` / `FAVORITES_GROUP_KEY` indefinido).

- [ ] **Step 3: Implementar em `renderer/okf.js`.**

(a) Logo após a linha `const SYSTEM_GROUP_KEY = '__system__';`, adicione:

```js
  const FAVORITES_GROUP_KEY = '__favorites__';
```

(b) Altere a assinatura de `function groupConcepts(docs, mode) {` para:

```js
  function groupConcepts(docs, mode, favorites) {
```

(c) Logo após `const list = Array.isArray(docs) ? docs : [];` (primeira linha do corpo), adicione:

```js
    const favs = favorites instanceof Set ? favorites : new Set(Array.isArray(favorites) ? favorites : []);
```

(d) No helper `ensure`, acrescente o flag `favorites` ao objeto criado. Substitua:

```js
      if (!groups.has(key)) groups.set(key, {
        key, label,
        special: !!(opts && opts.special),
        system: !!(opts && opts.system),
        items: []
      });
```

por:

```js
      if (!groups.has(key)) groups.set(key, {
        key, label,
        special: !!(opts && opts.special),
        system: !!(opts && opts.system),
        favorites: !!(opts && opts.favorites),
        items: []
      });
```

(e) Dentro do `for (const d of list) {`, logo APÓS a linha `const item = { relPath: d.relPath, title, type, reserved };` e ANTES da linha `if (reserved) { ensure(SYSTEM_GROUP_KEY, ...`, adicione:

```js
      if (!reserved && favs.has(d.relPath)) ensure(FAVORITES_GROUP_KEY, '★ Favoritos', { favorites: true }).items.push(item);
```

(f) Atualize a função `rank` para colocar o grupo de favoritos primeiro. Substitua:

```js
    const rank = (g) => g.system ? 3 : (g.special ? 2 : (g.key === FLAT ? 0 : 1));
```

por:

```js
    const rank = (g) => g.favorites ? -1 : (g.system ? 3 : (g.special ? 2 : (g.key === FLAT ? 0 : 1)));
```

(g) Na linha `const auto = { ..., groupConcepts, SYSTEM_GROUP_KEY };`, acrescente `FAVORITES_GROUP_KEY` ao objeto, ex.: `..., groupConcepts, SYSTEM_GROUP_KEY, FAVORITES_GROUP_KEY };`.

- [ ] **Step 4: Rodar e confirmar que passa.**

Run: `node test-grouping.js` → `test-grouping OK`.
Run: `npm test` → todos passam.

- [ ] **Step 5: Commit.**

```bash
git add renderer/okf.js test-grouping.js
git commit -m "feat(favoritos): groupConcepts emite grupo Favoritos no topo"
```

---

## Task 2: Botão de favoritar no menu de contexto (HTML)

**Files:** Modify `renderer/index.html`

- [ ] **Step 1: Adicionar o botão.** Em `renderer/index.html`, no bloco `#tree-menu`, ANTES do botão `data-act="rename"`, adicione um botão de favoritar. Substitua:

```html
  <div id="tree-menu" class="tree-menu hidden">
    <button data-act="rename">✏ Renomear/Mover…</button>
    <button data-act="delete" class="danger">🗑 Excluir</button>
  </div>
```

por:

```html
  <div id="tree-menu" class="tree-menu hidden">
    <button data-act="favorite">★ Favoritar</button>
    <button data-act="rename">✏ Renomear/Mover…</button>
    <button data-act="delete" class="danger">🗑 Excluir</button>
  </div>
```

- [ ] **Step 2: Verificar.** Run: `npm test` (HTML não é testado). Confirme via `git diff --stat` que só `renderer/index.html` mudou.

- [ ] **Step 3: Commit.**

```bash
git add renderer/index.html
git commit -m "feat(favoritos): item Favoritar no menu de contexto da árvore"
```

---

## Task 3: Renderer — estado, toggle, render, menu e migração

**Files:** Modify `renderer/renderer.js`

As funções/objetos `state`, `renderTree`, `openTreeMenu`, `performMove`, `loadBundle`, e os helpers de colapso já existem (Peça 1). Reuse-os.

- [ ] **Step 1: `favorites` no estado.** No objeto `const state = { ... }`, logo após `collapsed: new Set(),`, adicione:

```js
  favorites: new Set(),
```

- [ ] **Step 2: Helpers de favoritos.** Logo após a função `saveCollapsed` (perto dos helpers de colapso, antes de `function toggleGroup`), insira:

```js
function favoritesKey() { return 'okf-favorites:' + (state.root || ''); }
function loadFavoritesSet() {
  try { const a = JSON.parse(localStorage.getItem(favoritesKey())); return new Set(Array.isArray(a) ? a : []); }
  catch (e) { return new Set(); }
}
function saveFavorites() { try { localStorage.setItem(favoritesKey(), JSON.stringify([...state.favorites])); } catch (e) {} }
function toggleFavorite(rel) {
  if (!rel) return;
  if (state.favorites.has(rel)) state.favorites.delete(rel); else state.favorites.add(rel);
  saveFavorites();
  renderTree();
}
```

- [ ] **Step 3: `renderTree` — passar favoritos.** Na função `renderTree`, substitua a linha:

```js
  const groups = OKF.auto.groupConcepts(filtered, mode);
```

por:

```js
  const groups = OKF.auto.groupConcepts(filtered, mode, state.favorites);
```

- [ ] **Step 4: `renderTree` — cabeçalho do grupo Favoritos não é headless.** Substitua a linha:

```js
    const headless = (mode === 'flat' && !g.system); // lista plana não tem cabeçalho
```

por:

```js
    const headless = (mode === 'flat' && !g.system && !g.favorites); // lista plana não tem cabeçalho (favoritos e sistema têm)
```

- [ ] **Step 5: `renderTree` — marcador ★ no nó.** Substitua o bloco:

```js
      const showBadge = it.type && mode !== 'type'; // no modo Tipo o badge é redundante
      node.innerHTML = `<span class="ic">${it.reserved ? '◷' : '📄'}</span><span class="ttl"></span>` +
        (showBadge ? `<span class="badge"></span>` : '');
      node.querySelector('.ttl').textContent = it.title;
      if (showBadge) node.querySelector('.badge').textContent = it.type;
```

por:

```js
      const showBadge = it.type && mode !== 'type'; // no modo Tipo o badge é redundante
      const isFav = !it.reserved && state.favorites.has(it.relPath);
      node.innerHTML = `<span class="ic">${it.reserved ? '◷' : '📄'}</span><span class="ttl"></span>` +
        (showBadge ? `<span class="badge"></span>` : '') +
        (isFav ? `<span class="fav-mark" title="Favorito">★</span>` : '');
      node.querySelector('.ttl').textContent = it.title;
      if (showBadge) node.querySelector('.badge').textContent = it.type;
```

- [ ] **Step 6: `loadBundle` — carregar favoritos.** Em `loadBundle`, logo após a linha `state.collapsed = loadCollapsedSet();`, adicione:

```js
  state.favorites = loadFavoritesSet();
```

- [ ] **Step 7: `openTreeMenu` — rótulo dinâmico.** Na função `openTreeMenu(e, rel)`, logo após `treeMenuRel = rel;`, adicione:

```js
  const favBtn = $('tree-menu').querySelector('button[data-act="favorite"]');
  if (favBtn) favBtn.textContent = state.favorites.has(rel) ? '☆ Remover dos favoritos' : '★ Favoritar';
```

- [ ] **Step 8: Handler do menu.** No `init()`, no handler dos botões do `#tree-menu`, há um bloco:

```js
    if (act === 'rename') openRename(rel);
    else if (act === 'delete') { openDoc(rel); deleteCurrent(); }
```

Substitua-o por:

```js
    if (act === 'favorite') toggleFavorite(rel);
    else if (act === 'rename') openRename(rel);
    else if (act === 'delete') { openDoc(rel); deleteCurrent(); }
```

- [ ] **Step 9: Migração no `performMove`.** Na função `performMove(fromRel, toRel, ...)`, localize a última linha `return applyOpsAndRefresh(ops, toRel);` e, IMEDIATAMENTE ANTES dela, adicione:

```js
  if (state.favorites.has(fromRel)) { state.favorites.delete(fromRel); state.favorites.add(toRel); saveFavorites(); }
```

- [ ] **Step 10: Verificar.**

Run: `node --check renderer/renderer.js` → sem erro.
Run: `npm test` → tudo passa.

- [ ] **Step 11: Commit.**

```bash
git add renderer/renderer.js
git commit -m "feat(favoritos): estado, toggle no menu, marcador ★ e migração no rename"
```

---

## Task 4: Estilo do marcador ★

**Files:** Modify `renderer/styles.css`

- [ ] **Step 1: Acrescentar estilo.** Append ao final de `renderer/styles.css`:

```css
/* ---------- Sidebar: marcador de favorito ---------- */
.tree .node .fav-mark { color: var(--warn); font-size: 11px; margin-left: 6px; }
```

- [ ] **Step 2: Verificar.** Run: `npm test`. Confirme via `git diff --stat` que só `renderer/styles.css` mudou.

- [ ] **Step 3: Commit.**

```bash
git add renderer/styles.css
git commit -m "feat(favoritos): estilo do marcador ★"
```

---

## Task 5: Smoke de DOM (favoritar/desfavoritar)

**Files:** Modify `test-renderer.js`

- [ ] **Step 1: Adicionar o bloco.** Em `test-renderer.js`, logo após o bloco do smoke da sidebar (a linha `console.log('  sidebar agrupamento/colapso:', JSON.stringify(sidebar));`), insira:

```js
  // Favoritos: favoritar via toggleFavorite mostra o grupo no topo; desfavoritar remove.
  const fav = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake2';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    document.getElementById('type-filter').value = '';
    document.getElementById('search').value = '';
    setGroupMode('type'); renderTree();
    const labels = () => [...document.querySelectorAll('#tree .group-head .g-label')].map(e => e.textContent);
    const beforeFav = labels().some(l => l.indexOf('Favoritos') >= 0);
    toggleFavorite('projeto/a.md');
    const after = labels();
    const hasFav = after.some(l => l.indexOf('Favoritos') >= 0);
    const favFirst = !!(after[0] && after[0].indexOf('Favoritos') >= 0);
    const marks = document.querySelectorAll('#tree .fav-mark').length;
    toggleFavorite('projeto/a.md');
    const removed = labels().some(l => l.indexOf('Favoritos') >= 0);
    return { beforeFav, hasFav, favFirst, marks, removed };
  })()`);
  const okFav = fav && fav.beforeFav === false && fav.hasFav === true &&
    fav.favFirst === true && fav.marks >= 1 && fav.removed === false;
  console.log('  favoritos grupo/marcador:', JSON.stringify(fav));
```

- [ ] **Step 2: Incluir no agregado.** Acrescente `&& okFav` à condição do `console.log(... RESULT ...)` e do `app.exit(...)` (em ambas), e adicione antes do console de RESULT:

```js
  console.log('  favoritos OK:', okFav);
```

- [ ] **Step 3: Rodar.** Run: `npm run test:ui` → termina com `RESULT: PASS` e `favoritos OK: true`.

- [ ] **Step 4: Commit.**

```bash
git add test-renderer.js
git commit -m "test(favoritos): smoke do grupo Favoritos e marcador no DOM"
```

---

## Task 6: Verificação manual

**Files:** nenhum.

- [ ] **Step 1:** Run `npm test` (inclui `test-grouping OK`) e `npm run test:ui` (`RESULT: PASS`, `favoritos OK: true`).

- [ ] **Step 2: No app (`npm start`):**
1. Botão direito num conceito → **"★ Favoritar"**; ele passa a aparecer no grupo **"★ Favoritos"** no topo E continua no seu grupo de tipo, ambos com **★** ao lado do título.
2. Botão direito num favoritado → **"☆ Remover dos favoritos"**; sai do grupo Favoritos (e o ★ some).
3. Sem favoritos, o grupo "★ Favoritos" **não aparece**.
4. O grupo Favoritos recolhe/expande e aparece em qualquer modo (Tipo/Tag/Lista), sempre no topo.
5. Favoritos **persistem** ao reabrir o app; cada biblioteca tem o seu conjunto.
6. Renomear/mover um conceito favoritado **mantém** o favorito (continua no grupo Favoritos com o novo caminho).

- [ ] **Step 3: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(favoritos): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura do spec)

- **Marcar via menu de contexto (rótulo dinâmico)** → Task 2 (botão) + Task 3 (steps 7-8).
- **Grupo "★ Favoritos" no topo, item duplicado no grupo normal** → Task 1 (rank −1, push duplicado) + Task 3 (step 3-4).
- **Persistência por biblioteca + migração no rename** → Task 3 (steps 2, 6, 9).
- **Marcador ★ read-only** → Task 3 (step 5) + Task 4 (CSS).
- **Grupo some quando não há favoritos; reservados ignorados** → Task 1 (só cria o grupo se houver item; `!reserved`).
- **Compatibilidade (3º arg opcional)** → Task 1 (`favs` default vazio).
- **Testes** → Task 1 (unidade) + Task 5 (smoke).
