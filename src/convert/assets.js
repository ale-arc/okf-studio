// src/convert/assets.js — utilidades de nomes e reescrita de links de imagem.
'use strict';

function slugifyAsset(name) {
  const s = String(name || 'imagem');
  const dot = s.lastIndexOf('.');
  let base = dot > 0 ? s.slice(0, dot) : s;
  let ext = dot > 0 ? s.slice(dot + 1) : 'png';
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imagem';
  ext = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return base + '.' + ext;
}

// map: { tempId: 'assets/arquivo.ext' }
function rewriteImageLinks(markdown, map) {
  let out = String(markdown || '');
  for (const [id, target] of Object.entries(map || {})) {
    const re = new RegExp('okf-img:' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, target);
  }
  return out;
}

module.exports = { slugifyAsset, rewriteImageLinks };
