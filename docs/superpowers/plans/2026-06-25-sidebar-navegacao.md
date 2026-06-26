# Navegação da sidebar (Peça 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrupar a árvore da sidebar por Tipo/Tag/Lista, com seções recolhíveis (sanfona) persistidas por biblioteca, e a busca + filtro de tipo movidos do toolbar para o topo da sidebar.

**Architecture:** A lógica pura de agrupamento vira `OKF.auto.groupConcepts(docs, mode)` em `renderer/okf.js` (testável em Node). O `renderTree()` em `renderer/renderer.js` filtra os docs (busca + filtro, como hoje), chama `groupConcepts` e desenha grupos recolhíveis. O modo de agrupamento é uma preferência global em `localStorage`; o colapso é persistido por biblioteca. Busca e filtro saem do toolbar para a sidebar (mesmos ids, listeners preservados).

**Tech Stack:** Electron renderer (JS puro, sem TS), `localStorage` para preferências, testes Node com `node:assert` (lógica) e o harness Electron `test-renderer.js` (smoke de DOM).

**Spec:** `docs/superpowers/specs/2026-06-25-sidebar-navegacao-design.md`

---

## File Structure

| Arquivo | Responsabilidade |
|---------|------------------|
| `renderer/okf.js` *(mod)* | `OKF.auto.groupConcepts` + constante `SYSTEM_GROUP_KEY` (lógica pura de agrupamento). |
| `test-grouping.js` *(novo)* | Teste de unidade Node de `groupConcepts`. |
| `renderer/renderer.js` *(mod)* | Helpers de modo/colapso; `renderTree` reescrito; `toggleGroup`; `updateGroupModeButtons`; `state.collapsed`; wiring em `loadBundle`/`init`. |
| `renderer/index.html` *(mod)* | Move `#search`/`#type-filter` para a sidebar; adiciona o controle segmentado `#group-seg`. |
| `renderer/styles.css` *(mod)* | Ferramentas da sidebar, controle segmentado, cabeçalhos de grupo e estado recolhido. |
| `test-renderer.js` *(mod)* | Smoke de DOM: alternar modo e recolher grupo. |
| `package.json` *(mod)* | `test-grouping.js` no script `test`. |

---

## Task 1: `OKF.auto.groupConcepts` + teste

**Files:**
- Modify: `renderer/okf.js`
- Create: `test-grouping.js`
- Modify: `package.json`

- [ ] **Step 1: Escrever o teste que falha.** Create `test-grouping.js`:

```js
'use strict';
const assert = require('node:assert');
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const G = OKF.auto.groupConcepts;

const doc = (relPath, fm, body) => ({ relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '# x') });

// modo Tipo: agrupa por type; sem type -> "Sem tipo" (especial por último)
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'Atlas' }),
    doc('processo/b.md', { type: 'Processo', title: 'Onboarding' }),
    doc('x/c.md', { title: 'Solto' }),
  ];
  const g = G(docs, 'type');
  assert.deepStrictEqual(g.map(x => x.label), ['Processo', 'Projeto', 'Sem tipo']);
  assert.strictEqual(g.find(x => x.label === 'Projeto').items[0].title, 'Atlas');
}

// modo Tag: multi-tag duplica; sem tag -> "Sem tag"
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'A', tags: ['alpha', 'beta'] }),
    doc('p/b.md', { type: 'Projeto', title: 'B', tags: ['alpha'] }),
    doc('p/c.md', { type: 'Projeto', title: 'C' }),
  ];
  const g = G(docs, 'tag');
  assert.deepStrictEqual(g.find(x => x.label === 'alpha').items.map(i => i.title), ['A', 'B']);
  assert.deepStrictEqual(g.find(x => x.label === 'beta').items.map(i => i.title), ['A']);
  assert.deepStrictEqual(g.find(x => x.label === 'Sem tag').items.map(i => i.title), ['C']);
  assert.strictEqual(g[g.length - 1].label, 'Sem tag');
}

// reservados -> grupo Sistema (flag system, por último)
{
  const docs = [
    doc('projeto/a.md', { type: 'Projeto', title: 'A' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
    { relPath: 'log.md', name: 'log.md', content: '# Log' },
  ];
  const g = G(docs, 'type');
  const sys = g.find(x => x.system);
  assert.ok(sys, 'grupo Sistema existe');
  assert.strictEqual(sys.label, 'Sistema');
  assert.strictEqual(sys.key, OKF.auto.SYSTEM_GROUP_KEY);
  assert.strictEqual(sys.items.length, 2);
  assert.strictEqual(g[g.length - 1].system, true);
}

// modo Lista: um grupo sem label (itens por título) + Sistema ao fim
{
  const docs = [
    doc('p/a.md', { type: 'Projeto', title: 'Bravo' }),
    doc('p/b.md', { type: 'Processo', title: 'Alfa' }),
    { relPath: 'index.md', name: 'index.md', content: '# Índice' },
  ];
  const g = G(docs, 'flat');
  const all = g.find(x => !x.system);
  assert.strictEqual(all.label, '');
  assert.deepStrictEqual(all.items.map(i => i.title), ['Alfa', 'Bravo']);
  assert.ok(g.find(x => x.system), 'Sistema presente em Lista');
}

console.log('test-grouping OK');
```

