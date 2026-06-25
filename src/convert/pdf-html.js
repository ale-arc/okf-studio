// src/convert/pdf-html.js — monta o HTML de impressão a partir de Markdown.
'use strict';
const { marked } = require('marked');

const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body { font: 12pt/1.5 -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; background: #fff; margin: 0; }
h1,h2,h3,h4 { line-height: 1.25; margin: 1.2em 0 .5em; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
p, li { font-size: 12pt; }
code, pre { font-family: Consolas, "Courier New", monospace; }
pre { background: #f4f4f5; padding: 10px; border-radius: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
code { background: #f4f4f5; padding: 1px 4px; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: .6em 0; }
th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f0f0f2; }
img { max-width: 100%; }
blockquote { margin: .6em 0; padding: .2em 1em; border-left: 3px solid #ccc; color: #444; }
.okf-pdf-header { border-bottom: 1px solid #ddd; margin-bottom: 1.2em; padding-bottom: .6em; }
.okf-pdf-header .t { font-size: 20pt; font-weight: 700; }
.okf-pdf-header .m { font-size: 10pt; color: #666; margin-top: .2em; }
`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function headerBlock(fm) {
  if (!fm || (!fm.title && !fm.type)) return '';
  const meta = [fm.type && ('type: ' + fm.type), fm.timestamp && ('timestamp: ' + fm.timestamp)]
    .filter(Boolean).join('  ·  ');
  return `<div class="okf-pdf-header">` +
    (fm.title ? `<div class="t">${esc(fm.title)}</div>` : '') +
    (meta ? `<div class="m">${esc(meta)}</div>` : '') + `</div>`;
}

function buildPdfHtml(markdown, frontmatter, opts) {
  opts = opts || {};
  const body = marked.parse(String(markdown || ''));
  const base = opts.baseHref ? `<base href="${esc(opts.baseHref)}">` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${base}<style>${PRINT_CSS}</style></head>` +
    `<body>${headerBlock(frontmatter)}${body}</body></html>`;
}

module.exports = { buildPdfHtml, PRINT_CSS };
