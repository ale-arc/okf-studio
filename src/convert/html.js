// src/convert/html.js — HTML → Markdown (com tabelas GFM). Funciona em Node e no browser.
'use strict';
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

function makeService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*'
  });
  td.use(gfm);
  return td;
}

function htmlToMarkdown(html) {
  const md = makeService().turndown(String(html || ''));
  return md ? (md.endsWith('\n') ? md : md + '\n') : '';
}

module.exports = { htmlToMarkdown, makeService };
