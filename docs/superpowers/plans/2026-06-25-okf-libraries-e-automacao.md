# Criar bibliotecas OKF + automação de conceitos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir criar bibliotecas OKF novas pelo app e automatizar a manutenção de `index.md`/`log.md`, o renomear/mover com integridade de links e a sugestão de cross-links — tudo determinístico e conforme ao OKF v0.1.

**Architecture:** Abordagem híbrida. Toda a lógica pura mora em `renderer/okf.js` (novo namespace `OKF.auto`), testável em Node. A gravação passa por um IPC transacional único (`fs:applyOps`) em `main.js`, que pausa o watcher, aplica um lote de operações e dispara um único `bundle:changed`. O renderer orquestra cada ação (criar/editar/excluir/renomear/reconstruir) montando o lote de ops a partir de `state.docs` + `OKF.auto`.

**Tech Stack:** Electron, JavaScript puro (sem framework), `js-yaml`, `marked`, Milkdown (editor visual), chokidar (watcher). Testes: scripts Node (`node test-*.js`).

**Spec:** `docs/superpowers/specs/2026-06-25-okf-libraries-e-automacao-design.md`

---

## Estrutura de arquivos

- `renderer/okf.js` — **MODIFICAR**: adicionar o objeto `OKF.auto` com funções puras (listagens, bloco gerenciado, log, rename, cross-links, arquivos de scaffolding). É o coração testável.
- `test-auto.js` — **CRIAR**: runner de testes Node para `OKF.auto` (assert que sai com código ≠0 em falha).
- `watcher.js` — **MODIFICAR**: `pause()`/`resume()`.
- `main.js` — **MODIFICAR**: handlers `fs:applyOps`, `library:create`, `dialog:newLibrary`; item de menu "Nova biblioteca…"; menu "Reconstruir índices".
- `preload.js` — **MODIFICAR**: expor `applyOps`, `createLibrary`, `newLibraryDialog`; novos canais de menu.
- `tools/okf-template/CLAUDE.md` — **CRIAR**: template enxuto das regras OKF (com frontmatter conforme).
- `package.json` — **MODIFICAR**: `extraResources` do template; script `test:auto`.
- `renderer/renderer.js` — **MODIFICAR**: orquestração de ops, dropdown de categoria/tags no modal, ações excluir/renomear/mover, menu de contexto da árvore, painel de cross-links, "Reconstruir índices", "Nova biblioteca…", preferência.
- `renderer/index.html` — **MODIFICAR**: campos novos no modal de criar, modal de renomear/mover, modal de nova biblioteca, painel de cross-links, menu de contexto.
- `renderer/styles.css` — **MODIFICAR**: estilos dos elementos novos.
- `test-renderer.js` — **MODIFICAR**: smoke do fluxo de criar conceito atualizando índices/log.

---

## Convenções fixadas (usar exatamente estes nomes/assinaturas)

`OKF.auto` expõe:

- `MARK_START` = `'<!-- okf:index -->'`, `MARK_END` = `'<!-- /okf:index -->'`
- `titleOf(doc)` → `frontmatter.title` ou nome do arquivo sem `.md`
- `descOf(doc)` → `frontmatter.description` ou `''`
- `headingFor(seg)` → segmento com 1ª letra maiúscula
- `bulletFor(doc)` → `'* [title](/relPath)'` + (desc ? `' - '+desc` : `''`)
- `dirListing(docs, dir)` → bullets dos conceitos diretamente em `dir`, ordenados por título
- `rootListing(docs)` → conceitos da raiz + seções `## Categoria` por subpasta de topo
- `mergeManagedBlock(content, listing)` → conteúdo com o bloco entre marcadores (insere no fim se não houver)
- `appendLog(content, dateStr, entry)` → bullet sob `## dateStr` (cria seção no topo se faltar)
- `relativePath(fromDir, toRel)` → caminho relativo de um arquivo em `fromDir` até `toRel`
- `rewriteRenameLinks(docs, fromRel, toRel)` → `[{relPath, newContent}]` dos docs alterados (exclui `index.md`; inclui `log.md` e o próprio arquivo movido)
- `suggestLinks(body, concepts, selfId)` → `[{text, start, end, targetRel}]`
- `applySuggestions(body, suggestions)` → corpo com os links aplicados
- `libraryFiles(name, dateStr)` → `[{relPath, content}]` (index.md raiz + log.md)

Operações do `fs:applyOps`: `{op:'create'|'write'|'delete', relPath, content?}`.

---

## Fase A — Núcleo puro `OKF.auto` (TDD em Node)

### Task 1: Harness de teste + helpers básicos (`titleOf`, `descOf`, `headingFor`, `bulletFor`)

**Files:**
- Create: `test-auto.js`
- Modify: `renderer/okf.js` (adicionar `OKF.auto`)
- Modify: `package.json` (script `test:auto`)

- [ ] **Step 1: Criar o runner `test-auto.js` com os primeiros testes (vai falhar)**

```js
// test-auto.js — testes do núcleo OKF.auto (puro, sem DOM)
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const A = OKF.auto;

let n = 0, fail = 0;
function eq(got, exp, msg) {
  n++;
  const G = JSON.stringify(got), E = JSON.stringify(exp);
  if (G !== E) { fail++; console.error('FAIL:', msg, '\n   got: ' + G + '\n   exp: ' + E); }
}
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }

// doc fake: relPath + content
function doc(relPath, fm, body) {
  return { relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '') };
}

// ---- Task 1: helpers básicos ----
eq(A.headingFor('projetos'), 'Projetos', 'headingFor capitaliza');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas' })), 'Projeto Atlas', 'titleOf usa frontmatter');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto' })), 'atlas', 'titleOf cai para nome do arquivo');
eq(A.descOf(doc('x.md', { type: 'X', description: 'Desc.' })), 'Desc.', 'descOf usa frontmatter');
eq(A.bulletFor(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas', description: 'Migração.' })),
   '* [Projeto Atlas](/projetos/atlas.md) - Migração.', 'bulletFor com descrição');
eq(A.bulletFor(doc('a.md', { type: 'X', title: 'A' })), '* [A](/a.md)', 'bulletFor sem descrição');

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('AUTO OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'headingFor')` (porque `OKF.auto` ainda não existe).

- [ ] **Step 3: Adicionar `OKF.auto` com os helpers básicos em `renderer/okf.js`**

Logo antes de `global.OKF = {` (linha ~163), inserir:

```js
  // ---- Automação determinística (índices, log, rename, cross-links) ----
  const MARK_START = '<!-- okf:index -->';
  const MARK_END = '<!-- /okf:index -->';

  function baseName(relPath) { return relPath.split('/').pop().replace(/\.md$/i, ''); }
  function dirOf(relPath) { return relPath.includes('/') ? relPath.replace(/\/[^/]*$/, '') : ''; }
  function headingFor(seg) { return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg; }

  function titleOf(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.title) ? String(f.title) : baseName(doc.relPath);
  }
  function descOf(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.description) ? String(f.description) : '';
  }
  function bulletFor(doc) {
    const desc = descOf(doc);
    return '* [' + titleOf(doc) + '](/' + doc.relPath + ')' + (desc ? ' - ' + desc : '');
  }

  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor };
```

E acrescentar `auto` ao export. Trocar:

```js
  global.OKF = {
    RESERVED, isReserved, conceptId, parse, serialize,
    extractLinks, resolveTarget, isExternal, buildGraph, validate
  };
```

por:

```js
  global.OKF = {
    RESERVED, isReserved, conceptId, parse, serialize,
    extractLinks, resolveTarget, isExternal, buildGraph, validate, auto
  };
```

- [ ] **Step 4: Adicionar script `test:auto` em `package.json`**

Em `"scripts"`, após `"test:git": "node test-git.js",` adicionar:

