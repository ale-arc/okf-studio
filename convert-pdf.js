// convert-pdf.js — exporta um conceito Markdown para PDF via printToPDF (Chromium embutido).
'use strict';
const { BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { buildPdfHtml } = require('./src/convert/pdf-html.js');

// Gera o PDF a partir de markdown+frontmatter; grava em destPath. Retorna o buffer também (para testes).
async function renderPdf({ markdown, frontmatter, baseHref }) {
  const html = buildPdfHtml(markdown, frontmatter, { baseHref });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, sandbox: true, contextIsolation: true, javascript: false }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } // polegadas
    });
    return buf;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function registerPdfHandlers(ipcMain, getRoot) {
  ipcMain.handle('pdf:export', async (_e, { markdown, frontmatter, conceptRelPath, defaultName }) => {
    try {
      const root = getRoot && getRoot();
      let baseHref;
      if (root && conceptRelPath) {
        const dir = path.dirname(path.join(root, conceptRelPath));
        baseHref = 'file:///' + dir.replace(/\\/g, '/').replace(/^\/+/, '') + '/';
      }
      const res = await dialog.showSaveDialog({
        title: 'Exportar conceito como PDF',
        defaultPath: (defaultName || 'conceito') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const buf = await renderPdf({ markdown, frontmatter, baseHref });
      await fsp.writeFile(res.filePath, buf);
      shell.showItemInFolder(res.filePath);
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

module.exports = { registerPdfHandlers, renderPdf };
