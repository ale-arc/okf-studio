# Refino da heurística PDF→MD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aumentar a fidelidade da conversão PDF→Markdown (reflow de parágrafos + des-hifenização, remoção de cabeçalho/rodapé repetidos, ordenação de leitura multi-coluna, detector de tabela estrito e junção de ligaduras) — tudo local/heurístico.

**Architecture:** Quase tudo é lógica pura em `src/convert/reconstruct.js`, evoluída por funções pequenas e testáveis (`splitColumns`, `isTableStrict`, `splitByGap`, `joinParagraph`, `stripRunningHeadersFooters`) e um novo orquestrador `emitLines`. A única integração browser é o `convertPdf` de `src/convert/index.js`, que passa a fazer duas passagens (coletar itens → remover cabeçalho/rodapé entre páginas → reconstruir por página). Há um harness de diagnóstico dev-only `tools/pdf2md-cli.mjs` para medir antes/depois em PDFs reais.

**Tech Stack:** Node, esbuild, `pdfjs-dist` (já instalado). Testes em `node test-convert.js` (harness `ok`/`has` existente; helper `it(str,x,y,fontSize,extra)` já definido no arquivo pela suíte B4).

**Branch:** continuar em `feat/conversao-documentos` (commits entram no PR #7).

---

## File Structure

- `src/convert/reconstruct.js` (modificar bastante) — heurística pura. Novas funções e novo orquestrador interno; mantém a assinatura pública `reconstructMarkdown(items)` e ganha o export `stripRunningHeadersFooters(pages)` (+ helpers exportados para teste).
- `src/convert/index.js` (modificar `convertPdf`) — duas passagens + remoção de cabeçalho/rodapé.
- `test-convert.js` (append) — novos blocos de teste (positivos e negativos).
- `tools/pdf2md-cli.mjs` (já existe no working tree; commitar em R7) — harness de QA dev-only.
- `renderer/vendor/convert.bundle.js` — rebuild (artefato, não versionado).

---

## Task R1: Junção de ligaduras (fi/fl) em `lineText`

**Files:**
- Modify: `src/convert/reconstruct.js` (função `lineText`)
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test** — acrescente ao final de `test-convert.js`, ANTES do trailer de resumo (`console.log(\`\n${n} checagens...\`)`):

```js
// ---- R1: ligaduras ----
const { reconstructMarkdown: _rmLig } = require('./src/convert/reconstruct.js');
{
  // "cientí" + "fi" + "ca" com gaps pequenos devem religar em "científica"
  const md = _rmLig([ it('cientí', 50, 50, 12), it('fi', 78, 50, 12), it('ca', 86, 50, 12) ]);
  has(md, 'científica', 'ligadura: religa fi sem espaço');
  ok(!/cient[íi]\s+fi/.test(md), 'ligadura: não deixa "cientí fi"');
}
```

Nota: `it(...)` define `w = str.length * fontSize * 0.5`, então `cientí`(6)→w=36 (span 50–86), `fi`(2)→w=12 (x=78). O gap `fi.x - (cientí.x+w)` = 78-86 = -8 (negativo, sem espaço). `ca`(x=86) gap = 86-(78+6)=2 < 0.6*12. Ajuste os x se necessário para refletir gaps pequenos, mas mantenha a intenção.

- [ ] **Step 2: Run** `node test-convert.js` → deve FALHAR em `ligadura: religa fi sem espaço` (hoje insere espaço).

- [ ] **Step 3: Implementação** — em `src/convert/reconstruct.js`, substitua a função `lineText` inteira por:

```js
const LIGATURE = /^(fi|fl|ff|ffi|ffl|ﬀ|ﬁ|ﬂ|ﬃ|ﬄ)$/i;
function lineText(line) {
  let out = '';
  let prev = null;
  for (const it of line.items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const ligature = LIGATURE.test(it.str.trim()) || LIGATURE.test(prev.str.trim());
      const thresh = (ligature ? 0.6 : 0.3) * prev.fontSize;
      if (gap > thresh) out += ' ';
    }
    out += emph(it);
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run** `node test-convert.js` → "CONVERT OK", 0 falhas (todos os testes antigos seguem passando).

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): religa ligaduras fi/fl na reconstrução"
```

---

## Task R2: Detector de tabela estrito

**Files:**
- Modify: `src/convert/reconstruct.js` (substituir `detectColumns`, `cellsFor`, `isTableBlock`; ajustar a chamada em `reconstructMarkdown`)
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test** — acrescente antes do trailer:

```js
// ---- R2: tabela estrita ----
const RC = require('./src/convert/reconstruct.js');
{
  // tabela real 3x2 (células preenchidas, colunas com gutter) -> detecta
  const tbl = [
    it('Nome', 50, 50, 12), it('Idade', 200, 50, 12),
    it('Ana', 50, 70, 12),  it('30', 200, 70, 12),
    it('Beto', 50, 90, 12), it('41', 200, 90, 12)
  ];
  ok(RC.isTableStrict(tbl) && RC.isTableStrict(tbl).length === 2, 'tabela: 3x2 real detectada (2 colunas)');

  // bloco de 1 linha nunca é tabela
  ok(RC.isTableStrict([ it('uma linha só', 50, 50, 12) ]) === null, 'tabela: 1 linha -> null');

  // contagem de colunas inconsistente (1ª linha 2 células, demais 1) -> null
  const inc = [ it('A', 50, 50, 12), it('B', 200, 50, 12), it('frase longa', 50, 70, 12), it('outra', 50, 90, 12) ];
  ok(RC.isTableStrict(inc) === null, 'tabela: colunas inconsistentes -> null');

  // item que atravessa o gutter (prosa larga) -> null
  const cross = [
    it('x', 50, 50, 12), it('y', 150, 50, 12), it('atravessa tudo', 40, 50, 12, { w: 140 }),
    it('x', 50, 70, 12), it('y', 150, 70, 12), it('atravessa tudo', 40, 70, 12, { w: 140 })
  ];
  ok(RC.isTableStrict(cross) === null, 'tabela: item cruzando gutter -> null');
}
```

- [ ] **Step 2: Run** `node test-convert.js` → FALHA: `RC.isTableStrict is not a function`.

- [ ] **Step 3: Implementação** — em `src/convert/reconstruct.js`:

(a) Substitua as funções `detectColumns` e `cellsFor` e `isTableBlock` (as três atuais) por estas quatro:

```js
function detectColumns(lines) {
  const xs = [];
  for (const l of lines) for (const it of l.items) xs.push(it.x);
  xs.sort((a, b) => a - b);
  const clusters = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.max <= 12) { last.max = x; last.xs.push(x); }
    else clusters.push({ max: x, xs: [x] });
  }
  return clusters.map(c => c.xs.reduce((a, b) => a + b, 0) / c.xs.length);
}

function assignCells(line, cols) {
  const cells = cols.map(() => '');
  for (const it of line.items) {
    let bi = 0, best = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c - it.x); if (d < best) { best = d; bi = i; } });
    cells[bi] += (cells[bi] ? ' ' : '') + emph(it).trim();
  }
  return cells.map(c => c.trim());
}

function hasGutters(lines, cols) {
  for (let i = 0; i < cols.length - 1; i++) {
    const b = (cols[i] + cols[i + 1]) / 2;
    let cross = 0;
    for (const l of lines) {
      for (const it of l.items) {
        if (it.x < b - 1 && (it.x + it.w) > b + 1) { cross++; break; }
      }
    }
    if (cross > lines.length * 0.3) return false;
  }
  return true;
}

// Retorna o array de colunas (centroides x) se o bloco for tabela; senão null.
function isTableStrict(lines) {
  if (!lines || lines.length < 2) return null;
  const cols = detectColumns(lines);
  if (cols.length < 2) return null;
  const rows = lines.map(l => assignCells(l, cols));
  const multi = rows.filter(c => c.filter(Boolean).length >= 2).length;
  if (multi < Math.max(2, Math.ceil(lines.length * 0.7))) return null;
  let filled = 0, total = 0;
  for (const c of rows) for (const cell of c) { total++; if (cell) filled++; }
  if (!total || filled / total < 0.5) return null;
  if (!hasGutters(lines, cols)) return null;
  return cols;
}
```

(b) A função `tableMarkdown` atual usa `cellsFor`; troque a chamada interna `cellsFor(l, cols)` por `assignCells(l, cols)`. (Se `tableMarkdown` referenciar `cellsFor`, atualize para `assignCells`.)

(c) Em `reconstructMarkdown`, onde hoje chama `const cols = block.length >= 2 ? isTableBlock(block) : null;`, troque por `const cols = isTableStrict(block);`.

(d) No `module.exports`, troque/garanta os exports: exporte `reconstructMarkdown, groupLines, isTableStrict` (remova `isTableBlock` do export se estiver lá).

- [ ] **Step 4: Run** `node test-convert.js` → "CONVERT OK", 0 falhas (a tabela 2x2 do bloco B4 continua passando: 2 colunas, células preenchidas, sem cruzamento de gutter).

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): detector de tabela estrito (mata falsos positivos)"
```

---

## Task R3: Reflow de parágrafos + des-hifenização (novo orquestrador `emitLines`)

**Files:**
- Modify: `src/convert/reconstruct.js` (adicionar `splitByGap`, `joinParagraph`, `emitLines`; reescrever o corpo de `reconstructMarkdown`)
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test** — antes do trailer:

```js
// ---- R3: reflow + des-hifenização ----
const RC3 = require('./src/convert/reconstruct.js');
{
  // duas linhas próximas do mesmo parágrafo -> uma linha contínua
  const md1 = RC3.reconstructMarkdown([ it('Primeira linha do', 50, 50, 12), it('mesmo parágrafo.', 50, 64, 12) ]);
  has(md1, 'Primeira linha do mesmo parágrafo.', 'reflow: junta linhas do mesmo parágrafo');

  // gap grande -> dois parágrafos separados
  const md2 = RC3.reconstructMarkdown([ it('Parágrafo um.', 50, 50, 12), it('Parágrafo dois.', 50, 120, 12) ]);
  has(md2, 'Parágrafo um.\n\nParágrafo dois.', 'reflow: gap grande separa parágrafos');

  // des-hifenização: "experi-" + "ência" -> "experiência"
  const md3 = RC3.reconstructMarkdown([ it('uma experi-', 50, 50, 12), it('ência boa', 50, 64, 12) ]);
  has(md3, 'experiência', 'reflow: des-hifeniza palavra quebrada');
  ok(!/experi-\s*ência/.test(md3) && !md3.includes('experi- '), 'reflow: remove o hífen de quebra');
}
```

Nota: `it` usa `y` crescente para baixo; gaps de 14 (linha) vs 70 (parágrafo) exercitam o limiar 1.5×.

- [ ] **Step 2: Run** `node test-convert.js` → FALHA em `reflow: junta linhas do mesmo parágrafo` (hoje cada linha vira parágrafo separado).

- [ ] **Step 3: Implementação** — em `src/convert/reconstruct.js`:

(a) Adicione os helpers:

```js
function maxFont(line) { return Math.max.apply(null, line.items.map(it => it.fontSize)); }