```json
    "test:auto": "node test-auto.js",
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS — termina com `AUTO OK`.

- [ ] **Step 6: Commit**

```bash
git add renderer/okf.js test-auto.js package.json
git commit -m "feat(okf): OKF.auto com helpers básicos (titleOf/descOf/bulletFor) + harness de teste"
```

---

### Task 2: Listagens `dirListing` e `rootListing`

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar os testes (vão falhar)**

Antes da linha `console.log(\`\n${n} checagens` em `test-auto.js`, inserir:

```js
// ---- Task 2: listagens ----
const docsT2 = [
  doc('processos/a.md', { type: 'Processo', title: 'Beta', description: 'B.' }),
  doc('processos/b.md', { type: 'Processo', title: 'Alfa', description: 'A.' }),
  doc('processos/index.md', {}, '# Processos'),
  doc('raiz.md', { type: 'Nota', title: 'Raiz', description: 'R.' }),
];
eq(A.dirListing(docsT2, 'processos'),
   '* [Alfa](/processos/b.md) - A.\n* [Beta](/processos/a.md) - B.',
   'dirListing ordena por título e ignora index.md');
ok(A.rootListing(docsT2).includes('## Processos'), 'rootListing tem seção da categoria');
ok(A.rootListing(docsT2).indexOf('* [Raiz](/raiz.md) - R.') < A.rootListing(docsT2).indexOf('## Processos'),
   'rootListing lista conceitos da raiz antes das categorias');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.dirListing is not a function`.

- [ ] **Step 3: Implementar em `renderer/okf.js`**

Após `function bulletFor(doc) {...}` (antes de `const auto = {`), inserir:

```js
  function sortedBullets(docs) {
    return docs.map(d => ({ d, t: titleOf(d) }))
      .sort((a, b) => a.t.localeCompare(b.t))
      .map(x => bulletFor(x.d));
  }
  function dirListing(docs, dir) {
    const pre = dir ? dir + '/' : '';
    const items = docs.filter(d => !isReserved(d.relPath) &&
      d.relPath.startsWith(pre) && d.relPath.slice(pre.length).indexOf('/') < 0);
    return sortedBullets(items).join('\n');
  }
  function rootListing(docs) {
    const concepts = docs.filter(d => !isReserved(d.relPath));
    const rootItems = concepts.filter(d => d.relPath.indexOf('/') < 0);
    const byTop = new Map();
    for (const d of concepts) {
      const i = d.relPath.indexOf('/');
      if (i < 0) continue;
      const top = d.relPath.slice(0, i);
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top).push(d);
    }
    const parts = [];
    if (rootItems.length) parts.push(sortedBullets(rootItems).join('\n'));
    for (const top of [...byTop.keys()].sort()) {
      parts.push('## ' + headingFor(top) + '\n' + sortedBullets(byTop.get(top)).join('\n'));
    }
    return parts.join('\n\n');
  }
```

Adicionar ao objeto `auto`:

```js
  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor, dirListing, rootListing };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS — `AUTO OK`.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): dirListing e rootListing (listagens ordenadas, bundle-relativas)"
```

---

### Task 3: `mergeManagedBlock`

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar testes (vão falhar)**

```js
// ---- Task 3: bloco gerenciado ----
const semMarcadores = '# Projetos\n\nTexto humano.\n';
const merged1 = A.mergeManagedBlock(semMarcadores, '* [X](/projetos/x.md)');
ok(merged1.startsWith('# Projetos\n\nTexto humano.\n'), 'preserva conteúdo existente');
ok(merged1.includes(A.MARK_START + '\n* [X](/projetos/x.md)\n' + A.MARK_END), 'insere bloco com listing');

const comMarcadores = 'topo\n' + A.MARK_START + '\nantigo\n' + A.MARK_END + '\nrodapé\n';
const merged2 = A.mergeManagedBlock(comMarcadores, '* [Y](/y.md)');
ok(merged2.includes('topo\n') && merged2.includes('rodapé\n'), 'preserva fora do bloco');
ok(merged2.includes(A.MARK_START + '\n* [Y](/y.md)\n' + A.MARK_END), 'substitui só o miolo');
ok(!merged2.includes('antigo'), 'remove conteúdo antigo do bloco');

const vazio = A.mergeManagedBlock(comMarcadores, '');
ok(vazio.includes(A.MARK_START + '\n' + A.MARK_END), 'listing vazio = bloco vazio');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.mergeManagedBlock is not a function`.

- [ ] **Step 3: Implementar**

Após `rootListing`, inserir:

```js
  function mergeManagedBlock(content, listing) {
    const inner = '\n' + (listing ? listing + '\n' : '');
    const s = content.indexOf(MARK_START);
    const e = content.indexOf(MARK_END);
    if (s >= 0 && e > s) {
      return content.slice(0, s + MARK_START.length) + inner + content.slice(e);
    }
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    return content + sep + MARK_START + inner + MARK_END + '\n';
  }
```

Adicionar `mergeManagedBlock` ao objeto `auto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): mergeManagedBlock — preserva prosa, reescreve só o bloco gerenciado"
```

---

### Task 4: `appendLog`

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar testes (vão falhar)**

```js
// ---- Task 4: log ----
const log0 = '# Histórico de Atualizações\n';
const log1 = A.appendLog(log0, '2026-06-25', '**Criação**: [X](/x.md).');
ok(log1.includes('## 2026-06-25\n* **Criação**: [X](/x.md).'), 'cria seção do dia');
ok(log1.indexOf('# Histórico') < log1.indexOf('## 2026-06-25'), 'título permanece no topo');

const log2 = A.appendLog(log1, '2026-06-25', '**Exclusão**: removido `y.md`.');
ok(log2.match(/## 2026-06-25/g).length === 1, 'não duplica a seção do dia');
ok(log2.indexOf('Criação') < log2.indexOf('Exclusão'), 'apenda bullet ao dia existente');

const log3 = A.appendLog(log1, '2026-06-26', '**Criação**: [Z](/z.md).');
ok(log3.indexOf('## 2026-06-26') < log3.indexOf('## 2026-06-25'), 'dia novo entra no topo (mais recente primeiro)');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.appendLog is not a function`.

- [ ] **Step 3: Implementar**

Após `mergeManagedBlock`, inserir:

```js
  function appendLog(content, dateStr, entry) {
    const bullet = '* ' + entry;
    const dateHdr = '## ' + dateStr;
    const lines = (content || '').split('\n');
    const idx = lines.findIndex(l => l.trim() === dateHdr);
    if (idx >= 0) {
      let end = lines.length;
      for (let i = idx + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break; } }
      let ins = end;
      while (ins > idx + 1 && lines[ins - 1].trim() === '') ins--;
      lines.splice(ins, 0, bullet);
      return lines.join('\n');
    }
    const titleIdx = lines.findIndex(l => /^#\s/.test(l));
    const block = [dateHdr, bullet];
    if (titleIdx >= 0) {
      let ins = titleIdx + 1;
      if (lines[ins] !== undefined && lines[ins].trim() === '') ins++;
      lines.splice(ins, 0, '', ...block);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n');
    }
    return (block.join('\n') + '\n\n' + (content || '')).replace(/\n{3,}/g, '\n\n');
  }
```

Adicionar `appendLog` ao objeto `auto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): appendLog — entradas estruturais por dia, mais recente no topo"
```

---

### Task 5: `relativePath` + `rewriteRenameLinks`

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar testes (vão falhar)**

```js
// ---- Task 5: relativePath + rename ----
eq(A.relativePath('', 'projetos/x.md'), 'projetos/x.md', 'relativePath da raiz');
eq(A.relativePath('projetos', 'processos/x.md'), '../processos/x.md', 'relativePath entre pastas');
eq(A.relativePath('projetos', 'projetos/y.md'), 'y.md', 'relativePath mesma pasta');

const docsT5 = [
  doc('projetos/atlas.md', { type: 'Projeto', title: 'Atlas' },
      'Ver [abs](/processos/inc.md) e [rel](../processos/inc.md) e [anc](/processos/inc.md#sec).'),
  doc('processos/inc.md', { type: 'Processo', title: 'Inc' },
      'Liga em [atlas](/projetos/atlas.md).'),
  doc('log.md', {}, '# Histórico\n\n## 2026-06-24\n* **Criação**: [inc](/processos/inc.md).'),
];
const changes = A.rewriteRenameLinks(docsT5, 'processos/inc.md', 'ops/incidente.md');

const atlas = changes.find(c => c.relPath === 'projetos/atlas.md');
ok(atlas && atlas.newContent.includes('[abs](/ops/incidente.md)'), 'reescreve link absoluto');
ok(atlas && atlas.newContent.includes('[rel](../ops/incidente.md)'), 'reescreve link relativo preservando estilo');
ok(atlas && atlas.newContent.includes('[anc](/ops/incidente.md#sec)'), 'preserva âncora');

const moved = changes.find(c => c.relPath === 'processos/inc.md');
ok(!moved || moved.newContent.includes('[atlas](/projetos/atlas.md)'), 'link absoluto de saída do arquivo movido permanece');

const logc = changes.find(c => c.relPath === 'log.md');
ok(logc && logc.newContent.includes('[inc](/ops/incidente.md)'), 'reescreve links no log.md');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.relativePath is not a function`.

- [ ] **Step 3: Implementar**

Após `appendLog`, inserir:

```js
  function relativePath(fromDir, toRel) {
    const from = fromDir ? fromDir.split('/') : [];
    const to = toRel.split('/');
    const toFile = to.pop();
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const segs = from.slice(i).map(() => '..').concat(to.slice(i), [toFile]);
    return segs.join('/') || toFile;
  }

  const RENAME_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  function splitAnchor(t) { const i = t.indexOf('#'); return i >= 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, '']; }

  function rewriteRenameLinks(docs, fromRel, toRel) {
    const fromId = conceptId(fromRel);
    const out = [];
    for (const d of docs) {
      if (d.relPath.split('/').pop().toLowerCase() === 'index.md') continue; // index é reconstruído à parte
      const p = parse(d.content);
      let changed = false;
      const body = p.body.replace(RENAME_LINK_RE, (full, text, target) => {
        if (isExternal(target) || target.startsWith('#')) return full;
        const [path0, anchor] = splitAnchor(target);
        if (d.relPath === fromRel) {
          // arquivo movido: recalcula seus próprios links relativos (a base mudou)
          if (target.startsWith('/')) return full;
          const id = resolveTarget(path0, fromRel);
          if (!id) return full;
          const nt = relativePath(dirOf(toRel), id + '.md') + (anchor ? '#' + anchor : '');
          if (nt !== target) changed = true;
          return '[' + text + '](' + nt + ')';
        }
        const id = resolveTarget(path0, d.relPath);
        if (id !== fromId) return full;
        let nt = target.startsWith('/') ? '/' + toRel : relativePath(dirOf(d.relPath), toRel);
        nt += anchor ? '#' + anchor : '';
        changed = true;
        return '[' + text + '](' + nt + ')';
      });
      if (changed) out.push({ relPath: d.relPath, newContent: serialize(p.frontmatter, body) });
    }
    return out;
  }
```

Adicionar `relativePath` e `rewriteRenameLinks` ao objeto `auto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): rewriteRenameLinks — reescrita de links no rename preservando estilo e âncoras"
```

---

### Task 6: `suggestLinks` + `applySuggestions`

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar testes (vão falhar)**

```js
// ---- Task 6: cross-links ----
const conceptsT6 = [
  { relPath: 'projetos/atlas.md', title: 'Projeto Atlas' },
  { relPath: 'processos/inc.md', title: 'Atlas' },
];
const body6 = 'Falamos do Projeto Atlas hoje. De novo Projeto Atlas. Em `Projeto Atlas` não. ' +
              'Já linkado [Projeto Atlas](/projetos/atlas.md).';
const sug = A.suggestLinks(body6, conceptsT6, 'outros/doc');
eq(sug.filter(s => s.targetRel === '/projetos/atlas.md').length, 1, 'só a 1ª ocorrência por alvo');
ok(sug[0].text === 'Projeto Atlas' && sug[0].targetRel === '/projetos/atlas.md', 'casa o título mais longo');
ok(body6.slice(sug[0].start, sug[0].end) === 'Projeto Atlas', 'índices apontam para o trecho');

const sugSelf = A.suggestLinks('Eu sou o Projeto Atlas.', conceptsT6, 'projetos/atlas');
eq(sugSelf.length, 0, 'não sugere autolink');

const applied = A.applySuggestions('Veja Projeto Atlas aqui.',
  [{ text: 'Projeto Atlas', start: 5, end: 18, targetRel: '/projetos/atlas.md' }]);
eq(applied, 'Veja [Projeto Atlas](/projetos/atlas.md) aqui.', 'applySuggestions insere o link');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.suggestLinks is not a function`.

- [ ] **Step 3: Implementar**

Após `rewriteRenameLinks`, inserir:

```js
  function protectedRanges(body) {
    const ranges = [];
    const add = (re) => { let m; while ((m = re.exec(body)) !== null) ranges.push([m.index, m.index + m[0].length]); };
    add(/```[\s\S]*?```/g);          // blocos de código
    add(/`[^`]*`/g);                 // código inline
    add(/\[[^\]]*\]\([^)]*\)/g);     // links existentes
    add(/\bhttps?:\/\/\S+/g);        // URLs
    return ranges;
  }
  function inRanges(start, end, ranges) {
    return ranges.some(([a, b]) => start < b && end > a);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function suggestLinks(body, concepts, selfId) {
    const ranges = protectedRanges(body);
    // títulos mais longos primeiro (mais específicos)
    const cand = concepts
      .filter(c => conceptId(c.relPath) !== selfId && c.title && c.title.trim())
      .map(c => ({ rel: c.relPath, title: String(c.title) }))
      .sort((a, b) => b.title.length - a.title.length);
    const out = [];
    const taken = []; // ranges já sugeridos (evita sobreposição)
    const seen = new Set();
    for (const c of cand) {
      if (seen.has(c.rel)) continue;
      const re = new RegExp('(^|[^\\p{L}\\p{N}_])(' + escapeRe(c.title) + ')(?![\\p{L}\\p{N}_])', 'giu');
      let m;
      while ((m = re.exec(body)) !== null) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (inRanges(start, end, ranges) || inRanges(start, end, taken)) continue;
        out.push({ text: m[2], start, end, targetRel: '/' + c.rel });
        taken.push([start, end]);
        seen.add(c.rel);
        break; // só a 1ª ocorrência por alvo
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function applySuggestions(body, suggestions) {
    const sorted = [...suggestions].sort((a, b) => b.start - a.start); // da direita p/ esquerda
    let out = body;
    for (const s of sorted) {
      out = out.slice(0, s.start) + '[' + s.text + '](' + s.targetRel + ')' + out.slice(s.end);
    }
    return out;
  }
```

Adicionar `suggestLinks` e `applySuggestions` ao objeto `auto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): suggestLinks/applySuggestions — cross-links determinísticos, 1ª ocorrência, anti-ruído"
```

---

### Task 7: `libraryFiles` + conformidade do scaffolding

**Files:**
- Modify: `renderer/okf.js`
- Modify: `test-auto.js`

- [ ] **Step 1: Adicionar testes (vão falhar)**

```js
// ---- Task 7: scaffolding ----
const libFiles = A.libraryFiles('Minha Base', '2026-06-25');
const idx = libFiles.find(f => f.relPath === 'index.md');
const logf = libFiles.find(f => f.relPath === 'log.md');
ok(idx && idx.content.includes('okf_version'), 'index raiz tem okf_version');
ok(idx && idx.content.includes('# Minha Base'), 'index raiz tem o nome como título');
ok(idx && idx.content.includes(A.MARK_START) && idx.content.includes(A.MARK_END), 'index raiz tem bloco gerenciado');
ok(logf && logf.content.includes('## 2026-06-25'), 'log tem a data de criação');

// conformidade: index.md/log.md são reservados; uma biblioteca só com eles + um conceito válido valida 0 erros
const libDocs = libFiles.map(f => ({ relPath: f.relPath, name: f.relPath.split('/').pop(),
  reserved: OKF.isReserved(f.relPath), content: f.content }));
libDocs.push({ relPath: 'CLAUDE.md', name: 'CLAUDE.md', reserved: false,
  content: OKF.serialize({ type: 'Referência', title: 'Regras do formato OKF' }, '# Regras\n') });
eq(OKF.validate(libDocs).counts.errors, 0, 'scaffolding (com CLAUDE.md frontmatado) valida sem erros');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-auto.js`
Expected: FAIL — `A.libraryFiles is not a function`.

- [ ] **Step 3: Implementar**

Após `applySuggestions`, inserir:

```js
  function libraryFiles(name, dateStr) {
    const safeName = (name && name.trim()) ? name.trim() : 'Biblioteca';
    const indexBody = '# ' + safeName + '\n\n' +
      'Biblioteca de conhecimento no formato Open Knowledge Format (OKF v0.1).\n' +
      'Cada arquivo `.md` é um *conceito*. Use os links para navegar pelo grafo.\n\n' +
      MARK_START + '\n' + MARK_END + '\n';
    const index = serialize({ okf_version: '0.1' }, indexBody);
    const log = '# Histórico de Atualizações\n\n## ' + dateStr + '\n' +
      '* **Criação**: estrutura inicial da biblioteca com [índice raiz](/index.md).\n';
    return [
      { relPath: 'index.md', content: index },
      { relPath: 'log.md', content: log },
    ];
  }
```

Adicionar `libraryFiles` ao objeto `auto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS.

- [ ] **Step 5: Verificar regressão do núcleo existente**

Run: `node test-okf.js`
Expected: PASS — termina com `TESTE OK` (não quebramos nada do core).

- [ ] **Step 6: Commit**

```bash
git add renderer/okf.js test-auto.js
git commit -m "feat(okf): libraryFiles — scaffolding mínimo conforme OKF (index.md + log.md)"
```

---

## Fase B — Processo principal (IPC transacional, scaffolding, watcher)

### Task 8: Pausa/retomada do watcher

**Files:**
- Modify: `watcher.js`
- Test: `test-watcher.js` (verificação manual via execução)

- [ ] **Step 1: Implementar `pause()`/`resume()` em `watcher.js`**

Substituir o corpo de `createWatcher` para incluir o sinalizador `paused`:

```js
function createWatcher(onChange) {
  let w = null;
  let timer = null;
  let paused = false;
  const fire = () => { if (paused) return; clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const ignored = (p) =>
    /[\\/](\.git|node_modules|dist|\.superpowers)([\\/]|$)/.test(p) ||
    /[\\/]\.[^\\/]+$/.test(p);

  return {
    watch(root) {
      this.close();
      if (!root) return;
      w = chokidar.watch(root, { ignored, ignoreInitial: true });
      w.on('add', fire).on('change', fire).on('unlink', fire);
    },
    pause() { paused = true; clearTimeout(timer); },
    resume() { paused = false; },
    close() {
      if (w) { w.close(); w = null; }
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 2: Verificar que o watcher ainda carrega**

Run: `node test-watcher.js`
Expected: o script roda sem erro (mesmo comportamento de antes; `pause`/`resume` são aditivos).

- [ ] **Step 3: Commit**

```bash
git add watcher.js
git commit -m "feat(watcher): pause()/resume() para silenciar eventos durante gravações do app"
```

---

### Task 9: IPC transacional `fs:applyOps`

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Adicionar o handler em `main.js`**

Após o handler `ipcMain.handle('file:delete', ...)` (linha ~271), inserir:

```js
ipcMain.handle('fs:applyOps', async (_e, { root, ops }) => {
  libWatcher.pause();
  let applied = 0;
  try {
    for (const op of (ops || [])) {
      if (op.op === 'create' || op.op === 'write') {
        const target = safeJoin(root, op.relPath);
        if (op.op === 'create' && fs.existsSync(target)) throw new Error('Já existe um arquivo em ' + op.relPath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, op.content, 'utf8');
      } else if (op.op === 'delete') {
        await fsp.rm(safeJoin(root, op.relPath), { force: true });
      } else {
        throw new Error('Operação desconhecida: ' + op.op);
      }
      applied++;
    }
    return { ok: true, applied };
  } catch (e) {
    return { ok: false, applied, error: String((e && e.message) || e) };
  } finally {
    libWatcher.resume();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bundle:changed');
  }
});
```

- [ ] **Step 2: Expor `applyOps` em `preload.js`**

Após a linha `deleteFile: (payload) => ipcRenderer.invoke('file:delete', payload),`, inserir:

```js
  applyOps: (payload) => ipcRenderer.invoke('fs:applyOps', payload),
```

- [ ] **Step 3: Verificar que o app inicia sem erro**

Run: `npm start`
Expected: a janela abre normalmente; nenhum erro no console do processo principal. Feche o app.

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat(ipc): fs:applyOps transacional (watcher pausado, 1 bundle:changed)"
```

---

### Task 10: Template `CLAUDE.md` enxuto + `library:create` + diálogo + menu

**Files:**
- Create: `tools/okf-template/CLAUDE.md`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `package.json`

- [ ] **Step 1: Criar o template enxuto `tools/okf-template/CLAUDE.md`**

```markdown
---
type: Referência
title: Regras do formato OKF
description: Instruções de manutenção desta biblioteca no Open Knowledge Format (OKF v0.1).
---

# Regras do formato OKF (v0.1)

- Cada arquivo `.md` (exceto `index.md` e `log.md`) é um **conceito**.
- Todo conceito começa com frontmatter YAML. **Obrigatório:** `type`.
  Recomendados: `title`, `description`, `resource`, `tags`, `timestamp`.
- Use links Markdown **bundle-relativos** (começando com `/`):
  `[orders](/tables/orders.md)`.
- Mantenha um `index.md` em cada diretório (lista os itens com 1 linha de
  descrição) e um `log.md` na raiz (histórico, mais recente no topo).
- Uma biblioteca é **conforme** se todo `.md` não reservado tiver frontmatter
  YAML válido com `type` não vazio.
```

- [ ] **Step 2: Adicionar os handlers em `main.js`**

Após o handler `fs:applyOps`, inserir:

```js
function claudeTemplatePath() {
  const packaged = path.join(process.resourcesPath || '', 'okf-template', 'CLAUDE.md');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'tools', 'okf-template', 'CLAUDE.md');
}

ipcMain.handle('dialog:newLibrary', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha (ou crie) a pasta da nova biblioteca OKF',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('library:create', async (_e, { dir, files }) => {
  try {
    const conflicts = ['index.md', 'log.md', 'CLAUDE.md'].filter(f => fs.existsSync(path.join(dir, f)));
    if (conflicts.length) return { ok: false, error: 'A pasta já contém: ' + conflicts.join(', ') };
    for (const f of (files || [])) {
      const target = safeJoin(dir, f.relPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, f.content, 'utf8');
    }
    await fsp.copyFile(claudeTemplatePath(), path.join(dir, 'CLAUDE.md'));
    return { ok: true, root: dir };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
```

- [ ] **Step 3: Adicionar o item de menu "Nova biblioteca…" em `main.js`**

No `buildMenu`, no submenu `Arquivo`, após o item "Abrir biblioteca de exemplo" (antes do `{ type: 'separator' }`), inserir:

```js
        {
          label: 'Nova biblioteca…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow.webContents.send('menu:new-library')
        },
```

- [ ] **Step 4: Expor no `preload.js`**

Após `applyOps: ...`, inserir:

```js
  newLibraryDialog: () => ipcRenderer.invoke('dialog:newLibrary'),
  createLibrary: (payload) => ipcRenderer.invoke('library:create', payload),
```

E no array `valid` de `onMenu`, adicionar `'menu:new-library'` e `'menu:rebuild-indexes'`:

```js
    const valid = [
      'menu:open-folder', 'menu:open-sample', 'menu:new-concept', 'menu:new-library',
      'menu:save', 'menu:reload', 'menu:validate', 'menu:graph', 'menu:about', 'menu:manual',
      'menu:rebuild-indexes'
    ];
```

- [ ] **Step 5: Adicionar "Reconstruir índices" ao menu Exibir em `main.js`**

No submenu `Exibir`, após o item "Validar conformidade OKF", inserir:

```js
        { label: 'Reconstruir índices', click: () => mainWindow.webContents.send('menu:rebuild-indexes') },
```

- [ ] **Step 6: Empacotar o template em `package.json`**

Em `build`, localizar `extraResources` e adicionar a entrada do template. Se `extraResources` já tem a `sample-library`, acrescentar (sem remover o que existe):

```json
      {
        "from": "tools/okf-template",
        "to": "okf-template"
      }
```

(Confirme que fica como item adicional do array `extraResources`, junto da entrada já existente da `sample-library`.)

- [ ] **Step 7: Verificar inicialização e o diálogo**

Run: `npm start`
Expected: app abre; o menu **Arquivo ▸ Nova biblioteca…** existe e **Exibir ▸ Reconstruir índices** existe (ainda sem ação no renderer — será ligado na Fase C). Feche o app.

- [ ] **Step 8: Commit**

```bash
git add tools/okf-template/CLAUDE.md main.js preload.js package.json
git commit -m "feat(main): library:create + template CLAUDE.md enxuto + menus Nova biblioteca/Reconstruir índices"
```

---

## Fase C — Renderer (orquestração + UI)

### Task 11: Orquestração de ops + preferência (helpers de renderer)

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Adicionar os helpers de orquestração**

Em `renderer/renderer.js`, logo após o bloco `window.__okfTemplates = ...` (linha ~25), inserir:

```js
/* ---------- Automação: preferência + montagem de ops ---------- */
function autoIndexEnabled() {
  try { return localStorage.getItem('okf-auto-index') !== 'off'; } catch (e) { return true; }
}
function setAutoIndex(on) {
  try { localStorage.setItem('okf-auto-index', on ? 'on' : 'off'); } catch (e) {}
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function baseNameOf(rel) { return rel.split('/').pop(); }
function docByRel(rel) { return state.docs.find(d => d.relPath === rel); }

// Todos os diretórios que devem ter index.md: raiz ('') + cada ancestral com conceito.
function indexDirs(docs) {
  const dirs = new Set(['']);
  for (const d of docs) {
    if (OKF.isReserved(d.relPath)) continue;
    if (!d.relPath.includes('/')) continue;
    const parts = d.relPath.split('/'); parts.pop();
    let acc = '';
    for (const p of parts) { acc = acc ? acc + '/' + p : p; dirs.add(acc); }
  }
  return [...dirs];
}

function indexContentFor(docs, dir) {
  const rel = dir ? dir + '/index.md' : 'index.md';
  const existing = docs.find(d => d.relPath === rel) || docByRel(rel);
  const listing = dir === '' ? OKF.auto.rootListing(docs) : OKF.auto.dirListing(docs, dir);
  let base;
  if (existing) {
    base = existing.content;
  } else if (dir === '') {
    base = OKF.serialize({ okf_version: '0.1' },
      '# ' + (state.name || 'Biblioteca') + '\n\nÍndice da biblioteca.\n\n' +
      OKF.auto.MARK_START + '\n' + OKF.auto.MARK_END + '\n');
  } else {
    base = '# ' + OKF.auto.headingFor(dir.split('/').pop()) + '\n\n' +
      OKF.auto.MARK_START + '\n' + OKF.auto.MARK_END + '\n';
  }
  return OKF.auto.mergeManagedBlock(base, listing);
}

// Ops para (re)escrever todos os index.md a partir de um conjunto de docs.
function indexOpsFrom(docs) {
  const ops = [];
  for (const dir of indexDirs(docs)) {
    const rel = dir ? dir + '/index.md' : 'index.md';
    const content = indexContentFor(docs, dir);
    const existing = docs.find(d => d.relPath === rel);
    if (!existing) ops.push({ op: 'create', relPath: rel, content });
    else if (existing.content !== content) ops.push({ op: 'write', relPath: rel, content });
  }
  return ops;
}

// Op para o log.md, a partir de um conjunto de docs (usa o conteúdo já presente).
function logOpFrom(docs, entry) {
  const existing = docs.find(d => d.relPath === 'log.md');
  const base = existing ? existing.content : '# Histórico de Atualizações\n';
  const content = OKF.auto.appendLog(base, todayStr(), entry);
  return existing ? { op: 'write', relPath: 'log.md', content } : { op: 'create', relPath: 'log.md', content };
}

// Aplica um lote e recarrega o estado do disco; seleciona selectRel se informado.
async function applyOpsAndRefresh(ops, selectRel) {
  const r = await window.okf.applyOps({ root: state.root, ops });
  if (!r || !r.ok) {
    toast('Erro ao gravar: ' + ((r && r.error) || 'desconhecido'), 'bad');
    await refreshFromDisk(null);
    return false;
  }
  await refreshFromDisk(selectRel);
  return true;
}

async function refreshFromDisk(selectRel) {
  const res = await window.okf.readBundle(state.root);
  state.docs = res.docs || [];
  indexDocs(); buildTypeFilter(); renderTree();
  $('bundle-name').textContent = state.name + '  ·  ' + state.docs.length + ' arquivos';
  const want = selectRel || state.current;
  if (want && state.docs.some(d => d.relPath === want)) openDoc(want);
  else if (state.docs.length) { const f = state.docs.find(d => !d.reserved) || state.docs[0]; openDoc(f.relPath); }
  else showEmpty();
}
```

- [ ] **Step 2: Verificar sintaxe carregando o app**

Run: `npm start`
Expected: app abre sem erro de console no renderer (DevTools ▸ Console limpo). Feche o app.

- [ ] **Step 3: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(renderer): helpers de orquestração de ops (índices/log) + preferência auto-index"
```

---

### Task 12: Criar conceito com categoria/tags + atualização de índices/log

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Adicionar campos de categoria e tags ao modal em `renderer/index.html`**

No `#modal`, substituir o bloco do campo "Caminho" + "type" por (mantendo os IDs existentes e adicionando os novos):

```html
      <label>Categoria
        <select id="m-category"></select>
      </label>
      <label>Caminho dentro da biblioteca (ex.: <code>projetos/novo.md</code>)
        <input id="m-path" type="text" placeholder="categoria/nome.md" />
      </label>
      <label>type <span class="req">*</span>
        <input id="m-type" type="text" placeholder="Projeto" />
      </label>
      <label>title
        <input id="m-title" type="text" />
      </label>
      <label>description
        <input id="m-description" type="text" />
      </label>
      <label>tags (separadas por vírgula)
        <input id="m-tags" type="text" placeholder="vendas, receita" />
      </label>
```

- [ ] **Step 2: Popular a categoria e derivar caminho em `openModal` (renderer.js)**

Substituir a função `openModal` (linha ~664) por:

```js
function openModal() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  ['m-path', 'm-type', 'm-title', 'm-description', 'm-tags'].forEach(id => $(id).value = '');
  const tplSel = $('m-template');
  if (!tplSel.options.length) tplSel.innerHTML = Object.keys(CONCEPT_TEMPLATES).map(n => `<option>${escapeHtml(n)}</option>`).join('');
  tplSel.value = 'Em branco';
  // categorias = pastas de topo existentes + opção de nova
  const tops = new Set();
  for (const d of state.docs) { if (!d.reserved && d.relPath.includes('/')) tops.add(d.relPath.split('/')[0]); }
  const cat = $('m-category');
  cat.innerHTML = '<option value="">(raiz)</option>' +
    [...tops].sort().map(t => `<option>${escapeHtml(t)}</option>`).join('') +
    '<option value="__new">+ nova categoria…</option>';
  cat.value = '';
  $('modal').classList.remove('hidden');
  $('m-path').focus();
}
```

- [ ] **Step 3: Ligar o evento de mudança de categoria no `init()` (renderer.js)**

Em `init()`, após a linha `$('m-create').onclick = createConcept;`, inserir:

```js
  $('m-category').addEventListener('change', () => {
    const cat = $('m-category');
    let dir = cat.value;
    if (dir === '__new') {
      dir = (window.prompt('Nome da nova categoria (pasta):') || '').trim().replace(/[\\/]+$/, '');
      if (!dir) { cat.value = ''; return; }
    }
    const file = baseNameOf($('m-path').value.trim() || 'novo.md');
    $('m-path').value = dir ? dir + '/' + file : file;
  });
```

- [ ] **Step 4: Reescrever `createConcept` para montar o lote de ops (renderer.js)**

Substituir a função `createConcept` (linha ~674) por:

```js
async function createConcept() {
  let rel = $('m-path').value.trim().replace(/^\/+/, '');
  const type = $('m-type').value.trim();
  if (!rel) { toast('Informe o caminho do arquivo.', 'bad'); return; }
  if (!rel.toLowerCase().endsWith('.md')) rel += '.md';
  if (!type) { toast('O campo "type" é obrigatório.', 'bad'); return; }
  if (docByRel(rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }
  const fm = { type };
  const title = $('m-title').value.trim() || baseNameOf(rel).replace(/\.md$/i, '');
  fm.title = title;
  if ($('m-description').value.trim()) fm.description = $('m-description').value.trim();
  const tags = $('m-tags').value.split(',').map(s => s.trim()).filter(Boolean);
  if (tags.length) fm.tags = tags;
  fm.timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const tpl = CONCEPT_TEMPLATES[$('m-template').value] || CONCEPT_TEMPLATES['Em branco'];
  const content = OKF.serialize(fm, '# ' + title + '\n\n' + tpl.body);

  const newDoc = { relPath: rel, name: baseNameOf(rel), reserved: OKF.isReserved(rel), content };
  const nextDocs = state.docs.concat([newDoc]);
  const ops = [{ op: 'create', relPath: rel, content }];
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    const desc = fm.description ? ' - ' + fm.description : '';
    ops.push(logOpFrom(nextDocs, '**Criação**: [' + title + '](/' + rel + ')' + desc));
  }
  closeModal();
  const ok = await applyOpsAndRefresh(ops, rel);
  if (ok) toast('Conceito criado: ' + rel, 'good');
}
```

- [ ] **Step 5: Verificar manualmente**

Run: `npm start`
Steps: clique **✨ Exemplo** → **＋ Novo** → escolha categoria `projetos`, caminho vira `projetos/<arquivo>.md` (ajuste o nome), preencha `type` e `title` → **Criar**.
Expected:
- O conceito aparece e abre.
- `projetos/index.md` ganhou um bullet `* [<title>](/projetos/<arquivo>.md)` dentro do bloco `<!-- okf:index -->`.
- `index.md` raiz lista o conceito na seção `## Projetos`.
- `log.md` tem `## <hoje>` com `* **Criação**: [<title>](/projetos/<arquivo>.md)`.
- Clique **✓ Validar**: 0 erros.

Feche o app. (Reverter o conceito de teste no exemplo é opcional; a `sample-library` é versionada — descarte mudanças se quiser: `git checkout -- sample-library`.)

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat(renderer): criar conceito com categoria/tags atualiza index.md/log.md (lote applyOps)"
```

---

### Task 13: Editar e Excluir atualizando índices/log

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Atualizar índices ao Salvar (apenas se title/description mudaram)**

Em `saveEdit` (linha ~549), localizar o bloco `try { await window.okf.writeFile(...) ... }` e substituí-lo por uma versão que usa o lote quando há mudança de title/description num conceito:

```js
  try {
    if (doc.reserved || !autoIndexEnabled()) {
      await window.okf.writeFile({ root: state.root, relPath: doc.relPath, content });
      doc.content = content;
      indexDocs(); buildTypeFilter(); renderTree();
      state.editing = false;
      if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
      renderConcept(doc);
      toast('Salvo em ' + doc.relPath, 'good');
      return;
    }
    const before = OKF.parse(doc.content).frontmatter;
    const after = OKF.parse(content).frontmatter;
    const metaChanged = (before.title || '') !== (after.title || '') ||
                        (before.description || '') !== (after.description || '');
    const nextDocs = state.docs.map(d => d.relPath === doc.relPath ? { ...d, content } : d);
    const ops = [{ op: 'write', relPath: doc.relPath, content }];
    if (metaChanged) ops.push(...indexOpsFrom(nextDocs)); // sem log: edição não é estrutural
    if (!doc.reserved && state.editorMode === 'visual' && window.OKFEditor) { await window.OKFEditor.destroy(); }
    state.editing = false;
    const ok = await applyOpsAndRefresh(ops, doc.relPath);
    if (ok) toast('Salvo em ' + doc.relPath, 'good');
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'bad');
  }
```

- [ ] **Step 2: Reescrever `deleteCurrent` para usar o lote**

Substituir `deleteCurrent` (linha ~590) por:

```js
async function deleteCurrent() {
  const doc = state.docs.find(d => d.relPath === state.current);
  if (!doc || doc.reserved) return;
  const ok = await window.okf.confirm({ message: 'Excluir este conceito?', detail: doc.relPath });
  if (!ok) return;
  const title = OKF.parse(doc.content).frontmatter.title || baseNameOf(doc.relPath).replace(/\.md$/i, '');
  const nextDocs = state.docs.filter(d => d.relPath !== doc.relPath);
  const ops = [{ op: 'delete', relPath: doc.relPath }];
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    ops.push(logOpFrom(nextDocs, '**Exclusão**: removido `' + doc.relPath + '` (' + title + ').'));
  }
  const done = await applyOpsAndRefresh(ops, null);
  if (done) toast('Conceito excluído', 'good');
}
```

- [ ] **Step 3: Verificar manualmente**

Run: `npm start` → **✨ Exemplo**.
- Edite um conceito mudando o `title` → **💾 Salvar** → confira que o bullet no `index.md` da pasta e na raiz reflete o novo título; o `log.md` **não** ganhou entrada nova.
- Exclua um conceito → confira que sumiu do `index.md` e que o `log.md` ganhou `* **Exclusão**:`.
- **✓ Validar**: 0 erros.

Feche o app (`git checkout -- sample-library` se quiser descartar o teste).

- [ ] **Step 4: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(renderer): salvar (title/desc) e excluir atualizam índices; exclusão entra no log"
```

