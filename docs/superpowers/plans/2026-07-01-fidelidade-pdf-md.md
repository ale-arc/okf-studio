# Fidelidade PDF→MD — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir na raiz os defeitos de fidelidade da conversão PDF→Markdown (espaços perdidos, capa partida, blockquotes falsos, TOC ilegível, níveis de título) mantendo o motor 100% local/heurístico, com testes golden.

**Architecture:** Novo módulo `src/convert/spacing.js` (decisão de espaço entre itens, função pura). `normItems` (em `src/convert/index.js`) passa a absorver itens só-espaço do pdf.js como flag `spaceBefore` no item seguinte e é exportado (o CLI de diagnóstico reutiliza, eliminando drift). `reconstruct.js` usa a nova decisão de espaço, ganha mediana de fonte ponderada por caracteres, detecção de linha de TOC, mesclagem de títulos adjacentes, regra estrita de blockquote, e emite um modelo de blocos leve `{type, text}` serializado ao final. Harness golden (`test-convert-golden.js`) compara a conversão das PDFs de `sample-library/pdf-test/` com snapshots `.golden.md` versionados.

**Tech Stack:** Node (CJS), pdfjs-dist (legacy), harness de teste caseiro (`ok/has`, sem framework). Spec: `docs/superpowers/specs/2026-07-01-fidelidade-pdf-md-design.md`.

**Convenções:** comentários/mensagens em pt-BR, seguindo o estilo do repo. Testes rodam com `node test-convert.js`. Commit após cada task.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `src/convert/spacing.js` | criar | decisão de espaço entre itens de uma linha (puro, testável) |
| `src/convert/index.js` | modificar | `normItems` absorve itens só-espaço → `spaceBefore`; exporta `normItems` |
| `src/convert/reconstruct.js` | modificar | usa `needsSpace`; mediana ponderada; TOC; mescla de títulos; blockquote estrito; modelo de blocos + serializador |
| `tools/pdf2md-cli.mjs` | modificar | passa a usar o `normItems` exportado (fim do drift) |
| `test-convert.js` | modificar | novos casos unitários (spacing, TOC, capa, quote, mediana) |
| `test-convert-golden.js` | criar | snapshots golden das PDFs de `sample-library/pdf-test/` |
| `sample-library/pdf-test/*.golden.md` | criar | snapshots versionados |
| `package.json` | modificar | `npm test` inclui o golden |

**Não commitar** as 5 normas ABNT/SPU (direitos autorais; uso só local para diagnóstico).

---

### Task 1: módulo `spacing.js`