// Quebra um conjunto de linhas em sub-blocos separados por gaps de parágrafo.
function splitByGap(lines) {
  if (lines.length <= 1) return lines.length ? [lines] : [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const typ = sorted[Math.floor((sorted.length - 1) / 2)] || 0;
  const blocks = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    if (typ > 0 && gap > typ * 1.5) { blocks.push(cur); cur = [lines[i]]; }
    else cur.push(lines[i]);
  }
  blocks.push(cur);
  return blocks;
}

// Junta as linhas de um sub-bloco num único parágrafo (com des-hifenização).
function joinParagraph(lines) {
  let cur = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lineText(lines[i]);
    if (i === 0) { cur = t; continue; }
    if (/[a-zà-ÿ]-$/i.test(cur) && /^[a-zà-ÿ]/.test(t)) cur = cur.slice(0, -1) + t;
    else cur = cur + ' ' + t;
  }
  return cur;
}
```

(b) Adicione o orquestrador `emitLines` (processa as linhas de UMA coluna):

```js
function emitLines(lines, median) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const text = lineText(line);
    const h = headingHashes(maxFont(line), median);
    if (h) { out.push(h + text.replace(/\*{1,3}/g, '').trim()); i++; continue; }
    if (BULLET.test(text)) { out.push('- ' + text.replace(BULLET, '')); i++; continue; }
    // junta a sequência de linhas de corpo (até achar título/lista)
    let j = i;
    while (j < lines.length) {
      const lj = lines[j];
      if (headingHashes(maxFont(lj), median) || BULLET.test(lineText(lj))) break;
      j++;
    }
    for (const sb of splitByGap(lines.slice(i, j))) {
      const cols = isTableStrict(sb);
      if (cols) out.push(tableMarkdown(sb, cols).trimEnd());
      else out.push(joinParagraph(sb));
    }
    i = j;
  }
  return out;
}
```

(c) Reescreva o corpo de `reconstructMarkdown` (mantendo a assinatura) para usar `emitLines`:

```js
function reconstructMarkdown(items) {
  const clean = (items || []).filter(i => i && typeof i.str === 'string' && i.str.trim() !== '');
  if (!clean.length) return '';
  const median = medianFontSize(clean);
  const lines = groupLines(clean);
  const out = emitLines(lines, median);
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
```

(Remova o corpo antigo do laço `while` de `reconstructMarkdown` que emitia linha-a-linha — `emitLines` o substitui.)

- [ ] **Step 4: Run** `node test-convert.js` → "CONVERT OK", 0 falhas. Verifique que os testes B4 antigos seguem passando (heading, bullet, tabela 2x2, negrito) — a tabela 2x2 entra como um sub-bloco de `splitByGap` (gap único → 1 sub-bloco) e passa por `isTableStrict`.

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): reflow de parágrafos + des-hifenização (emitLines)"
```

---

## Task R4: Ordenação de leitura multi-coluna (`splitColumns`)

**Files:**
- Modify: `src/convert/reconstruct.js` (adicionar `splitColumns`; usar em `reconstructMarkdown`)
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test** — antes do trailer:

```js
// ---- R4: multi-coluna ----
const RC4 = require('./src/convert/reconstruct.js');
{
  // duas colunas: esquerda (x~50) e direita (x~400), calha vazia entre ~120 e ~380, ambas cobrindo a altura
  const items = [];
  for (let k = 0; k < 6; k++) { items.push(it('L' + k, 50, 30 + k * 40, 12)); items.push(it('R' + k, 400, 30 + k * 40, 12)); }
  const groups = RC4.splitColumns(items);
  ok(groups.length === 2, 'colunas: detecta 2 colunas');
  ok(groups[0].every(i => i.x < 200) && groups[1].every(i => i.x >= 200), 'colunas: separa esquerda/direita');

  // ordem de leitura: todo L antes de todo R no markdown
  const md = RC4.reconstructMarkdown(items);
  ok(md.indexOf('L5') < md.indexOf('R0'), 'colunas: lê coluna esquerda inteira antes da direita');

  // página de coluna única não é dividida
  const single = [];
  for (let k = 0; k < 8; k++) single.push(it('linha ' + k, 50, 30 + k * 20, 12));
  ok(RC4.splitColumns(single).length === 1, 'colunas: 1 coluna permanece única');
}
```

- [ ] **Step 2: Run** `node test-convert.js` → FALHA: `RC4.splitColumns is not a function`.

- [ ] **Step 3: Implementação** — em `src/convert/reconstruct.js`:

(a) Adicione `splitColumns`:

```js
// Divide os itens de uma página em colunas (ordem de leitura esquerda->direita).
// Retorna um array de arrays de itens; [items] se não houver layout multi-coluna claro.
function splitColumns(items) {
  if (items.length < 6) return [items];
  const minX = Math.min.apply(null, items.map(i => i.x));
  const maxX = Math.max.apply(null, items.map(i => i.x + i.w));
  const ys = items.map(i => i.y);
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const width = maxX - minX, vext = maxY - minY;
  if (width <= 0 || vext <= 0) return [items];
  const N = 100, bin = width / N;
  const cover = new Array(N).fill(0);
  for (const it of items) {
    const a = Math.max(0, Math.floor((it.x - minX) / bin));
    const b = Math.min(N - 1, Math.floor((it.x + it.w - minX) / bin));
    for (let k = a; k <= b; k++) cover[k]++;
  }
  const minGutter = Math.max(2, Math.ceil(N * 0.05));
  let best = null, run = 0, runStart = 0;
  for (let k = 0; k < N; k++) {
    if (cover[k] === 0) { if (run === 0) runStart = k; run++; }
    else {
      if (run >= minGutter && runStart > 0) {
        const c = { start: runStart, end: k - 1 };
        if (!best || (c.end - c.start) > (best.end - best.start)) best = c;
      }
      run = 0;
    }
  }
  if (!best) return [items];
  const gMid = minX + ((best.start + best.end + 1) / 2) * bin;
  const left = items.filter(i => (i.x + i.w / 2) < gMid);
  const right = items.filter(i => (i.x + i.w / 2) >= gMid);
  if (left.length < items.length * 0.2 || right.length < items.length * 0.2) return [items];
  const yext = arr => { const a = arr.map(i => i.y); return Math.max.apply(null, a) - Math.min.apply(null, a); };
  if (yext(left) < vext * 0.6 || yext(right) < vext * 0.6) return [items];
  return [...splitColumns(left), ...splitColumns(right)];
}
```

(b) Em `reconstructMarkdown`, processe coluna a coluna. Substitua o corpo por:

```js
function reconstructMarkdown(items) {
  const clean = (items || []).filter(i => i && typeof i.str === 'string' && i.str.trim() !== '');
  if (!clean.length) return '';
  const median = medianFontSize(clean);
  const out = [];
  for (const colItems of splitColumns(clean)) {
    out.push(...emitLines(groupLines(colItems), median));
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
```

(c) Adicione `splitColumns` ao `module.exports`.

- [ ] **Step 4: Run** `node test-convert.js` → "CONVERT OK", 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): ordenação de leitura multi-coluna (splitColumns)"
```

---

## Task R5: Remoção de cabeçalho/rodapé repetidos (`stripRunningHeadersFooters`)

**Files:**
- Modify: `src/convert/reconstruct.js` (adicionar e exportar `stripRunningHeadersFooters`)
- Test: `test-convert.js`

- [ ] **Step 1: Write the failing test** — antes do trailer:

```js
// ---- R5: cabeçalho/rodapé ----
const RC5 = require('./src/convert/reconstruct.js');
{
  function page(items, height) { return { items, height }; }
  // topo repetido "Relatório X" em 3 páginas (y=5, height=100 => faixa topo=12); conteúdo único no miolo
  const mk = (n) => page([ it('Relatório X', 50, 5, 10), it('Conteúdo ' + n, 50, 50, 12) ], 100);
  const stripped = RC5.stripRunningHeadersFooters([ mk(1), mk(2), mk(3) ]);
  const allText = stripped.map(p => p.items.map(i => i.str).join(' ')).join(' | ');
  ok(!allText.includes('Relatório X'), 'head/foot: remove cabeçalho repetido');
  ok(allText.includes('Conteúdo 1') && allText.includes('Conteúdo 3'), 'head/foot: mantém conteúdo do miolo');

  // número de página solitário no rodapé (y=95) é removido mesmo variando
  const pn = [
    page([ it('3', 50, 95, 10), it('miolo a', 50, 50, 12) ], 100),
    page([ it('4', 50, 95, 10), it('miolo b', 50, 50, 12) ], 100)
  ];
  const s2 = RC5.stripRunningHeadersFooters(pn);
  const t2 = s2.map(p => p.items.map(i => i.str).join(' ')).join(' | ');
  ok(!/\b[34]\b/.test(t2) && t2.includes('miolo a'), 'head/foot: remove número de página solitário');

  // linha de banda que aparece uma única vez (não repetida, não número) é mantida
  const once = [ page([ it('Aviso único', 50, 5, 10), it('corpo', 50, 50, 12) ], 100),
                 page([ it('corpo só', 50, 50, 12) ], 100) ];
  const s3 = RC5.stripRunningHeadersFooters(once);
  ok(s3.map(p => p.items.map(i => i.str).join(' ')).join(' ').includes('Aviso único'), 'head/foot: mantém banda não repetida');
}
```

- [ ] **Step 2: Run** `node test-convert.js` → FALHA: `RC5.stripRunningHeadersFooters is not a function`.

- [ ] **Step 3: Implementação** — em `src/convert/reconstruct.js`, adicione:

```js
function normHF(s) { return String(s).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim(); }