- [ ] **Step 2: Rodar e confirmar a falha.**

Run: `node test-grouping.js`
Expected: FAIL — `TypeError: G is not a function` (groupConcepts ainda não existe).

- [ ] **Step 3: Implementar `groupConcepts` em `renderer/okf.js`.** Logo ANTES da linha `const auto = { ... };` (perto da linha 420), insira:

```js
  const SYSTEM_GROUP_KEY = '__system__';
  // Agrupa conceitos para a árvore da sidebar. mode ∈ {'type','tag','flat'}.
  // Retorna grupos ordenados: normais alfabéticos; "Sem tipo"/"Sem tag" depois;
  // "Sistema" (reservados) sempre por último. Em 'tag', um conceito com várias
  // tags aparece em cada grupo de tag (duplicado).
  function groupConcepts(docs, mode) {
    const list = Array.isArray(docs) ? docs : [];
    const NOTYPE = '__notype__', NOTAG = '__notag__', FLAT = '__all__';
    const groups = new Map();
    const ensure = (key, label, opts) => {
      if (!groups.has(key)) groups.set(key, {
        key, label,
        special: !!(opts && opts.special),
        system: !!(opts && opts.system),
        items: []
      });
      return groups.get(key);
    };
    for (const d of list) {
      const f = parse(d.content).frontmatter || {};
      const reserved = isReserved(d.relPath);
      const base = d.relPath.split('/').pop().replace(/\.md$/i, '');
      const title = (f.title != null && String(f.title).trim() !== '') ? String(f.title) : base;
      const type = reserved ? '' : ((f.type != null && String(f.type).trim() !== '') ? String(f.type).trim() : '');
      const item = { relPath: d.relPath, title, type, reserved };
      if (reserved) { ensure(SYSTEM_GROUP_KEY, 'Sistema', { special: true, system: true }).items.push(item); continue; }
      if (mode === 'flat') { ensure(FLAT, '', {}).items.push(item); continue; }
      if (mode === 'tag') {
        const tags = Array.isArray(f.tags)
          ? f.tags.map(t => String(t).trim()).filter(Boolean)
          : (f.tags != null && String(f.tags).trim() !== '' ? [String(f.tags).trim()] : []);
        if (!tags.length) ensure(NOTAG, 'Sem tag', { special: true }).items.push(item);
        else for (const t of tags) ensure('tag:' + t, t, {}).items.push(item);
        continue;
      }
      if (!type) ensure(NOTYPE, 'Sem tipo', { special: true }).items.push(item);
      else ensure('type:' + type, type, {}).items.push(item);
    }
    for (const g of groups.values()) g.items.sort((a, b) => a.title.localeCompare(b.title));
    const rank = (g) => g.system ? 3 : (g.special ? 2 : (g.key === FLAT ? 0 : 1));
    return [...groups.values()].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
    });
  }
```

