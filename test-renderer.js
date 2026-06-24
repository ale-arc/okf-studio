'use strict';
// Smoke test: load the real renderer in a hidden window and assert globals/CSP.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const cspViolations = [];
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (/Content Security Policy|Refused to load/i.test(message)) cspViolations.push(message);
  });

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const result = await win.webContents.executeJavaScript(`(() => ({
    marked: typeof window.marked,
    markedParse: typeof (window.marked && window.marked.parse),
    OKF: typeof window.OKF,
    cytoscape: typeof window.cytoscape,
    jsyaml: typeof window.jsyaml,
    okfBridge: typeof window.okf,
    updateBridge: !!(window.okf && typeof window.okf.getVersion==='function' &&
      typeof window.okf.checkForUpdates==='function' && typeof window.okf.installUpdate==='function' &&
      typeof window.okf.onUpdateStatus==='function'),
    renderHtml: (window.marked ? window.marked.parse('# H\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |') : '')
  }))()`);

  const okGlobals = ['marked','OKF','cytoscape','jsyaml'].every(k => result[k] === 'object' || result[k] === 'function');
  const okBridge = result.okfBridge === 'object' && result.updateBridge === true;
  const okRender = result.renderHtml.includes('<table>') && result.renderHtml.includes('<h1>');

  console.log('RENDERER SMOKE TEST');
  console.log('  globals:', JSON.stringify({
    marked: result.marked, 'marked.parse': result.markedParse, OKF: result.OKF,
    cytoscape: result.cytoscape, jsyaml: result.jsyaml, 'window.okf': result.okfBridge
  }));
  console.log('  update bridge present:', result.updateBridge);
  console.log('  markdown render (table+h1):', okRender);
  console.log('  CSP violations:', cspViolations.length ? cspViolations : 'none');
  console.log(okGlobals && okBridge && okRender && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');

  app.exit(okGlobals && okBridge && okRender && cspViolations.length === 0 ? 0 : 1);
});