const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
function isPageNumKey(k) {
  if (!k) return false;
  if (k === '#') return true;                 // só dígitos
  if (/^p[áa]gina #$/.test(k)) return true;   // "página 3"
  if (ROMAN.test(k)) return true;             // numeração romana (i, ii, iv, ...)
  return false;
}

// pages: [{ items, height }]. Remove linhas repetidas nas faixas de topo/rodapé
// e números de página solitários. Devolve as páginas com itens filtrados.
function stripRunningHeadersFooters(pages) {
  const n = (pages || []).length;
  if (n < 2) return pages || [];
  const bandLines = pages.map(pg => {
    const h = pg.height || (pg.items.length ? Math.max.apply(null, pg.items.map(i => i.y)) : 0);
    const top = h * 0.12, bot = h * 0.88;
    return groupLines(pg.items).filter(l => l.y <= top || l.y >= bot);
  });
  const freq = new Map();
  for (const lines of bandLines) {
    const seen = new Set();
    for (const l of lines) {
      const key = normHF(lineText(l));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(n * 0.6));
  const repeated = new Set();
  for (const [k, c] of freq) if (c >= threshold) repeated.add(k);
  return pages.map(pg => {
    const h = pg.height || (pg.items.length ? Math.max.apply(null, pg.items.map(i => i.y)) : 0);
    const top = h * 0.12, bot = h * 0.88;
    const remove = new Set();
    for (const l of groupLines(pg.items)) {
      if (!(l.y <= top || l.y >= bot)) continue;
      const key = normHF(lineText(l));
      if (repeated.has(key) || isPageNumKey(key)) for (const it of l.items) remove.add(it);
    }
    return { items: pg.items.filter(it => !remove.has(it)), height: pg.height };
  });
}
```

Adicione `stripRunningHeadersFooters` ao `module.exports`.

- [ ] **Step 4: Run** `node test-convert.js` → "CONVERT OK", 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): remove cabeçalho/rodapé e número de página repetidos"
```

---

## Task R6: Dispatcher `convertPdf` em duas passagens + rebuild do bundle

**Files:**
- Modify: `src/convert/index.js` (função `convertPdf`)
- Build: `renderer/vendor/convert.bundle.js` (rebuild)

- [ ] **Step 1: Implementação** — em `src/convert/index.js`:

(a) No topo, garanta que `stripRunningHeadersFooters` é importado junto de `reconstructMarkdown`:

```js
const { reconstructMarkdown, stripRunningHeadersFooters } = require('./reconstruct.js');
```

(b) Substitua a função `convertPdf` inteira por esta versão em duas passagens (primeiro coleta itens/altura de cada página de texto e marca páginas de OCR; depois remove cabeçalho/rodapé entre as páginas de texto; por fim gera o markdown na ordem original):

```js
async function convertPdf(bytes, opts) {
  opts = opts || {};
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  // passagem 1: classificar páginas
  const pageInfo = []; // { type:'text', items, height } | { type:'ocr', page }
  for (let p = 1; p <= doc.numPages; p++) {
    if (opts.signal && opts.signal.aborted) throw new Error('Cancelado');
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const text = tc.items.map(i => i.str).join('').trim();
    if (text.length >= 10) {
      pageInfo.push({ type: 'text', items: normItems(tc, viewport), height: viewport.height });
    } else {
      pageInfo.push({ type: 'ocr', page });
    }
  }
  // remover cabeçalho/rodapé entre as páginas de texto
  const textPages = pageInfo.filter(p => p.type === 'text');
  const stripped = stripRunningHeadersFooters(textPages.map(p => ({ items: p.items, height: p.height })));
  let ti = 0;
  for (const info of pageInfo) if (info.type === 'text') { info.items = stripped[ti].items; ti++; }
  // passagem 2: gerar markdown na ordem original
  const parts = [];
  let pageNo = 0;
  for (const info of pageInfo) {
    pageNo++;
    if (info.type === 'text') {
      parts.push(reconstructMarkdown(info.items));
    } else {
      if (opts.onStatus) opts.onStatus('OCR na página ' + pageNo + '/' + doc.numPages + '…');
      const url = await pageToDataUrl(info.page, 2);
      const ocr = await ocrDataUrl(url, opts.onProgress);
      parts.push(ocr.trim());
    }
  }
  const markdown = parts.filter(Boolean).join('\n\n');
  return { markdown, images: [], meta: { title: firstHeading(markdown) } };
}
```

(Mantenha `normItems`, `pageToDataUrl`, `ocrDataUrl`, `firstHeading`, `convertDocx`, `convert` e os exports como estão.)

- [ ] **Step 2: Rebuild do bundle**

Run: `npm run build:convert`
Expected: gera `renderer/vendor/convert.bundle.js` sem erros do esbuild (e copia os assets). Confirme o tamanho com:
`node -e "const s=require('fs').readFileSync('renderer/vendor/convert.bundle.js','utf8');console.log('OKFConvert', s.includes('OKFConvert'),'bytes',s.length)"`

- [ ] **Step 3: Smoke do renderer (não-OCR) segue verde**

Run: `npm run test:convert-ui`
Expected: `CONVERT UI SMOKE OK` (o bundle carrega sob a CSP e converte TXT/HTML — prova que o bundle reconstruído não quebrou). Os testes unitários puros: `node test-convert.js` → `CONVERT OK`.

- [ ] **Step 4: Commit** (não adicione `renderer/vendor/*` — é gitignored)

```bash
git add src/convert/index.js
git commit -m "feat(pdf): convertPdf em duas passagens (remove head/foot entre páginas)"
```

---

## Task R7: Harness de QA + medição no corpus real

**Files:**
- Add (commit): `tools/pdf2md-cli.mjs` (já existe no working tree)
- Modify: `package.json` (script `diag:pdf`)

- [ ] **Step 1: Confirme o harness existente**

O arquivo `tools/pdf2md-cli.mjs` já existe (uso: `node tools/pdf2md-cli.mjs <in.pdf> <out.md>`; usa pdf.js em Node + `reconstructMarkdown`). Verifique que roda:

Run (com um PDF de exemplo qualquer do usuário, caminho entre aspas):
`node tools/pdf2md-cli.mjs "<algum>.pdf" ".pdf-diag/out.md"`
Expected: imprime `OK <N> págs … -> .pdf-diag/out.md`.

- [ ] **Step 2: Adicione um script de conveniência** em `package.json` `scripts`, após `test:convert-ui`:

```json
    "diag:pdf": "node tools/pdf2md-cli.mjs",
```

- [ ] **Step 3: Medição antes/depois no corpus real**

Converta os 6 PDFs do usuário (em `C:\Users\alexa\OneDrive - …\REFERENCIAS\AVALIACAO-IMOVEIS\`) para `.pdf-diag/` e meça as melhorias. Compare contra os números do diagnóstico inicial (IN_SPU_43: 17 linhas `| --- |`; NBR_14653-2: 48 linhas `| --- |` e rodapé "Exemplar para uso exclusivo…/© ABNT" em toda página). Critérios de sucesso (registre os números observados no relatório, NÃO commitar as saídas — `.pdf-diag/` é gitignored):
  - Linhas `| --- |` (tabelas) caem drasticamente nos dois (objetivo: só tabelas reais restam; ex.: dezenas → poucas/zero).
  - As linhas de rodapé repetidas (`Exemplar para uso exclusivo …`, `© ABNT … reservados`) somem na NBR.
  - Texto sai em parágrafos contínuos (não linha-a-linha).
Se algum critério não melhorar, ajuste os limiares em `reconstruct.js` (ex.: tolerância de cluster de coluna, fração de gutter, limiar de gap de parágrafo, threshold de repetição) e re-meça. Documente quaisquer ajustes de constante no commit.

- [ ] **Step 4: Commit** (o harness e o script; saídas `.pdf-diag/` ficam fora)

```bash
git add tools/pdf2md-cli.mjs package.json
git commit -m "test(pdf): harness de diagnóstico + script diag:pdf"
```

---

## Self-Review

**1. Cobertura da spec:**
- Ligaduras → R1. Tabela estrita → R2. Reflow + des-hifenização → R3. Multi-coluna → R4. Cabeçalho/rodapé → R5. Dispatcher 2 passagens → R6. QA corpus real + harness → R7. ✔ todas as seções da spec têm tarefa.

**2. Placeholder scan:** sem TBD/TODO; todo passo de código tem o código completo; testes com asserções reais. ✔

**3. Consistência de tipos/nomes:** `reconstructMarkdown(items)`, `stripRunningHeadersFooters(pages: {items,height}[])`, helpers `splitColumns`/`isTableStrict`/`splitByGap`/`joinParagraph`/`emitLines`/`assignCells`/`hasGutters`/`detectColumns`/`maxFont`/`lineText`/`emph`/`medianFontSize`/`headingHashes`/`tableMarkdown`/`groupLines`/`BULLET`. `tableMarkdown` passa a usar `assignCells` (R2). `module.exports` acumula: `reconstructMarkdown, groupLines, isTableStrict, splitColumns, stripRunningHeadersFooters`. O dispatcher importa `reconstructMarkdown` + `stripRunningHeadersFooters`. ✔

**Notas de risco:** os limiares (cluster 12px, gutter 5%, gap 1.5×, repetição 60%, faixa 12%) são pontos de calibração; R7 os ajusta contra o corpus real. Tabelas sem grade/mescladas e títulos por negrito permanecem fora do escopo.