---

### Task 14: Renomear/Mover (rodapé + menu de contexto da árvore)

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Adicionar o botão "Renomear/Mover" no rodapé do conceito (index.html)**

No `.viewer-actions` (linha ~54), após o `#btn-cancel` e antes do `#btn-delete`, inserir:

```html
            <button id="btn-rename">✏ Renomear/Mover</button>
```

- [ ] **Step 2: Adicionar o modal de renomear/mover (index.html)**

Após o `#modal` (depois de `</div>` que fecha o modal de novo conceito, ~linha 214), inserir:

```html
  <!-- Renomear/Mover -->
  <div id="rename-modal" class="modal hidden">
    <div class="modal-card">
      <h2>Renomear / Mover conceito</h2>
      <label>Novo caminho dentro da biblioteca
        <input id="rn-path" type="text" placeholder="categoria/nome.md" />
      </label>
      <p class="muted" id="rn-hint"></p>
      <div class="modal-actions">
        <button id="rn-cancel">Cancelar</button>
        <button id="rn-ok" class="primary">Mover</button>
      </div>
    </div>
  </div>

  <!-- Menu de contexto da árvore -->
  <div id="tree-menu" class="tree-menu hidden">
    <button data-act="rename">✏ Renomear/Mover…</button>
    <button data-act="delete" class="danger">🗑 Excluir</button>
  </div>
```

