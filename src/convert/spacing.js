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