- [ ] **Step 4: Exportar.** Na linha `const auto = { ...planReorg };`, acrescente `groupConcepts` e `SYSTEM_GROUP_KEY` ao objeto, ex.:

```js
  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor, dirListing, rootListing, mergeManagedBlock, appendLog, relativePath, rewriteRenameLinks, suggestLinks, applySuggestions, libraryFiles, slugify, folderForType, pathForConcept, typeLabelLookup, canonicalType, moveTargetForType, planReorg, groupConcepts, SYSTEM_GROUP_KEY };
```

- [ ] **Step 5: Rodar e confirmar que passa.**

Run: `node test-grouping.js`
Expected: PASS — imprime `test-grouping OK`.

- [ ] **Step 6: Ligar ao `npm test`.** Em `package.json`, no script `test`, acrescente ` && node test-grouping.js` ao final. Run: `npm test` → todos passam.

- [ ] **Step 7: Commit.**

```bash
git add renderer/okf.js test-grouping.js package.json
git commit -m "feat(sidebar): groupConcepts (Tipo/Tag/Lista) com reservados em Sistema"
```

---

## Task 2: Mover busca/filtro para a sidebar + controle segmentado (HTML)

**Files:** Modify `renderer/index.html`

- [ ] **Step 1: Remover busca e filtro do toolbar.** Em `renderer/index.html`, no bloco `.tools` do `#toolbar`, remova estas duas linhas:

```html
      <input id="search" type="search" placeholder="Buscar por título, id, tag…" disabled />
      <select id="type-filter" disabled><option value="">Todos os tipos</option></select>
```

(Deixe o resto do toolbar intacto, incluindo o `<span class="grow"></span>` anterior.)

- [ ] **Step 2: Reescrever a sidebar.** Substitua o bloco:

```html
    <aside id="sidebar">
      <div id="bundle-name" class="bundle-name">Nenhuma biblioteca aberta</div>
      <div id="tree" class="tree"></div>
    </aside>
```

por:

```html
    <aside id="sidebar">
      <div id="bundle-name" class="bundle-name">Nenhuma biblioteca aberta</div>
      <div id="sidebar-tools">
        <input id="search" type="search" placeholder="Buscar título, tag, texto…" disabled />
        <div class="sb-row">
          <div id="group-seg" class="seg" role="group" aria-label="Agrupar por">
            <button type="button" data-mode="type" class="on" disabled>Tipo</button>
            <button type="button" data-mode="tag" disabled>Tag</button>
            <button type="button" data-mode="flat" disabled>Lista</button>
          </div>
          <select id="type-filter" disabled><option value="">Todos os tipos</option></select>
        </div>
      </div>
      <div id="tree" class="tree"></div>
    </aside>
```

- [ ] **Step 3: Verificar.** Run: `npm test` (HTML não é testado, confirma que nada quebrou). Confirme via `git diff --stat` que só `renderer/index.html` mudou.

- [ ] **Step 4: Commit.**

```bash
git add renderer/index.html
git commit -m "feat(sidebar): move busca/filtro para a sidebar e adiciona controle segmentado"
```

---

## Task 3: Renderer — agrupamento, sanfona, persistência e wiring

**Files:** Modify `renderer/renderer.js`

As funções `parsedOf`, `openDoc`, `openTreeMenu`, `escapeHtml`, `OKF`, e o seletor `$` já existem. NÃO as redefina.

- [ ] **Step 1: Adicionar `collapsed` ao estado.** No objeto `const state = { ... }` (perto da linha 4), acrescente uma propriedade:

```js
  collapsed: new Set(),  // chaves de grupos recolhidos (por biblioteca)
```

- [ ] **Step 2: Helpers de modo e colapso.** Logo ANTES de `function renderTree() {` (perto da linha 371), insira:

```js
/* ---------- Agrupamento e colapso da árvore ---------- */
function currentGroupMode() {
  try { const m = localStorage.getItem('okf-group-mode'); return (m === 'tag' || m === 'flat') ? m : 'type'; }
  catch (e) { return 'type'; }
}
function setGroupMode(mode) { try { localStorage.setItem('okf-group-mode', mode); } catch (e) {} }
function updateGroupModeButtons() {
  const mode = currentGroupMode();
  document.querySelectorAll('#group-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
}
function collapseKey() { return 'okf-collapsed:' + (state.root || ''); }
function loadCollapsedSet() {
  let raw = null;
  try { raw = localStorage.getItem(collapseKey()); } catch (e) {}
  if (raw == null) return new Set([OKF.auto.SYSTEM_GROUP_KEY]); // 1ª vez: Sistema recolhido
  try { const a = JSON.parse(raw); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
}
function saveCollapsed(set) { try { localStorage.setItem(collapseKey(), JSON.stringify([...set])); } catch (e) {} }
function toggleGroup(key) {
  if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
  saveCollapsed(state.collapsed);
  renderTree();
}
```

- [ ] **Step 3: Reescrever `renderTree`.** Substitua a função `renderTree()` inteira (da assinatura até o `}` que a fecha) por:

```js
function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  const q = ($('search').value || '').toLowerCase().trim();
  const typeF = $('type-filter').value;
  const mode = currentGroupMode();

  // 1) filtro (busca + tipo) — mesma semântica de antes
  const filtered = state.docs.filter(d => {
    const p = parsedOf(d);
    const id = OKF.conceptId(d.relPath);
    const title = p.frontmatter.title || d.name.replace(/\.md$/i, '');
    const type = d.reserved ? '' : (p.frontmatter.type || '');
    if (typeF && type !== typeF) return false;
    if (q) {
      const tags = Array.isArray(p.frontmatter.tags) ? p.frontmatter.tags.join(' ') : (p.frontmatter.tags || '');
      const body = (p.body || '').toLowerCase();
      if (!(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) ||
            String(tags).toLowerCase().includes(q) || body.includes(q))) return false;
    }
    return true;
  });

  // 2) agrupar
  const groups = OKF.auto.groupConcepts(filtered, mode);
  if (!groups.some(g => g.items.length)) {
    tree.innerHTML = '<div class="dir">Nenhum resultado</div>';
    return;
  }

  // 3) desenhar
  for (const g of groups) {
    if (!g.items.length) continue;
    const headless = (mode === 'flat' && !g.system); // lista plana não tem cabeçalho
    let collapsed = false;
    if (!headless) {
      collapsed = state.collapsed.has(g.key);
      const head = document.createElement('div');
      head.className = 'group-head' + (collapsed ? ' collapsed' : '');
      head.innerHTML = `<span class="caret">${collapsed ? '▸' : '▾'}</span>` +
        `<span class="g-label"></span><span class="g-count">${g.items.length}</span>`;
      head.querySelector('.g-label').textContent = g.label;
      head.addEventListener('click', () => toggleGroup(g.key));
      tree.appendChild(head);
      if (collapsed) continue;
    }
    for (const it of g.items) {
      const node = document.createElement('div');
      node.className = 'node' + (it.reserved ? ' reserved' : '') + (it.relPath === state.current ? ' active' : '');
      node.dataset.rel = it.relPath;
      const showBadge = it.type && mode !== 'type'; // no modo Tipo o badge é redundante
      node.innerHTML = `<span class="ic">${it.reserved ? '◷' : '📄'}</span><span class="ttl"></span>` +
        (showBadge ? `<span class="badge"></span>` : '');
      node.querySelector('.ttl').textContent = it.title;
      if (showBadge) node.querySelector('.badge').textContent = it.type;
      node.addEventListener('click', () => openDoc(it.relPath));
      if (!it.reserved) node.addEventListener('contextmenu', (e) => { e.preventDefault(); openTreeMenu(e, it.relPath); });
      tree.appendChild(node);
    }
  }
}
```

- [ ] **Step 4: Wiring no `loadBundle`.** Na função `loadBundle` (perto da linha 346), logo após a linha `indexDocs();`, adicione:

```js
  state.collapsed = loadCollapsedSet();
```

E na mesma função, logo após a linha que habilita os controles (`['btn-reload', ... ,'type-filter'].forEach(id => $(id).disabled = false);`), adicione:

```js
  document.querySelectorAll('#group-seg button').forEach(b => b.disabled = false);
  updateGroupModeButtons();
```

- [ ] **Step 5: Wiring no `init`.** Em `init()`, logo após a linha `$('type-filter').addEventListener('change', renderTree);` (perto da linha 1423), adicione:

```js
  document.querySelectorAll('#group-seg button').forEach(b => b.addEventListener('click', () => {
    setGroupMode(b.dataset.mode); updateGroupModeButtons(); renderTree();
  }));
```

- [ ] **Step 6: Verificar.**

Run: `node --check renderer/renderer.js` → sem erro de sintaxe.
Run: `npm test` → tudo passa.

- [ ] **Step 7: Commit.**

```bash
git add renderer/renderer.js
git commit -m "feat(sidebar): renderTree agrupa por modo, sanfona e persistência"
```

---

## Task 4: Estilos da sidebar (CSS)

**Files:** Modify `renderer/styles.css`

- [ ] **Step 1: Acrescentar estilos.** Append ao final de `renderer/styles.css`:

```css
/* ---------- Sidebar: ferramentas (busca, agrupar, filtro) ---------- */
#sidebar-tools { padding: 8px 10px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 7px; }
#sidebar-tools #search { width: 100%; box-sizing: border-box; }
#sidebar-tools .sb-row { display: flex; gap: 6px; align-items: center; }
#sidebar-tools .sb-row #type-filter { flex: 1; min-width: 0; }
.seg { display: inline-flex; background: var(--input-bg); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
.seg button { background: none; border: none; color: var(--muted); font-size: 12px; padding: 5px 10px; cursor: pointer; border-left: 1px solid var(--line); }
.seg button:first-child { border-left: none; }
.seg button:hover { background: var(--hover); color: var(--text); }
.seg button.on { background: var(--active); color: var(--accent); }
.seg button:disabled { opacity: .5; cursor: default; }

/* ---------- Sidebar: cabeçalho de grupo (sanfona) ---------- */
.tree .group-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer;
  color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .03em; user-select: none; }
.tree .group-head:hover { color: var(--text); }
.tree .group-head .caret { font-size: 11px; width: 10px; }
.tree .group-head .g-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree .group-head .g-count { color: var(--muted); font-weight: 400; }
```

- [ ] **Step 2: Verificar.** Run: `npm test` (confirma que nada quebrou). Confirme via `git diff --stat` que só `renderer/styles.css` mudou.

- [ ] **Step 3: Commit.**

```bash
git add renderer/styles.css
git commit -m "feat(sidebar): estilos das ferramentas, segmentado e cabeçalhos de grupo"
```

---

## Task 5: Smoke de DOM (agrupamento + colapso)

**Files:** Modify `test-renderer.js`

- [ ] **Step 1: Adicionar a verificação.** Em `test-renderer.js`, logo após o bloco `g6`/`okGraph` (a linha `console.log('  G6 graph:', JSON.stringify(g6));`), insira:

```js
  // Sidebar: agrupamento por modo e colapso refletem no DOM.
  const sidebar = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\ntags: [x, y]\\n---\\n# A\\n' },
      { relPath: 'processo/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Processo\\ntitle: B\\ntags: [x]\\n---\\n# B\\n' },
      { relPath: 'index.md', name: 'index.md', reserved: true, content: '# Índice' }
    ];
    indexDocs();
    state.collapsed = new Set();
    document.getElementById('type-filter').value = '';
    document.getElementById('search').value = '';
    // modo Tipo: 2 grupos normais (Processo, Projeto) + Sistema
    setGroupMode('type'); renderTree();
    const heads = () => [...document.querySelectorAll('#tree .group-head .g-label')].map(e => e.textContent);
    const typeHeads = heads();
    // modo Tag: grupos x, y, Sistema
    setGroupMode('tag'); renderTree();
    const tagHeads = heads();
    // modo Lista: sem cabeçalhos de grupo normais (só Sistema)
    setGroupMode('flat'); renderTree();
    const flatHeads = heads();
    // colapso: recolher 'type:Projeto' some os itens daquele grupo
    setGroupMode('type'); renderTree();
    const before = document.querySelectorAll('#tree .node').length;
    toggleGroup('type:Projeto');
    const after = document.querySelectorAll('#tree .node').length;
    return { typeHeads, tagHeads, flatHeads, before, after };
  })()`);
  const okSidebar = sidebar &&
    sidebar.typeHeads.includes('Projeto') && sidebar.typeHeads.includes('Processo') && sidebar.typeHeads.includes('Sistema') &&
    sidebar.tagHeads.includes('x') && sidebar.tagHeads.includes('y') &&
    sidebar.flatHeads.length === 1 && sidebar.flatHeads[0] === 'Sistema' &&
    sidebar.after < sidebar.before;
  console.log('  sidebar agrupamento/colapso:', JSON.stringify(sidebar));
