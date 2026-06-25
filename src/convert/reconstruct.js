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

function lineText(line) {
  let out = '';
  let prev = null;
  for (const it of line.items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > prev.fontSize * 0.3) out += ' ';
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

// Detecta um bloco de linhas como tabela: ≥2 linhas que compartilham ≥2 colunas (clusters de x).
function detectColumns(lines) {
  const xs = [];
  for (const l of lines) for (const it of l.items) xs.push(it.x);
  xs.sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const c = cols.find(c => Math.abs(c - x) <= 12);
    if (c == null) cols.push(x);
  }
  return cols.sort((a, b) => a - b);
}

function cellsFor(line, cols) {
  const cells = cols.map(() => '');
  for (const it of line.items) {
    let bi = 0, best = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c - it.x); if (d < best) { best = d; bi = i; } });
    cells[bi] += (cells[bi] ? ' ' : '') + emph(it).trim();
  }
  return cells.map(c => c.trim());
}

function isTableBlock(lines) {
  if (lines.length < 2) return null;
  const cols = detectColumns(lines);
  if (cols.length < 2) return null;
  // exige que a maioria das linhas tenha itens em ≥2 colunas distintas
  const multi = lines.filter(l => {
    const hit = new Set();
    for (const it of l.items) {
      let bi = 0, best = Infinity;
      cols.forEach((c, i) => { const d = Math.abs(c - it.x); if (d < best) { best = d; bi = i; } });
      hit.add(bi);
    }
    return hit.size >= 2;
  });
  return multi.length >= Math.max(2, Math.ceil(lines.length * 0.6)) ? cols : null;
}

function tableMarkdown(lines, cols) {
  const rows = lines.map(l => cellsFor(l, cols));
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
    const cols = block.length >= 2 ? isTableBlock(block) : null;
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
    if (h) out.push(h + text.replace(/\*\*/g, '').trim());
    else if (BULLET.test(text)) out.push('- ' + text.replace(BULLET, ''));
    else out.push(text);
    i++;
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { reconstructMarkdown, groupLines, isTableBlock };
