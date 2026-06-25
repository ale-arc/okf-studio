// test-convert.js — testes do núcleo de conversão (puro, sem DOM/Electron)
const assert = require('assert');
let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }
function has(hay, needle, msg) { ok(String(hay).includes(needle), msg + ' (faltou: ' + needle + ')'); }

// ---- Task A1: buildPdfHtml ----
const { buildPdfHtml, PRINT_CSS } = require('./src/convert/pdf-html.js');
{
  const html = buildPdfHtml('# Título\n\nParágrafo com **negrito**.', { title: 'Doc', type: 'reference' }, {});
  has(html, '<!DOCTYPE html>', 'pdf-html: tem doctype');
  has(html, '<h1>Título</h1>', 'pdf-html: renderiza heading via marked');
  has(html, '<strong>negrito</strong>', 'pdf-html: renderiza negrito');
  has(html, '@page', 'pdf-html: inclui CSS @page');
  has(html, 'Doc', 'pdf-html: inclui o title do frontmatter no cabeçalho');
  const withBase = buildPdfHtml('![x](assets/a.png)', {}, { baseHref: 'file:///C:/lib/proj/' });
  has(withBase, '<base href="file:///C:/lib/proj/">', 'pdf-html: injeta base href quando fornecido');
  ok(PRINT_CSS.includes('@page'), 'PRINT_CSS exporta o CSS de impressão');
}

// ---- Task B2: txtToMarkdown ----
const { txtToMarkdown } = require('./src/convert/txt.js');
{
  ok(txtToMarkdown('linha 1\nlinha 2') === 'linha 1\nlinha 2\n', 'txt: preserva linhas e garante \\n final');
  ok(txtToMarkdown('a\r\nb') === 'a\nb\n', 'txt: normaliza CRLF');
  ok(txtToMarkdown('') === '', 'txt: vazio vira vazio');
}

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('CONVERT OK');