- [ ] **Step 3: Estilos do menu de contexto (styles.css)**

Ao final de `renderer/styles.css`, adicionar:

```css
.tree-menu {
  position: fixed;
  z-index: 50;
  background: var(--panel, #2a2b30);
  border: 1px solid var(--line, #3a3b42);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  display: flex;
  flex-direction: column;
  min-width: 180px;
}
.tree-menu button {
  text-align: left;
  background: transparent;
  border: 0;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text, #e6e6e6);
}
.tree-menu button:hover { background: var(--hover, rgba(255,255,255,.08)); }
.tree-menu.hidden { display: none; }
```

- [ ] **Step 4: Implementar a lógica de rename (renderer.js)**

Antes de `/* ---------- Delete ---------- */` (linha ~589), inserir:

```js
/* ---------- Renomear / Mover ---------- */
let renameFrom = null;
function openRename(rel) {
  rel = rel || state.current;
  const doc = rel && docByRel(rel);
  if (!doc || doc.reserved) { toast('Selecione um conceito (não reservado).', 'bad'); return; }
  renameFrom = rel;
  $('rn-path').value = rel;
  $('rn-hint').textContent = 'Atual: ' + rel + ' — os links que apontam para este conceito serão atualizados.';
  $('rename-modal').classList.remove('hidden');
  $('rn-path').focus();
}
function closeRename() { $('rename-modal').classList.add('hidden'); renameFrom = null; }

async function doRename() {
  const fromRel = renameFrom;
  let toRel = $('rn-path').value.trim().replace(/^\/+/, '');
  if (!fromRel) return;
  if (!toRel) { toast('Informe o novo caminho.', 'bad'); return; }
  if (!toRel.toLowerCase().endsWith('.md')) toRel += '.md';
  if (toRel === fromRel) { closeRename(); return; }
  if (docByRel(toRel)) { toast('Já existe um conceito em ' + toRel, 'bad'); return; }

  const changes = OKF.auto.rewriteRenameLinks(state.docs, fromRel, toRel);
  const movedChange = changes.find(c => c.relPath === fromRel);
  const movedContent = movedChange ? movedChange.newContent : docByRel(fromRel).content;

  let nextDocs = state.docs.filter(d => d.relPath !== fromRel).map(d => {
    const c = changes.find(x => x.relPath === d.relPath);
    return c ? { ...d, content: c.newContent } : d;
  });
  nextDocs.push({ relPath: toRel, name: baseNameOf(toRel), reserved: OKF.isReserved(toRel), content: movedContent });

  const ops = [{ op: 'create', relPath: toRel, content: movedContent }, { op: 'delete', relPath: fromRel }];
  for (const c of changes) {
    if (c.relPath === fromRel) continue;
    ops.push({ op: 'write', relPath: c.relPath, content: c.newContent });
  }
  if (autoIndexEnabled()) {
    ops.push(...indexOpsFrom(nextDocs));
    const sameDir = (fromRel.includes('/') ? fromRel.replace(/\/[^/]*$/, '') : '') ===
                    (toRel.includes('/') ? toRel.replace(/\/[^/]*$/, '') : '');
    const title = OKF.parse(movedContent).frontmatter.title || baseNameOf(toRel).replace(/\.md$/i, '');
    const verbo = sameDir ? 'Renomeação' : 'Movimentação';
    ops.push(logOpFrom(nextDocs, '**' + verbo + '**: `' + fromRel + '` → [' + title + '](/' + toRel + ').'));
  }
  closeRename();
  const ok = await applyOpsAndRefresh(ops, toRel);
  if (ok) toast('Movido para ' + toRel, 'good');
}
```

