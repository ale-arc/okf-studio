// src/convert/reconstruct.js — reconstrói Markdown a partir de itens de texto posicionados (uma página).
'use strict';

// Agrupa itens em linhas por proximidade vertical.
function groupLines(items) {
  const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  for (const it of sorted) {
    const tol = Math.max(3, it.fontSize * 0.6);
    let line = lines.find(l => Math.abs(l.y - it.y) <= tol);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

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

function emph(it) {
  let s = it.str;
  if (!s.trim()) return s;
  if (it.bold && it.italic) return '***' + s.trim() + '*** ';
  if (it.bold) return '**' + s.trim() + '** ';
  if (it.italic) return '*' + s.trim() + '* ';
  return s;
}

function medianFontSize(items) {
  const sizes = items.map(i => i.fontSize).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 12;
}

function headingHashes(size, median) {
  const r = size / median;
  if (r >= 1.8) return '# ';
  if (r >= 1.4) return '## ';
  if (r >= 1.15) return '### ';
  return '';
}

const BULLET = /^([•\-\*•●▪]|\d+[.)])\s+/;

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
// Aceita tanto um array de linhas já agrupadas (cada elemento tem .items) quanto
// um array plano de itens (cada elemento tem .str), que serão agrupados automaticamente.
function isTableStrict(lines) {
  if (!lines || lines.length < 2) return null;
  // Normaliza: se os elementos não têm .items, são itens planos — agrupa primeiro.
  if (lines[0] && !lines[0].items) lines = groupLines(lines);
  if (lines.length < 2) return null;
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

function tableMarkdown(lines, cols) {
  const rows = lines.map(l => assignCells(l, cols));
  const head = rows[0];
  let md = '| ' + head.join(' | ') + ' |\n';
  md += '| ' + head.map(() => '---').join(' | ') + ' |\n';
  for (const r of rows.slice(1)) md += '| ' + r.join(' | ') + ' |\n';
  return md;
}

function maxFont(line) { return Math.max.apply(null, line.items.map(it => it.fontSize)); }

// Quebra um conjunto de linhas em sub-blocos separados por gaps de parágrafo.
function splitByGap(lines) {
  if (lines.length <= 1) return lines.length ? [lines] : [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const typ = sorted[Math.floor((sorted.length - 1) / 2)] || 0;
  // Fallback: use average font size across all lines for absolute threshold.
  const allFonts = lines.reduce((acc, l) => acc.concat(l.items.map(it => it.fontSize)), []);
  const avgFont = allFonts.length ? allFonts.reduce((a, b) => a + b, 0) / allFonts.length : 12;
  const absThresh = avgFont * 2;
  const blocks = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    const isParagraphBreak = (typ > 0 && gap > typ * 1.5) || gap > absThresh;
    if (isParagraphBreak) { blocks.push(cur); cur = [lines[i]]; }
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

// Processa as linhas de UMA coluna: títulos, listas, tabelas (estritas) e parágrafos reflow-ados.
function emitLines(lines, median) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const text = lineText(line);
    const h = headingHashes(maxFont(line), median);
    if (h) { out.push(h + text.replace(/\*{1,3}/g, '').trim()); i++; continue; }
    if (BULLET.test(text)) { out.push('- ' + text.replace(BULLET, '')); i++; continue; }
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
  // Layout multi-coluna de texto tem MUITAS linhas por coluna; uma tabela tem
  // poucas linhas. Sem este piso, splitColumns picotaria tabelas de 2 colunas.
  if (groupLines(left).length < 6 || groupLines(right).length < 6) return [items];
  return [...splitColumns(left), ...splitColumns(right)];
}

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

module.exports = { reconstructMarkdown, groupLines, isTableStrict, splitColumns };
