// src/convert/txt.js
'use strict';
function txtToMarkdown(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!s) return '';
  return s.endsWith('\n') ? s : s + '\n';
}
module.exports = { txtToMarkdown };