- [ ] **Step 5: Implementar o menu de contexto da árvore (renderer.js)**

Em `renderTree`, dentro do loop dos nós, após `node.addEventListener('click', () => openDoc(it.d.relPath));` (linha ~202), inserir:

```js
      if (!it.d.reserved) {
        node.addEventListener('contextmenu', (e) => { e.preventDefault(); openTreeMenu(e, it.d.relPath); });
      }
```

E antes de `/* ---------- View states ---------- */` (linha ~220), inserir:

```js
/* ---------- Menu de contexto da árvore ---------- */
let treeMenuRel = null;
function openTreeMenu(e, rel) {
  treeMenuRel = rel;
  const m = $('tree-menu');
  m.style.left = e.clientX + 'px';
  m.style.top = e.clientY + 'px';
  m.classList.remove('hidden');
}
function closeTreeMenu() { $('tree-menu').classList.add('hidden'); treeMenuRel = null; }
```

- [ ] **Step 6: Ligar os eventos em `init()` (renderer.js)**

Após `$('btn-delete').onclick = deleteCurrent;` (linha ~905), inserir:

```js
  $('btn-rename').onclick = () => openRename(state.current);
  $('rn-cancel').onclick = closeRename;
  $('rn-ok').onclick = doRename;
  $('tree-menu').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => {
    const rel = treeMenuRel; const act = b.dataset.act; closeTreeMenu();
    if (!rel) return;
    if (act === 'rename') openRename(rel);
    else if (act === 'delete') { openDoc(rel); deleteCurrent(); }
  }));
  document.addEventListener('click', (e) => { if (!$('tree-menu').contains(e.target)) closeTreeMenu(); });
```

