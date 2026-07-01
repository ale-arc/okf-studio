// src/convert/index.js — entry-point do bundle do renderer (global OKFConvert).
'use strict';
const { txtToMarkdown } = require('./txt.js');
const { htmlToMarkdown } = require('./html.js');
const { reconstructMarkdown, stripRunningHeadersFooters } = require('./reconstruct.js');
const { slugifyAsset, rewriteImageLinks } = require('./assets.js');

let pdfjs;
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  const req = require;
  const path = req('path');
  const url = req('url');
  const workerPath = path.join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = url.pathToFileURL(workerPath).href;
} else {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
}

const mammoth = require('mammoth');

const dec = new TextDecoder('utf-8');

function firstHeading(md) {
  const m = String(md).match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function normItems(textContent, viewport) {
  const out = [];
  for (const it of textContent.items) {
    if (!it.str) continue;
    const tr = pdfjs.Util.transform(viewport.transform, it.transform);
    const x = tr[4];
    const y = tr[5];
    const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 12;
    const name = (it.fontName || '').toLowerCase();
    const mono = /courier|consolas|mono|code|sfmono|liberationmono|lucida.*console|source.*code/i.test(name);
    out.push({
      str: it.str, x, y, w: it.width || it.str.length * fontSize * 0.5, h: it.height || fontSize,
      fontSize, bold: /bold|black|semibold|heavy|demi|ultra/.test(name), italic: /italic|oblique|obli/.test(name) || Math.abs((it.transform||[])[1]||0) > 0.12,
      mono
    });
  }
  return out;
}

function splitTextItemsByLinks(items, linkAnns) {
  if (!linkAnns.length) return items;
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) {
      out.push(it);
      continue;
    }
    
    const len = it.str.length;
    const charW = it.w / len;
    const cy = it.y - it.h / 2;
    const charLinks = [];
    
    for (let i = 0; i < len; i++) {
      const cx = it.x + (i + 0.5) * charW;
      let matchedLink = null;
      for (const ann of linkAnns) {
        const hMatch = cx >= ann.vxMin && cx <= ann.vxMax;
        const vMatch = (it.y - it.h) < ann.vyMax && it.y > ann.vyMin;
        if (hMatch && vMatch) {
          matchedLink = ann.url;
          break;
        }
      }
      charLinks.push(matchedLink);
    }
    
    let start = 0;
    while (start < len) {
      let end = start + 1;
      while (end < len && charLinks[end] === charLinks[start]) {
        end++;
      }
      
      const segStr = it.str.slice(start, end);
      const segX = it.x + start * charW;
      const segW = (end - start) * charW;
      
      out.push({
        ...it,
        str: segStr,
        x: segX,
        w: segW,
        link: charLinks[start]
      });
      
      start = end;
    }
  }
  return out;
}