**Files:**
- Create: `src/convert/spacing.js`
- Test: `test-convert.js` (novo bloco no fim, antes do sumário final)

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test-convert.js`, logo antes de `console.log(\`\n${n} checagens, ...\`)`:

```js
// ---- F1: spacing (decisão de espaço entre itens) ----
const SP = require('./src/convert/spacing.js');
{
  ok(Math.abs(SP.lineAvgCharW([{ str: 'abcd', w: 22 }, { str: 'ef', w: 11 }]) - 5.5) < 1e-9,
    'spacing: avanço médio por caractere da linha');

  const a = { str: 'Termos,', x: 50, w: 40, fontSize: 11 };
  ok(SP.needsSpace(a, { str: 'definições', x: 90.8, w: 55, fontSize: 11, spaceBefore: true }, 5.5),
    'spacing: spaceBefore explícito força espaço mesmo com gap ~0');
  ok(!SP.needsSpace(a, { str: 'definições', x: 90.8, w: 55, fontSize: 11 }, 5.5),
    'spacing: gap ~0.8pt sem sinal explícito não vira espaço');
  ok(SP.needsSpace(a, { str: 'palavra', x: 95, w: 40, fontSize: 11 }, 5.5),
    'spacing: gap 5pt (> 0.5×avanço médio) vira espaço');
  ok(!SP.needsSpace({ str: 'Olá ', x: 50, w: 20, fontSize: 11 },
    { str: 'mundo', x: 74, w: 30, fontSize: 11, spaceBefore: true }, 5.5),
    'spacing: espaço já embutido no str não duplica');
  ok(!SP.needsSpace({ str: 'cientí', x: 50, w: 36, fontSize: 12 },
    { str: 'fi', x: 88, w: 12, fontSize: 12 }, 6),
    'spacing: fragmento de ligadura exige gap maior (0.6×fonte)');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL — `Cannot find module './src/convert/spacing.js'`

- [ ] **Step 3: Implementar `src/convert/spacing.js`**

```js
// src/convert/spacing.js — decide se há espaço entre itens de texto adjacentes numa linha.
// Combina três sinais, em ordem de confiança:
//   1. espaço já embutido no str (fim do anterior / início do atual) -> não duplicar;
//   2. item só-espaço do pdf.js absorvido como flag `spaceBefore` (ver normItems);
//   3. gap geométrico relativo ao avanço médio de caractere da própria linha
//      (não um limiar fixo de 0.3×fonte, que engole espaços estreitos).
'use strict';

const LIGATURE = /^(fi|fl|ff|ffi|ffl|ﬀ|ﬁ|ﬂ|ﬃ|ﬄ)$/i;

// Avanço médio por caractere dos itens de uma linha (0 se não houver texto).
function lineAvgCharW(items) {
  let w = 0, n = 0;
  for (const it of items || []) {
    const s = it.str || '';
    if (!s.trim()) continue;
    w += it.w || 0; n += s.length;
  }
  return n ? w / n : 0;
}

// Há espaço entre prev e it? (mesma linha, ordem de leitura)
function needsSpace(prev, it, avgCharW) {
  if (!prev) return false;
  if (/\s$/.test(prev.str) || /^\s/.test(it.str)) return false; // já está no str
  if (it.spaceBefore) return true;
  const gap = it.x - (prev.x + prev.w);
  const lig = LIGATURE.test(it.str.trim()) || LIGATURE.test(prev.str.trim());
  if (lig) return gap > 0.6 * prev.fontSize;
  const cw = avgCharW || (prev.fontSize || 12) * 0.5;
  return gap > Math.max(1.0, 0.5 * cw);
}

module.exports = { lineAvgCharW, needsSpace, LIGATURE };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-convert.js`
Expected: PASS (`CONVERT OK`, 0 falhas)

- [ ] **Step 5: Commit**

```bash
git add src/convert/spacing.js test-convert.js
git commit -m "feat(pdf): módulo spacing — decisão de espaço por 3 sinais"
```

---

### Task 2: `normItems` absorve itens só-espaço; `reconstruct` usa `needsSpace`

**Files:**
- Modify: `src/convert/index.js` (função `normItems`, `splitTextItemsByLinks`, exports)
- Modify: `src/convert/reconstruct.js` (`lineRawText`, `lineFormattedText`)
- Modify: `tools/pdf2md-cli.mjs` (usa `normItems` exportado)
- Test: `test-convert.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test-convert.js` após o bloco F1:

```js
// ---- F2: spaceBefore atravessa a reconstrução ----
{
  // simula o TOC da NBR: espaço com avanço ~0 -> pdf.js emite item de espaço à parte,
  // que normItems converte em spaceBefore no item seguinte.
  const md = reconstructMarkdown([
    it('Termos,', 50, 50, 12),
    Object.assign(it('definições', 92.3, 50, 12), { spaceBefore: true }),
    Object.assign(it('e', 153, 50, 12), { spaceBefore: true }),
    Object.assign(it('símbolos', 160, 50, 12), { spaceBefore: true })
  ]);
  has(md, 'Termos, definições e símbolos', 'spaceBefore: palavras não colam');
}
```

Nota: o helper `it()` dá `w = len × fontSize × 0.5`; os `x` acima deixam gaps < 1pt entre os itens, então sem `spaceBefore` as palavras colariam (é o bug real).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL — `spaceBefore: palavras não colam (faltou: Termos, definições e símbolos)`

- [ ] **Step 3: Implementar**

**(a)** Em `src/convert/index.js`, substituir a função `normItems` inteira por:

```js
function normItems(textContent, viewport) {
  const out = [];
  let pendingSpace = false;
  for (const it of textContent.items) {
    if (!it.str) continue;
    const tr = pdfjs.Util.transform(viewport.transform, it.transform);
    const x = tr[4];
    const y = tr[5];
    const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 12;
    // Item só-espaço: o pdf.js costuma emitir o espaço como item separado, às
    // vezes com avanço ~0. Não descartar o sinal: vira flag no item seguinte.
    if (!it.str.trim()) { pendingSpace = true; continue; }
    const name = (it.fontName || '').toLowerCase();
    const mono = /courier|consolas|mono|code|sfmono|liberationmono|lucida.*console|source.*code/i.test(name);
    out.push({
      str: it.str, x, y, w: it.width || it.str.length * fontSize * 0.5, h: it.height || fontSize,
      fontSize, bold: /bold|black|semibold|heavy|demi|ultra/.test(name), italic: /italic|oblique|obli/.test(name) || Math.abs((it.transform||[])[1]||0) > 0.12,
      mono, spaceBefore: pendingSpace
    });
    pendingSpace = false;
  }
  return out;
}
```

**(b)** Em `src/convert/index.js`, na função `splitTextItemsByLinks`, o push do segmento passa a zerar `spaceBefore` nos segmentos que não são o início do item (senão um espaço apareceria no meio da palavra no limite do link). Trocar o `out.push({ ...it, str: segStr, x: segX, w: segW, link: charLinks[start] });` por:

```js
      out.push({
        ...it,
        str: segStr,
        x: segX,
        w: segW,
        link: charLinks[start],
        spaceBefore: start === 0 ? it.spaceBefore : false
      });
```

**(c)** Em `src/convert/index.js`, exportar `normItems`:

```js
module.exports = { convert, slugifyAsset, rewriteImageLinks, txtToMarkdown, htmlToMarkdown, normItems };
```

**(d)** Em `src/convert/reconstruct.js`: importar no topo (após `'use strict';`):

```js
const { lineAvgCharW, needsSpace } = require('./spacing.js');
```

Substituir `lineRawText` por:

```js
function lineRawText(line) {
  const cw = lineAvgCharW(line.items);
  let out = '';
  let prev = null;
  for (const it of line.items) {
    if (prev && needsSpace(prev, it, cw)) out += ' ';
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}
```

Remover a constante `LIGATURE` local de `reconstruct.js` (agora vive em `spacing.js`).

Em `lineFormattedText`, substituir o cálculo de `needSpace` (as 3 linhas `const gap = ...; const ligature = ...; const thresh = ...; const needSpace = gap > thresh;`) por:

```js
      const needSpace = needsSpace(prev, it, cw);
```

e, no início da função, logo após o guard `if (!line.items || !line.items.length) return '';`, adicionar:

```js
  const cw = lineAvgCharW(line.items);
```

**(e)** Em `tools/pdf2md-cli.mjs`, apagar a função `normItems` local e usar a exportada — trocar a linha do require de `reconstruct.js` por:

```js
const { reconstructMarkdown, stripRunningHeadersFooters } = require('../src/convert/reconstruct.js');
const { normItems } = require('../src/convert/index.js');
```

(A chamada `normItems(tc, viewport)` já existente continua igual. O `import` de pdfjs do CLI permanece — só a normalização é compartilhada.)

- [ ] **Step 4: Rodar e ver passar (inclui regressões)**

Run: `node test-convert.js && node test-okf.js`
Expected: PASS em ambos (nenhuma regressão de ligadura/link/tabela)

- [ ] **Step 5: Smoke do CLI num PDF local (não versionado)**

Run: `node tools/pdf2md-cli.mjs "C:\Users\alexa\OneDrive - Ministério da Gestão e da Inovação dos Serv. Pub\REFERENCIAS\AVALIACAO-IMOVEIS\NBR_14653-1-2019_Procedimentos-Gerais.pdf" "<scratchpad>\nbr1-t2.md"`
Expected: `OK 31 págs`; no arquivo, `grep -c "seabreviaturas"` = 0 e `grep -c "símbolos e abreviaturas"` ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add src/convert/index.js src/convert/reconstruct.js tools/pdf2md-cli.mjs test-convert.js
git commit -m "fix(pdf): não descartar itens de espaço do pdf.js (causa-raiz das palavras coladas)"
```

---

### Task 3: modelo de blocos leve + serializador (refactor sem mudança de comportamento)

**Files:**
- Modify: `src/convert/reconstruct.js` (`emitLines`, `reconstructMarkdown`)

- [ ] **Step 1: Refatorar `emitLines` para blocos tipados**

`emitLines` mantém a mesma lógica, mas cada `out.push('<string>')` vira um bloco `{ type, text }`:

- heading: `out.push({ type: 'heading', text: h + rawText.trim() })`
- régua: `out.push({ type: 'rule', text: '---' })`
- lista: `out.push({ type: 'list', text: indent + newBullet + content })`
- tabela: `out.push({ type: 'table', text: tableMarkdown(sb, cols).trimEnd() })`
- código: `out.push({ type: 'code', text: '```\n' + codeLines.join('\n') + '\n```' })`
- citação: `out.push({ type: 'quote', text: '> ' + joinParagraph(sb, median) })`
- parágrafo (fallback conservador): `out.push({ type: 'paragraph', text: joinParagraph(sb, median) })`

Adicionar o serializador (antes de `reconstructMarkdown`):

```js
// Serializa o modelo de blocos em Markdown. Blocos de lista/TOC adjacentes
// colapsam com quebra simples (lista compacta); o resto separa com linha em branco.
function serializeBlocks(blocks) {
  const parts = [];
  for (const b of blocks) {
    const last = parts[parts.length - 1];
    if (last && (b.type === 'list' || b.type === 'toc') && last.type === b.type) {
      last.text += '\n' + b.text;
    } else {
      parts.push({ type: b.type, text: b.text });
    }
  }
  return parts.map(p => p.text).join('\n\n');
}
```

E `reconstructMarkdown` passa a:

```js
function reconstructMarkdown(items) {
  const clean = (items || []).filter(i => i && typeof i.str === 'string' && i.str.trim() !== '');
  if (!clean.length) return '';
  const median = medianFontSize(clean);
  const blocks = [];
  for (const colItems of splitColumns(clean)) {
    blocks.push(...emitLines(groupLines(colItems), median));
  }
  return serializeBlocks(blocks).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
```

- [ ] **Step 2: Rodar todos os testes (deve ser no-op comportamental)**

Run: `node test-convert.js`
Expected: PASS — mesmas checagens verdes de antes (a única diferença visível é lista compacta, que os testes `has(...)` já toleram)

- [ ] **Step 3: Commit**

```bash
git add src/convert/reconstruct.js
git commit -m "refactor(pdf): emitLines produz blocos tipados + serializador (regra conservadora isolada)"
```

---

### Task 4: mediana de fonte ponderada por caracteres

**Files:**
- Modify: `src/convert/reconstruct.js` (`medianFontSize`)
- Test: `test-convert.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// ---- F3: mediana ponderada por caracteres ----
{
  // 3 itens curtos de título (20pt) vs 1 parágrafo longo (10pt): a mediana
  // simples cairia em 20 (título não vira heading); a ponderada cai em 10.
  const mdW = reconstructMarkdown([
    it('RELATÓRIO', 50, 40, 20),
    it('ANUAL', 160, 40, 20),
    it('DE 2019', 240, 40, 20),
    it('Corpo do documento com texto longo o bastante para dominar a mediana ponderada por caracteres.', 50, 120, 10)
  ]);
  has(mdW, '# RELATÓRIO ANUAL DE 2019', 'median: ponderada por caracteres calibra heading pelo corpo');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL — sem `#` na linha do título

- [ ] **Step 3: Implementar**

Substituir `medianFontSize` em `reconstruct.js`:

```js
// Mediana de fontSize ponderada pelo nº de caracteres: o corpo do texto domina,
// então capa/front-matter com fontes grandes não distorce a referência.
function medianFontSize(items) {
  const entries = [];
  let total = 0;
  for (const it of items) {
    const len = ((it.str || '').trim()).length;
    if (!len) continue;
    entries.push([it.fontSize, len]);
    total += len;
  }
  if (!total) return 12;
  entries.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const e of entries) { acc += e[1]; if (acc >= total / 2) return e[0]; }
  return entries[entries.length - 1][0];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-convert.js`
Expected: PASS (as checagens antigas de heading continuam verdes)

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "fix(pdf): mediana de fonte ponderada por caracteres (níveis de título estáveis)"
```

---

### Task 5: linhas de sumário (TOC) com pontilhado

**Files:**
- Modify: `src/convert/reconstruct.js` (`emitLines`)
- Test: `test-convert.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// ---- F4: sumário com pontilhados ----
{
  const mdToc = reconstructMarkdown([
    it('Prefácio', 50, 50, 12),
    it('....................v', 110, 50, 12),
    it('1', 50, 70, 12),
    it('Escopo', 80, 70, 12),
    it('.................1', 130, 70, 12)
  ]);
  has(mdToc, '- Prefácio — v', 'toc: entrada com pontilhado vira item de lista');
  has(mdToc, '- 1 Escopo — 1', 'toc: entrada numerada preserva número da seção');
  ok(!mdToc.includes('....'), 'toc: pontilhados removidos');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL nas 3 checagens de toc

- [ ] **Step 3: Implementar**

Em `reconstruct.js`, adicionar perto de `const BULLET = ...`:

```js
// Linha de sumário: "Título ......... 12" (nº de página arábico ou romano).
const TOC_LINE = /^(.*?)\s*\.{4,}\s*([ivxlcdm]+|\d+)\s*$/i;
function tocEntry(rawText) {
  const m = rawText.match(TOC_LINE);
  if (!m || !m[1].trim()) return null;
  return '- ' + m[1].trim() + ' — ' + m[2];
}
```

Em `emitLines`, depois do check de régua (`--- `) e antes do check de bullet, inserir:

```js
    const toc = tocEntry(rawText);
    if (toc) { out.push({ type: 'toc', text: toc }); i++; continue; }
```

E no loop `j` de acumulação de parágrafo, ampliar a condição de break:

```js
      if (headingHashes(maxFont(lj), median) || BULLET.test(rawLj) || TOC_LINE.test(rawLj)) break;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-convert.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): sumário com pontilhado vira lista legível (não parágrafo gigante)"
```

---

### Task 6: mesclagem de linhas de título adjacentes (capa)

**Files:**
- Modify: `src/convert/reconstruct.js` (`emitLines`, ramo de heading)
- Test: `test-convert.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// ---- F5: capa — linhas de título adjacentes mesclam ----
{
  const mdCover = reconstructMarkdown([
    it('NORMA', 50, 50, 24),
    it('BRASILEIRA', 50, 80, 24),
    it('Corpo do texto depois do título com tamanho normal e comprimento suficiente.', 50, 200, 12)
  ]);
  has(mdCover, '# NORMA BRASILEIRA', 'capa: linhas de título adjacentes viram um único heading');
  ok((mdCover.match(/^# /gm) || []).length === 1, 'capa: exatamente um H1');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL — saem dois `# ` separados

- [ ] **Step 3: Implementar**

Em `emitLines`, substituir o ramo `if (h) { out.push(...); i++; continue; }` por:

```js
    if (h) {
      // Mescla linhas de título adjacentes do MESMO nível e verticalmente
      // próximas (ex.: capa com o título quebrado em 2-3 linhas).
      let text = rawText.trim();
      let k = i + 1;
      while (k < lines.length) {
        const ln = lines[k];
        const hh = headingHashes(maxFont(ln), median);
        const gap = ln.y - lines[k - 1].y;
        if (hh !== h || gap > 1.8 * maxFont(ln)) break;
        text += ' ' + lineRawText(ln).trim();
        k++;
      }
      out.push({ type: 'heading', text: h + text });
      i = k;
      continue;
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test-convert.js`
Expected: PASS (o teste antigo `# Capítulo 1` segue verde: linha única, próximo item é corpo 12pt)

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "feat(pdf): mescla linhas de título adjacentes (capa vira um heading só)"
```

---

### Task 7: blockquote estrito (mata os falsos da capa)

**Files:**
- Modify: `src/convert/reconstruct.js` (`emitLines`, ramo de blockquote)
- Test: `test-convert.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// ---- F6: blockquote estrito ----
{
  // item deslocado demais (metadado de capa à direita) NÃO é citação
  const mdMeta = reconstructMarkdown([
    it('Texto do corpo na margem esquerda com comprimento razoável.', 50, 50, 12),
    it('Segunda edição 27.06.2019', 420, 120, 12)
  ]);
  ok(!mdMeta.includes('>'), 'quote: item deslocado demais (capa) não vira blockquote');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test-convert.js`
Expected: FAIL — `> Segunda edição 27.06.2019` aparece

- [ ] **Step 3: Implementar**

Em `emitLines`, substituir o cálculo `const avgX = ...; const isBlockquote = (avgX - leftMargin) > 25;` por:

```js
          // Citação: recuo moderado E consistente entre as linhas do bloco.
          // Recuo gigante (> 90pt) é posicionamento de capa/coluna, não citação.
          const xs = sb.map(l => ((l.items && l.items[0] && l.items[0].x) || leftMargin));
          const indent = Math.min.apply(null, xs) - leftMargin;
          const aligned = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) <= 6;
          const isBlockquote = aligned && indent > 25 && indent <= 90;
```

- [ ] **Step 4: Rodar e ver passar (regressão R8 nº 5 inclusa)**

Run: `node test-convert.js`
Expected: PASS — o teste antigo de blockquote legítimo (recuo 30pt, alinhado) continua verde

- [ ] **Step 5: Commit**

```bash
git add src/convert/reconstruct.js test-convert.js
git commit -m "fix(pdf): blockquote exige recuo moderado e alinhado (mata falsos da capa)"
```

---

### Task 8: harness golden com as PDFs de `sample-library/pdf-test/`

**Files:**
- Create: `test-convert-golden.js`
- Create: `sample-library/pdf-test/*.golden.md` (gerados)
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o harness**

```js
// test-convert-golden.js — snapshots golden do caminho de texto PDF->MD.
// Compara a conversão das PDFs de sample-library/pdf-test com *.golden.md.
// Para regravar após mudança intencional: UPDATE_GOLDEN=1 node test-convert-golden.js
const fs = require('fs');
const path = require('path');
const { convert } = require('./src/convert/index.js');

const dir = path.join(__dirname, 'sample-library', 'pdf-test');
const update = process.env.UPDATE_GOLDEN === '1';

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  if (!files.length) { console.error('sem PDFs em', dir); process.exit(1); }
  let fail = 0;
  for (const f of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const res = await convert(bytes, 'pdf', {});
    const md = res.markdown || '';
    const gPath = path.join(dir, f.replace(/\.pdf$/, '.golden.md'));
    if (update || !fs.existsSync(gPath)) {
      fs.writeFileSync(gPath, md);
      console.log('golden gravado:', path.basename(gPath), '(' + md.length + ' chars)');
      continue;
    }
    const want = fs.readFileSync(gPath, 'utf8');
    if (md === want) { console.log('OK', f); continue; }
    fail++;
    let i = 0;
    while (i < Math.min(md.length, want.length) && md[i] === want[i]) i++;
    console.error('FAIL ' + f + ': diverge no char ' + i);
    console.error('  golden:', JSON.stringify(want.slice(Math.max(0, i - 40), i + 40)));
    console.error('  atual :', JSON.stringify(md.slice(Math.max(0, i - 40), i + 40)));
  }
  if (fail) { console.error(fail + ' golden(s) divergiram — revise o diff; UPDATE_GOLDEN=1 para regravar'); process.exit(1); }
  console.log('GOLDEN OK');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Gerar os goldens e revisar**

Run: `node test-convert-golden.js` (primeira execução grava)
Depois: abrir 1-2 `.golden.md` e conferir contra os critérios do spec (sem palavras coladas, TOC como lista, sem `>` falso na capa, um H1 na capa).

- [ ] **Step 3: Rodar de novo (agora compara) e ver passar**

Run: `node test-convert-golden.js`
Expected: `OK` para cada PDF + `GOLDEN OK`

- [ ] **Step 4: Integrar ao `npm test`**

Em `package.json`, no script `test`, acrescentar `&& node test-convert-golden.js` ao final da cadeia existente.

Run: `npm test`
Expected: cadeia inteira verde

- [ ] **Step 5: Commit**

```bash
git add test-convert-golden.js sample-library/pdf-test/*.golden.md package.json
git commit -m "test(pdf): harness golden com snapshots das PDFs de sample-library"
```

---

### Task 9: diagnóstico nas 5 normas (local, sem commit)

**Files:** nenhum arquivo versionado — saída no scratchpad da sessão.

- [ ] **Step 1: Converter as 5 normas**

Para cada PDF em `C:\Users\alexa\OneDrive - Ministério da Gestão e da Inovação dos Serv. Pub\REFERENCIAS\AVALIACAO-IMOVEIS\`:

Run: `node tools/pdf2md-cli.mjs "<pdf>" "<scratchpad>\<nome>.md"`
Expected: `OK <n> págs` para os 5 (os 2 escaneados terão páginas OCR puladas no harness — esperado).

- [ ] **Step 2: Verificar os critérios de aceitação do spec**

Na NBR 14653-1 convertida:
- `grep -c "seabreviaturas"` → 0; `grep -c "símbolos e abreviaturas"` → ≥ 1
- `grep -c "Classificaçãodos"` → 0
- `grep -cE "^- .* — ([0-9]+|[ivxlcdm]+)$"` → > 10 (TOC virou lista)
- `grep -c "^> "` → 0 nas ~30 primeiras linhas (capa sem quote falso)
- H1s: `grep -c "^# "` → 1 na parte da capa

Nas demais (14653-2, 16747): amostragem visual de 2-3 seções + mesmas greps de palavras coladas.

- [ ] **Step 3: Cobertura de caracteres (aceitação nº 5)**

Comparar `chars` reportados pelo CLI antes/depois (o CLI imprime o total): a saída nova não pode ser menor que ~90% da antiga (perda de texto). Guardar os números no relato final.

Se algum critério falhar: voltar à task correspondente, ajustar limiar, rodar `node test-convert.js` + regravar goldens (`UPDATE_GOLDEN=1`), commitar o ajuste.

---

### Task 10: build, suíte completa e integração

**Files:**
- Modify (gerado): `renderer/vendor/convert.bundle.js`

- [ ] **Step 1: Rebuild do bundle do renderer**

Run: `npm run build:convert`
Expected: esbuild OK, bundle regenerado

- [ ] **Step 2: Suíte completa**

Run: `npm test`
Expected: tudo verde (inclui convert + golden)

Run: `npm run test:ui`
Expected: verde (smoke do renderer no Electron)

- [ ] **Step 3: Commit final do bundle (se versionado) e limpeza**

```bash
git status --short
# commitar apenas o que for artefato versionado do repo (ex.: bundle, se o repo o versiona)
```

- [ ] **Step 4: Finalizar a branch**

Usar a skill `superpowers:finishing-a-development-branch`: push da branch `feat/fidelidade-pdf-md` e abertura de PR para `main` (fluxo do usuário: integração via PR), com resumo dos defeitos corrigidos + números do diagnóstico (antes/depois).

---

## Self-review (feito na escrita)

- **Cobertura do spec:** espaçamento (T1-T2), modelo de blocos (T3), mediana/títulos (T4), TOC (T5), capa (T6), blockquote (T7), golden (T8), diagnóstico local + critérios de aceitação (T9), normItems compartilhado com o CLI (T2e), não commitar as normas (T9 é local). ✔
- **Placeholders:** nenhum "TBD"; todo step de código tem o código. ✔
- **Consistência de tipos:** `needsSpace(prev, it, avgCharW)` e `lineAvgCharW(items)` usados igual em T1/T2; blocos `{type, text}` usados igual em T3/T5/T6/T7. ✔