E no handler de `Escape` (linha ~951), incluir o fechamento dos novos overlays — substituir a linha do `Escape` por:

```js
    if (e.key === 'Escape') { closeModal(); closeConceptPicker(); closePalette(); closeRename(); closeTreeMenu(); if ($('graph-view').classList.contains('hidden')===false || $('validate-view').classList.contains('hidden')===false || $('manual-view').classList.contains('hidden')===false || $('git-view').classList.contains('hidden')===false){ closeOverlays(); if(state.current) showViewer(); } }
```

- [ ] **Step 7: Mostrar/ocultar o botão Renomear junto do Excluir (renderer.js)**

Em `renderConcept` (linha ~328), após `$('btn-delete').classList.toggle('hidden', doc.reserved);`, inserir:

```js
  $('btn-rename').classList.toggle('hidden', doc.reserved);
```

E em `enterEdit`/`renderConcept` o botão de rename deve sumir no modo edição — em `enterEdit` (após `$('btn-cancel').classList.remove('hidden');`, ~linha 409), inserir:

```js
  $('btn-rename').classList.add('hidden');
```

- [ ] **Step 8: Verificar manualmente**

Run: `npm start` → **✨ Exemplo**.
- Abra `projetos/atlas.md`, clique **✏ Renomear/Mover**, troque para `projetos/atlas-v2.md` → **Mover**.
  - Confere: arquivo renomeado; `index.md` da pasta/raiz atualizados; backlinks de outros conceitos para Atlas continuam funcionando (clique-os); `log.md` tem `* **Renomeação**:`.
- Mova `projetos/atlas-v2.md` para `arquivados/atlas-v2.md` (categoria nova no caminho) → confere `## Arquivados` na raiz e `arquivados/index.md` criado; `log.md` com `* **Movimentação**:`.
- Botão direito num conceito da árvore → menu com Renomear/Excluir funciona.
- **✓ Validar**: 0 erros, e nenhum link quebrado novo.

Feche (`git checkout -- sample-library` para descartar).

- [ ] **Step 9: Commit**

```bash
git add renderer/index.html renderer/renderer.js renderer/styles.css
git commit -m "feat(renderer): renomear/mover com integridade de links (rodapé + menu de contexto da árvore)"
```

---

### Task 15: Reconstruir índices (menu + paleta) com confirmação

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Implementar `rebuildIndexes` (renderer.js)**

Antes de `/* ---------- Validation ---------- */` (linha ~696), inserir:

```js
/* ---------- Reconstruir índices ---------- */
async function rebuildIndexes() {
  if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
  const ops = indexOpsFrom(state.docs);
  if (!ops.length) { toast('Índices já estão atualizados.', 'good'); return; }
  const ok = await window.okf.confirm({
    message: 'Reconstruir índices?',
    detail: ops.length + ' arquivo(s) index.md serão (re)escritos. A prosa fora dos blocos gerenciados é preservada.'
  });
  if (!ok) return;
  const done = await applyOpsAndRefresh(ops, state.current);
  if (done) toast('Índices reconstruídos (' + ops.length + ' arquivo(s)).', 'good');
}
```

- [ ] **Step 2: Ligar o menu e a paleta (renderer.js)**

Em `init()`, junto aos outros `onMenu` (após `window.okf.onMenu('menu:graph', showGraph);`), inserir:

```js
  window.okf.onMenu('menu:rebuild-indexes', rebuildIndexes);
```

(O handler de `menu:new-library` é registrado na Task 16, junto da definição de `newLibrary`, para não referenciar um identificador ainda inexistente.)

E em `paletteActions()` (linha ~610), adicionar duas ações ao array (antes de `{ label: 'Manual do OKF Studio', ... }`):

```js
    { label: 'Reconstruir índices', run: rebuildIndexes, needsLib: true },
    { label: autoIndexEnabled() ? 'Índices automáticos: DESLIGAR' : 'Índices automáticos: LIGAR',
      run: () => { setAutoIndex(!autoIndexEnabled()); toast('Índices automáticos: ' + (autoIndexEnabled() ? 'ligados' : 'desligados'), 'good'); }, needsLib: false },
```

- [ ] **Step 3: Verificar manualmente**

Run: `npm start` → **✨ Exemplo**.
- A `sample-library` não tem marcadores `<!-- okf:index -->`. Rode **Exibir ▸ Reconstruir índices** → confirma → os `index.md` ganham o bloco gerenciado no fim, preservando o texto/lists original acima.
- Rode de novo: "Índices já estão atualizados." (idempotente).
- `Ctrl+P` → "Índices automáticos: DESLIGAR" alterna a preferência (toast).
- **✓ Validar**: 0 erros.

Feche (`git checkout -- sample-library`).

- [ ] **Step 4: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(renderer): comando Reconstruir índices (menu+paleta) e toggle de índices automáticos"
```

---

### Task 16: Nova biblioteca (botão + menu + modal de nome)

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`

- [ ] **Step 1: Adicionar o botão e o modal de nome (index.html)**

No `.tools` da toolbar, após o `#btn-open` (linha ~15), inserir:

```html
      <button id="btn-newlib" title="Criar uma biblioteca OKF nova">🆕 Nova</button>
```

E após o `#rename-modal` (Task 14), inserir:

```html
  <!-- Nova biblioteca -->
  <div id="newlib-modal" class="modal hidden">
    <div class="modal-card">
      <h2>Nova biblioteca OKF</h2>
      <p class="muted" id="nl-dir"></p>
      <label>Nome da biblioteca
        <input id="nl-name" type="text" placeholder="Minha Base de Conhecimento" />
      </label>
      <div class="modal-actions">
        <button id="nl-cancel">Cancelar</button>
        <button id="nl-ok" class="primary">Criar biblioteca</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Implementar `newLibrary` (renderer.js)**

Após `async function openSample() {...}` (linha ~88), inserir:

```js
/* ---------- Nova biblioteca ---------- */
let newLibDir = null;
async function newLibrary() {
  const dir = await window.okf.newLibraryDialog();
  if (!dir) return;
  newLibDir = dir;
  $('nl-dir').textContent = 'Pasta: ' + dir;
  $('nl-name').value = dir.split(/[\\/]/).pop() || 'Biblioteca';
  $('newlib-modal').classList.remove('hidden');
  $('nl-name').focus();
}
function closeNewLib() { $('newlib-modal').classList.add('hidden'); newLibDir = null; }
async function doCreateLibrary() {
  if (!newLibDir) return;
  const name = $('nl-name').value.trim() || 'Biblioteca';
  const files = OKF.auto.libraryFiles(name, todayStr());
  const r = await window.okf.createLibrary({ dir: newLibDir, files });
  if (!r || !r.ok) { toast('Erro: ' + ((r && r.error) || 'desconhecido'), 'bad'); return; }
  const dir = newLibDir;
  closeNewLib();
  const res = await window.okf.readBundle(dir);
  loadBundle(res, name);
  toast('Biblioteca criada em ' + dir, 'good');
}
```

- [ ] **Step 3: Ligar os eventos em `init()` (renderer.js)**

Após `$('btn-open').onclick = openFolder;` (linha ~879), inserir:

```js
  $('btn-newlib').onclick = newLibrary;
  $('nl-cancel').onclick = closeNewLib;
  $('nl-ok').onclick = doCreateLibrary;
  window.okf.onMenu('menu:new-library', newLibrary);
```

E no handler de `Escape`, adicionar `closeNewLib();` junto aos outros fechamentos (na mesma linha já editada na Task 14):

```js
    if (e.key === 'Escape') { closeModal(); closeConceptPicker(); closePalette(); closeRename(); closeTreeMenu(); closeNewLib(); if (...) { ... } }
```

E adicionar à paleta (em `paletteActions`, após "Carregar biblioteca de exemplo"):

```js
    { label: 'Nova biblioteca…', run: newLibrary, needsLib: false },
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm start`.
- Clique **🆕 Nova** → escolha/crie uma pasta vazia → informe um nome → **Criar biblioteca**.
- Confere: a pasta tem `index.md` (com `okf_version` + título + bloco gerenciado), `log.md` (com `## <hoje>` / `* **Criação**:`) e `CLAUDE.md` (enxuto, com frontmatter `type: Referência`).
- O app abre a nova biblioteca; **✓ Validar** → **0 erros**.
- Crie um conceito nela (Task 12) e confirme que índices/log atualizam.
- Tente **🆕 Nova** apontando para uma pasta que já tem `index.md` → erro "A pasta já contém: index.md".

Feche o app.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/renderer.js
git commit -m "feat(renderer): assistente de Nova biblioteca (scaffolding mínimo + CLAUDE.md enxuto)"
```

---

### Task 17: Painel de sugestão de cross-links

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Adicionar o badge e o painel (index.html)**

Dentro de `#edit-mode`, logo após `<div id="milkdown" ...></div>` e o `<textarea id="e-body" ...>` (linha ~126), inserir:

```html
          <button id="xlink-badge" class="xlink-badge hidden" type="button"></button>
          <div id="xlink-panel" class="xlink-panel hidden">
            <div class="xlink-head">
              <strong>Sugestões de links</strong>
              <span class="grow"></span>
              <button id="xlink-all" type="button">Aceitar todas</button>
              <button id="xlink-close" type="button">Fechar</button>
            </div>
            <div id="xlink-list" class="xlink-list"></div>
          </div>
```

- [ ] **Step 2: Estilos (styles.css)**

Ao final de `renderer/styles.css`, adicionar:

```css
.xlink-badge {
  margin-top: 8px;
  background: var(--accent, #5340b5);
  color: #fff; border: 0; border-radius: 6px;
  padding: 6px 10px; cursor: pointer;
}
.xlink-badge.hidden, .xlink-panel.hidden { display: none; }
.xlink-panel {
  margin-top: 8px; border: 1px solid var(--line, #3a3b42);
  border-radius: 8px; padding: 8px; background: var(--panel, #2a2b30);
}
.xlink-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.xlink-head .grow { flex: 1; }
.xlink-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.xlink-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.xlink-item:hover { background: var(--hover, rgba(255,255,255,.06)); }
.xlink-item .grow { flex: 1; }
.xlink-item code { background: var(--hover, rgba(255,255,255,.08)); padding: 0 4px; border-radius: 4px; }
```

- [ ] **Step 3: Implementar a lógica (renderer.js)**

Antes de `/* ---------- Edit ---------- */` (linha ~400), inserir:

```js
/* ---------- Sugestão de cross-links ---------- */
function currentConceptsForLinks() {
  return state.docs.filter(d => !d.reserved && d.relPath !== state.current)
    .map(d => ({ relPath: d.relPath, title: parsedOf(d).frontmatter.title || baseNameOf(d.relPath).replace(/\.md$/i, '') }));
}
function refreshLinkSuggestions() {
  if (!state.editing || !state.current) { $('xlink-badge').classList.add('hidden'); $('xlink-panel').classList.add('hidden'); return; }
  const body = (state.editorMode === 'source' || (docByRel(state.current) || {}).reserved)
    ? $('e-body').value
    : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const sugg = OKF.auto.suggestLinks(body || '', currentConceptsForLinks(), OKF.conceptId(state.current));
  state.linkSuggestions = sugg;
  const badge = $('xlink-badge');
  if (sugg.length) { badge.textContent = '🔗 ' + sugg.length + ' sugestão(ões) de links'; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); $('xlink-panel').classList.add('hidden'); }
}
function openLinkPanel() {
  const sugg = state.linkSuggestions || [];
  const list = $('xlink-list');
  list.innerHTML = sugg.map((s, i) =>
    `<div class="xlink-item" data-i="${i}"><code>${escapeHtml(s.text)}</code> → <span>${escapeHtml(s.targetRel)}</span>` +
    `<span class="grow"></span><button data-acc="${i}">Aceitar</button><button data-dis="${i}">Dispensar</button></div>`).join('') ||
    '<div class="muted">Nenhuma sugestão.</div>';
  list.querySelectorAll('button[data-acc]').forEach(b => b.onclick = () => acceptSuggestion(+b.dataset.acc));
  list.querySelectorAll('button[data-dis]').forEach(b => b.onclick = () => dismissSuggestion(+b.dataset.dis));
  $('xlink-panel').classList.remove('hidden');
}
async function applyBodyEdit(newBody) {
  state.editorBody = newBody;
  if (state.editorMode === 'source' || (docByRel(state.current) || {}).reserved) {
    $('e-body').value = newBody;
  } else if (window.OKFEditor) {
    await window.OKFEditor.destroy();
    await window.OKFEditor.create($('milkdown'), newBody, { onChange: (md) => { state.editorBody = md; } });
  }
}
async function acceptSuggestion(i) {
  const sugg = state.linkSuggestions || [];
  if (!sugg[i]) return;
  const body = state.editorMode === 'source' ? $('e-body').value : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const newBody = OKF.auto.applySuggestions(body, [sugg[i]]);
  await applyBodyEdit(newBody);
  refreshLinkSuggestions();
  if ((state.linkSuggestions || []).length) openLinkPanel(); else $('xlink-panel').classList.add('hidden');
}
function dismissSuggestion(i) {
  state.linkSuggestions = (state.linkSuggestions || []).filter((_, j) => j !== i);
  if (state.linkSuggestions.length) openLinkPanel(); else $('xlink-panel').classList.add('hidden');
  $('xlink-badge').textContent = '🔗 ' + state.linkSuggestions.length + ' sugestão(ões) de links';
  if (!state.linkSuggestions.length) $('xlink-badge').classList.add('hidden');
}
async function acceptAllSuggestions() {
  const sugg = state.linkSuggestions || [];
  if (!sugg.length) return;
  const body = state.editorMode === 'source' ? $('e-body').value : (window.OKFEditor ? window.OKFEditor.getMarkdown() : state.editorBody);
  const newBody = OKF.auto.applySuggestions(body, sugg);
  await applyBodyEdit(newBody);
  refreshLinkSuggestions();
}
```

- [ ] **Step 4: Inicializar `state.linkSuggestions` e calcular ao entrar em edição (renderer.js)**

No objeto `state` (linha ~4), adicionar a propriedade:

```js
  editorBody: '',
  linkSuggestions: [],
```

No fim de `enterEdit` (após o último `await window.OKFEditor.create(...)`, ~linha 456), inserir:

```js
  setTimeout(refreshLinkSuggestions, 0);
```

E em `cancelEdit` e no início de `renderConcept`, ocultar o painel — no começo de `renderConcept` (linha ~322), inserir:

```js
  $('xlink-badge').classList.add('hidden'); $('xlink-panel').classList.add('hidden');
```

- [ ] **Step 5: Ligar os eventos em `init()` (renderer.js)**

Após `$('btn-rename').onclick = ...` (Task 14), inserir:

```js
  $('xlink-badge').onclick = openLinkPanel;
  $('xlink-close').onclick = () => $('xlink-panel').classList.add('hidden');
  $('xlink-all').onclick = acceptAllSuggestions;
```

