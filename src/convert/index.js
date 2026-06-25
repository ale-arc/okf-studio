// src/convert/index.js — entry-point do bundle do renderer (global OKFConvert).
'use strict';
const { txtToMarkdown } = require('./txt.js');
const { htmlToMarkdown } = require('./html.js');
const { reconstructMarkdown, stripRunningHeadersFooters } = require('./reconstruct.js');
const { slugifyAsset, rewriteImageLinks } = require('./assets.js');

const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

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
    out.push({
      str: it.str, x, y, w: it.width || it.str.length * fontSize * 0.5, h: it.height || fontSize,
      fontSize, bold: /bold|black|semibold/.test(name), italic: /italic|oblique/.test(name)
    });
  }
  return out;
}

async function pageToDataUrl(page, scale) {
  const viewport = page.getViewport({ scale: scale || 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function ocrDataUrl(dataUrl, onProgress) {
  const Tesseract = require('tesseract.js');
  const result = await Tesseract.recognize(dataUrl, 'por+eng', {
    workerPath: 'vendor/tesseract-worker.min.js',
    corePath: 'vendor/tesseract-core.wasm.js',
    langPath: 'vendor/tessdata',
    logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); }
  });
  return result.data.text || '';
}

async function convertPdf(bytes, opts) {
  opts = opts || {};
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  // passagem 1: classificar páginas (texto vs OCR)
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
    if (pi.type === 'text') {
      parts.push(reconstructMarkdown(pi.items));
    } else {
      if (opts.onStatus) opts.onStatus('OCR na página ' + pageNo + '/' + doc.numPages + '…');
      const url = await pageToDataUrl(pi.page, 2);
      const ocr = await ocrDataUrl(url, opts.onProgress);
      parts.push(ocr.trim());
    }
  }
  const markdown = parts.filter(Boolean).join('\n\n');
  return { markdown, images: [], meta: { title: firstHeading(markdown) } };
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
