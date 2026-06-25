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

function reconstructMarkdown(items) {
  const clean = (items || []).filter(i => i && typeof i.str === 'string' && i.str.trim() !== '');
  if (!clean.length) return '';
  const median = medianFontSize(clean);
  const lines = groupLines(clean);

  const out = [];
  let i = 0;
  while (i < lines.length) {
    // tenta agrupar uma sequência de linhas próximas como tabela
    let j = i + 1;
    while (j < lines.length && (lines[j].y - lines[j - 1].y) < median * 2) j++;
    const block = lines.slice(i, j);
    const cols = isTableStrict(block);
    if (cols) {
      out.push(tableMarkdown(block, cols).trimEnd());
      i = j;
      continue;
    }
    // linha simples
    const line = lines[i];
    const text = lineText(line);
    const sizeMax = Math.max(...line.items.map(it => it.fontSize));
    const h = headingHashes(sizeMax, median);
    if (h) out.push(h + text.replace(/\*{1,3}/g, '').trim());
    else if (BULLET.test(text)) out.push('- ' + text.replace(BULLET, ''));
    else out.push(text);
    i++;
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { reconstructMarkdown, groupLines, isTableStrict };