E recalcular sugestões ao alternar Visual/Código — no fim de `setEditorMode` (após `setModeButtons(mode);`, ~linha 533), inserir:

```js
  setTimeout(refreshLinkSuggestions, 0);
```

- [ ] **Step 6: Verificar manualmente**

Run: `npm start` → **✨ Exemplo**.
- Edite um conceito e escreva no corpo o **título exato** de outro conceito (ex.: "Projeto Aurora") em texto puro.
- Aparece o badge "🔗 1 sugestão(ões) de links". Clique → painel lista `Projeto Aurora → /projetos/aurora.md` → **Aceitar**.
- O corpo passa a ter `[Projeto Aurora](/projetos/aurora.md)`. A sugestão some (já linkado).
- Escreva o título dentro de crase `` `Projeto Aurora` `` → não sugere.
- **Aceitar todas** com 2+ sugestões aplica todas.

Feche (`git checkout -- sample-library`).

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/renderer.js renderer/styles.css
git commit -m "feat(renderer): painel de sugestão de cross-links (determinístico, confirmado pelo usuário)"
```

---

## Fase D — Smoke de integração + documentação

### Task 18: Smoke do fluxo de criação (test-renderer.js)

**Files:**
- Modify: `test-renderer.js`

- [ ] **Step 1: Inspecionar o estilo atual de `test-renderer.js`**

Run: `npm run test:ui` (apenas para ver o runner atual rodar; feche a janela ao fim).
Expected: o smoke atual roda. Anote como ele expõe `window.__okf*` (ex.: `window.__okfTemplates`).

- [ ] **Step 2: Adicionar um smoke puro de orquestração de índices ao final de `test-auto.js`**

Como o fluxo completo do renderer depende do Electron, validamos a **composição das ops** de forma pura. Antes da linha `console.log(\`\n${n} checagens` em `test-auto.js`, inserir:

```js
// ---- Task 18: smoke de orquestração (índices + log a partir de docs) ----
function mkDocs() {
  return [
    { relPath: 'index.md', name: 'index.md', reserved: true, content: OKF.serialize({ okf_version: '0.1' }, '# Base\n\n' + A.MARK_START + '\n' + A.MARK_END + '\n') },
    { relPath: 'log.md', name: 'log.md', reserved: true, content: '# Histórico de Atualizações\n' },
    { relPath: 'projetos/index.md', name: 'index.md', reserved: true, content: '# Projetos\n\n' + A.MARK_START + '\n' + A.MARK_END + '\n' },
  ];
}
const docsT18 = mkDocs();
const novo = { relPath: 'projetos/x.md', name: 'x.md', reserved: false, content: OKF.serialize({ type: 'Projeto', title: 'X', description: 'Desc X.' }, '# X') };
const next18 = docsT18.concat([novo]);

// índice da pasta deve listar o novo conceito
const projIdx = A.mergeManagedBlock(docsT18[2].content, A.dirListing(next18, 'projetos'));
ok(projIdx.includes('* [X](/projetos/x.md) - Desc X.'), 'smoke: projetos/index.md lista o conceito');

// índice raiz deve listar na seção Projetos
const rootIdx = A.mergeManagedBlock(docsT18[0].content, A.rootListing(next18));
ok(rootIdx.includes('## Projetos') && rootIdx.includes('* [X](/projetos/x.md) - Desc X.'), 'smoke: index raiz lista na categoria');

// log recebe entrada de criação
const log18 = A.appendLog(docsT18[1].content, '2026-06-25', '**Criação**: [X](/projetos/x.md) - Desc X.');
ok(log18.includes('## 2026-06-25') && log18.includes('**Criação**: [X](/projetos/x.md)'), 'smoke: log recebe Criação');
```

- [ ] **Step 3: Rodar e ver passar**

Run: `node test-auto.js`
Expected: PASS — `AUTO OK`.

- [ ] **Step 4: Rodar a suíte pura completa (regressão)**

Run: `node test-okf.js && node test-auto.js`
Expected: ambos terminam OK (`TESTE OK` e `AUTO OK`).

- [ ] **Step 5: Commit**

```bash
git add test-auto.js
git commit -m "test: smoke de orquestração de índices/log no fluxo de criação"
```

---

### Task 19: Atualizar README e o Manual

**Files:**
- Modify: `README.md`
- Modify: `renderer/index.html` (bloco `#manual-md`)

- [ ] **Step 1: Atualizar a lista de recursos no `README.md`**

Na seção "## O que o app faz", após o item de "Modelos por tipo", adicionar os bullets:

```markdown
- **Criar biblioteca nova** — o botão **🆕 Nova** (ou Arquivo ▸ Nova biblioteca…)
  cria, numa pasta vazia, o `index.md` raiz, o `log.md` e um `CLAUDE.md` enxuto
  com as regras do formato — pronta e conforme ao OKF v0.1.
- **Índices e log automáticos** — ao criar/editar/excluir/renomear/mover um
  conceito, o app mantém os `index.md` (bloco gerenciado, preservando sua prosa)
  e registra as mudanças estruturais no `log.md`. Pode ser desligado, e há o
  comando **Reconstruir índices** (Exibir ▸ ou paleta) para reparar tudo.
- **Renomear/Mover com integridade** — reescreve os links que apontam para o
  conceito movido, preservando o estilo (absoluto/relativo) e as âncoras.
- **Sugestão de cross-links** — ao editar, o app aponta menções a outros
  conceitos e oferece transformá-las em links (com sua confirmação).
```

- [ ] **Step 2: Atualizar a estrutura do projeto no `README.md`**

Na seção "## Estrutura do projeto", após a linha `├── git.js …`, adicionar:

```markdown
├── tools/okf-template/  Template (CLAUDE.md enxuto) p/ novas bibliotecas
```

E na lista de arquivos de `renderer/`, após `okf.js`, ajustar a descrição para mencionar `OKF.auto`:

```markdown
│   ├── okf.js           Núcleo OKF: parsing, links, validação, grafo + OKF.auto (índices/log/rename/cross-links)
```

- [ ] **Step 3: Adicionar uma seção ao Manual (`#manual-md` em index.html)**

No `index.html`, dentro do `<script type="text/markdown" id="manual-md">`, após a seção "## 7. Como criar um conceito", inserir uma nova seção:

```markdown
## 7a. Bibliotecas novas e automação

- **Criar uma biblioteca:** clique em **🆕 Nova** (ou Arquivo ▸ Nova
  biblioteca…), escolha uma pasta vazia e dê um nome. O app gera `index.md`,
  `log.md` e um `CLAUDE.md` com as regras do formato.
- **Índices e log automáticos:** ao criar, editar, excluir, renomear ou mover
  conceitos, o app mantém os `index.md` de cada pasta (dentro de um bloco
  `<!-- okf:index -->` que preserva o texto que você escreveu em volta) e
  registra as mudanças estruturais no `log.md`. Use **Exibir ▸ Reconstruir
  índices** para reparar uma biblioteca antiga ou após editar pelo Claude Code.
- **Renomear/Mover:** no rodapé do conceito (ou botão direito na árvore). Os
  links que apontavam para ele são atualizados automaticamente.
- **Sugestão de links:** ao editar, um aviso mostra menções a outros conceitos
  que podem virar links — você aceita uma a uma ou todas.
```

- [ ] **Step 4: Verificar o Manual no app**

Run: `npm start` → `F1` (Manual) → confira que a seção "7a" aparece no índice lateral e renderiza. Feche o app.

- [ ] **Step 5: Commit**

```bash
git add README.md renderer/index.html
git commit -m "docs: README + Manual cobrindo nova biblioteca, índices/log automáticos, rename e cross-links"
```

---

## Verificação final

- [ ] **Suíte pura:** `node test-okf.js && node test-auto.js` → ambos OK.
- [ ] **App em dev:** `npm start` → criar biblioteca, criar/editar/excluir/mover conceito, reconstruir índices, sugerir links; **✓ Validar** sempre 0 erros.
- [ ] **Sem sujar a sample versionada:** `git status` limpo em `sample-library/` (use `git checkout -- sample-library` se testou nela).

---

## Self-review (preenchido pelo autor do plano)

**1. Cobertura do spec:**
- Arquitetura C (lógica pura + `fs:applyOps` + watcher pausado) → Tasks 8, 9, 11.
- Bloco gerenciado do index (markers, preserva prosa, raiz vs subdir) → Tasks 2, 3, 11.
- Links bundle-relativos `/…` em tudo gerado → bulletFor/listings (Tasks 1, 2), libraryFiles (7).
- Criar biblioteca (mínimo + CLAUDE.md enxuto, valida 0 erros) → Tasks 7, 10, 16.
- Scaffolding inteligente de conceito (categoria, tags, título derivado) → Task 12.
- Editar/Excluir atualizando índices; só estruturais no log → Task 13.
- Renomear/Mover com integridade + menu de contexto da árvore → Tasks 5, 14.
- Reconstruir índices (menu + paleta, confirmação) → Task 15.
- Preferência auto-index → Tasks 11, 15.
- Sugestão de cross-links (determinística, confirmada, anti-ruído) → Tasks 6, 17.
- Conformidade OKF do gerado → Tasks 7 (teste), verificações manuais (12–16).
- Testes → Tasks 1–7, 18.

**2. Placeholders:** nenhum "TBD"/"TODO"; todo passo de código traz o código.

**3. Consistência de tipos/nomes:** `OKF.auto.*` usado igual em todas as tasks; ops `create/write/delete` idem em main e renderer; helpers `indexOpsFrom`/`logOpFrom`/`applyOpsAndRefresh`/`refreshFromDisk`/`docByRel`/`baseNameOf`/`todayStr`/`autoIndexEnabled` definidos na Task 11 e reusados nas Tasks 12–16.