async function pageToDataUrl(page, scale) {
  if (typeof document === 'undefined') return null;
  const viewport = page.getViewport({ scale: scale || 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function ocrDataUrl(dataUrl, onProgress, lang = 'por+eng') {
  if (typeof window === 'undefined') return { data: { text: '' } };
  const Tesseract = require('tesseract.js');
  const base = new URL('.', window.location.href).href;
  const result = await Tesseract.recognize(dataUrl, lang, {
    workerPath: base + 'vendor/tesseract-worker.min.js',
    corePath: base + 'vendor/tesseract-core.wasm.js',
    langPath: base + 'vendor/tessdata',
    workerBlobURL: false,
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m); }
  });
  return result;
}

async function convertPdf(bytes, opts) {
  opts = opts || {};
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const numPages = doc.numPages;
  const metadata = await doc.getMetadata();
  const info = metadata && metadata.info ? metadata.info : {};
  // passagem 1: classificar páginas (texto vs OCR)
  const pageInfo = []; // { type:'text', items, height } | { type:'ocr', page }
  for (let p = 1; p <= doc.numPages; p++) {
    if (opts.signal && opts.signal.aborted) throw new Error('Cancelado');
    if (opts.onProgress) opts.onProgress((p - 1) / (numPages * 2));
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const text = tc.items.map(i => i.str).join('').trim();
    
    let useOcr = false;
    if (text.length >= 10) {
      const alphaCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
      const score = alphaCount / text.length;
      if (score < 0.4) useOcr = true;
    } else {
      useOcr = true;
    }

    if (!useOcr) {
      let items = normItems(tc, viewport);
      try {
        const annotations = await page.getAnnotations();
        const linkAnns = [];
        for (const ann of annotations) {
          if (ann.subtype === 'Link' && (ann.url || ann.dest)) {
            const vrect = viewport.convertToViewportRectangle(ann.rect);
            const vxMin = Math.min(vrect[0], vrect[2]);
            const vxMax = Math.max(vrect[0], vrect[2]);
            const vyMin = Math.min(vrect[1], vrect[3]);
            const vyMax = Math.max(vrect[1], vrect[3]);
            linkAnns.push({
              url: ann.url || ann.dest,
              vxMin, vxMax, vyMin, vyMax
            });
          }
        }
        if (linkAnns.length > 0) {
          items = splitTextItemsByLinks(items, linkAnns);
        }
      } catch (annError) {
        // Ignorar
      }
      pageInfo.push({ type: 'text', items, height: viewport.height });
    } else {
      pageInfo.push({ type: 'ocr', page });
    }
  }
  // remover cabeçalho/rodapé repetidos entre as páginas de texto
  const textPages = pageInfo.filter(pi => pi.type === 'text');
  const stripped = stripRunningHeadersFooters(textPages.map(pi => ({ items: pi.items, height: pi.height })));
  let ti = 0;
  for (const pi of pageInfo) if (pi.type === 'text') { pi.items = stripped[ti].items; ti++; }
  // passagem 2: gerar markdown na ordem original
  const parts = [];
  let pageNo = 0;
  for (const pi of pageInfo) {
    pageNo++;
    if (opts.signal && opts.signal.aborted) throw new Error('Cancelado');
    if (opts.onProgress) opts.onProgress((numPages + pageNo - 1) / (numPages * 2));
    if (pi.type === 'text') {
      parts.push(reconstructMarkdown(pi.items));
    } else {
      if (opts.onStatus) opts.onStatus('OCR na página ' + pageNo + '/' + doc.numPages + '…');
      const url = await pageToDataUrl(pi.page, 2);
      if (url) {
        const ocr = await ocrDataUrl(url, opts.onProgress, opts.ocrLang);
        parts.push(ocr.data ? (ocr.data.text || '').trim() : ocr.trim());
      }
    }
  }
  let markdown = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (i === 0) {
      markdown = p;
      continue;
    }
    const lastChar = markdown.trim().slice(-1);
    const startsLower = /^[a-zà-ÿ]/.test(p.trim());
    if (lastChar && !/[.:;!?]/.test(lastChar) && startsLower) {
      if (markdown.trim().endsWith('-')) {
        markdown = markdown.trim().slice(0, -1) + p.trim();
      } else {
        markdown = markdown.trim() + ' ' + p.trim();
      }
    } else {
      markdown += '\n\n' + p.trim();
    }
  }
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  
  const meta = { title: firstHeading(markdown) || info.Title || '' };
  if (info.Author) meta.author = info.Author;
  if (info.Creator) meta.creator = info.Creator;
  if (info.CreationDate) meta.creationDate = info.CreationDate;
  
  return { markdown, images: [], meta };
}

async function convertDocx(bytes) {
  const images = [];
  let n = 0;
  const conv = await mammoth.convertToHtml(
    { arrayBuffer: bytes.buffer ? bytes.buffer : bytes },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.readAsArrayBuffer();
        const id = 'img' + (++n);
        const ext = (image.contentType && image.contentType.split('/')[1]) || 'png';
        images.push({ tempId: id, bytes: new Uint8Array(buf), mime: image.contentType, suggestedName: id + '.' + ext });
        return { src: 'okf-img:' + id };
      })
    }
  );
  const markdown = htmlToMarkdown(conv.value);
  return { markdown, images, meta: { title: firstHeading(markdown) } };
}

async function convert(bytes, ext, opts) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'pdf') return convertPdf(bytes, opts);
  if (e === 'docx') return convertDocx(bytes);
  if (e === 'html' || e === 'htm') {
    const md = htmlToMarkdown(dec.decode(bytes));
    return { markdown: md, images: [], meta: { title: firstHeading(md) } };
  }
  const md = txtToMarkdown(dec.decode(bytes));
  return { markdown: md, images: [], meta: { title: '' } };
}

module.exports = { convert, slugifyAsset, rewriteImageLinks, txtToMarkdown, htmlToMarkdown };
