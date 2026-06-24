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
    renderHtml: (window.marked ? window.marked.parse('# H\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |') : ''),
    themeToggle: (() => {
      const before = document.documentElement.getAttribute('data-theme');
      window.__okfSetTheme && window.__okfSetTheme(before === 'light' ? 'dark' : 'light');
      const after = document.documentElement.getAttribute('data-theme');
      window.__okfSetTheme && window.__okfSetTheme(before || 'dark');
      return !!(before !== null && after !== null && before !== after);
    })(),
    editorGlobal: !!(window.OKFEditor && typeof window.OKFEditor.create === 'function' && typeof window.OKFEditor.getMarkdown === 'function' && typeof window.OKFEditor.destroy === 'function'),
  }))()`);

  const roundtrip = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const md = '# Título\\n\\nTexto **negrito** e *itálico*.\\n\\n- item A\\n- item B\\n\\n- [ ] tarefa\\n\\n| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n\\n[Atlas](/projetos/atlas.md)\\n';
    await window.OKFEditor.create(host, md, {});
    const out = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    host.remove();
    return {
      heading: /# Título/.test(out),
      bold: /\\*\\*negrito\\*\\*/.test(out),
      list: /[-*] item A/.test(out),
      task: /[-*] \\[[ xX]\\] tarefa/.test(out),
      table: /\\| a \\| b \\|/.test(out),
      link: /\\]\\(\\/projetos\\/atlas\\.md\\)/.test(out)
    };
  })()`);
  const okRound = roundtrip && roundtrip.heading && roundtrip.bold && roundtrip.list && roundtrip.task && roundtrip.table && roundtrip.link;
  console.log('  round-trip Markdown:', JSON.stringify(roundtrip));

  const commands = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await window.OKFEditor.create(host, 'parágrafo de teste', {});
    window.OKFEditor.runCommand('h1');
    const afterH1 = window.OKFEditor.getMarkdown();
    await window.OKFEditor.create(host, 'linha', {});
    window.OKFEditor.taskList();
    const afterTask = window.OKFEditor.getMarkdown();
    await window.OKFEditor.create(host, 'x', {});
    window.OKFEditor.runCommand('table');
    const afterTable = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    host.remove();
    return {
      h1: /^#\\s/m.test(afterH1),
      task: /\\[[ xX]\\]/.test(afterTask),
      table: /\\|/.test(afterTable)
    };
  })()`);
  const okCommands = commands && commands.h1 && commands.task && commands.table;
  console.log('  toolbar commands:', JSON.stringify(commands));

  const okGlobals = ['marked','OKF','cytoscape','jsyaml'].every(k => result[k] === 'object' || result[k] === 'function');
  const okBridge = result.okfBridge === 'object' && result.updateBridge === true;
  const okRender = result.renderHtml.includes('<table>') && result.renderHtml.includes('<h1>');
  const okTheme = result.themeToggle === true;
  const okEditor = result.editorGlobal === true;

  console.log('RENDERER SMOKE TEST');
  console.log('  globals:', JSON.stringify({
    marked: result.marked, 'marked.parse': result.markedParse, OKF: result.OKF,
    cytoscape: result.cytoscape, jsyaml: result.jsyaml, 'window.okf': result.okfBridge
  }));
  console.log('  update bridge present:', result.updateBridge);
  console.log('  markdown render (table+h1):', okRender);
  console.log('  theme toggle muda data-theme:', result.themeToggle);
  console.log('  window.OKFEditor presente:', result.editorGlobal);
  console.log('  CSP violations:', cspViolations.length ? cspViolations : 'none');
  console.log(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');

  app.exit(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && cspViolations.length === 0 ? 0 : 1);
});