```

- [ ] **Step 2: Incluir no agregado.** Em `test-renderer.js`, na linha do `console.log(... ? 'RESULT: PASS' : 'RESULT: FAIL')` e na linha `app.exit(... ? 0 : 1)`, acrescente `&& okSidebar` à condição (em ambas), e adicione antes do console final:

```js
  console.log('  sidebar OK:', okSidebar);
```

- [ ] **Step 3: Rodar.** Run: `npm run test:ui` → deve terminar com `RESULT: PASS` e `okSidebar` verdadeiro.

- [ ] **Step 4: Commit.**

```bash
git add test-renderer.js
git commit -m "test(sidebar): smoke de agrupamento por modo e colapso no DOM"
```

---

## Task 6: Verificação manual

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte completa.** Run: `npm test` → todos passam, incluindo `test-grouping OK`. Run: `npm run test:ui` → `RESULT: PASS`.

- [ ] **Step 2: No app (`npm start`), confirmar:**
1. Busca e filtro de tipo aparecem **no topo da sidebar** (não mais no toolbar).
2. Controle **Tipo | Tag | Lista** troca o agrupamento; o botão ativo fica destacado.
3. Em **Tipo**: grupos por tipo, sem badge nos itens; **"Sistema"** (index.md/log.md) recolhido por padrão.
4. Em **Tag**: um conceito com várias tags aparece em cada tag; itens sem tag em **"Sem tag"**; badge de tipo visível.
5. Em **Lista**: lista única por título (com badge), e "Sistema" ao fim.
6. Clicar no cabeçalho de um grupo recolhe/expande (chevron ▾/▸).
7. O modo escolhido **persiste** ao reabrir o app; o colapso **persiste por biblioteca** (recolher um grupo, reabrir, continua recolhido; abrir outra biblioteca tem seu próprio estado).
8. Busca/filtro sem resultado → "Nenhum resultado"; grupos vazios somem.

- [ ] **Step 3: Commit (se algo foi ajustado).**

```bash
git add -A
git commit -m "fix(sidebar): ajustes da verificação manual"
```

> Se nada precisou de ajuste, não há commit nesta etapa.

---

## Notas de revisão (cobertura do spec)

- **Modos Tipo/Tag/Lista + multi-tag + "Sem tipo"/"Sem tag"** → Task 1 (`groupConcepts`) + Task 3 (render).
- **Reservados em "Sistema" (recolhido por padrão)** → Task 1 (grupo) + Task 3 (`loadCollapsedSet` semeia Sistema).
- **Badge omitido no modo Tipo** → Task 3 (`showBadge`).
- **Busca/filtro movidos para a sidebar** → Task 2 (HTML) + Task 4 (CSS). Listeners preservados (mesmos ids).
- **Controle segmentado** → Task 2 (markup) + Task 3 (wiring) + Task 4 (estilo).
- **Sanfona + persistência por biblioteca; modo global** → Task 3 (`collapseKey`/`okf-group-mode`).
- **Ordenação (especiais por último, Sistema no fim)** → Task 1 (`rank`).
- **"Nenhum resultado" / grupos vazios ocultos** → Task 3.
- **Testes** → Task 1 (unidade) + Task 5 (smoke DOM).
