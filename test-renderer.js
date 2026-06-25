'use strict';
// Smoke test: load the real renderer in a hidden window and assert globals/CSP.
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerTemplateHandlers } = require('./templates.js');
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

  registerTemplateHandlers(ipcMain);

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const result = await win.webContents.executeJavaScript(`(() => ({
    marked: typeof window.marked,
    markedParse: typeof (window.marked && window.marked.parse),
    OKF: typeof window.OKF,
    G6: typeof window.G6,
    jsyaml: typeof window.jsyaml,
    okfBridge: typeof window.okf,
    updateBridge: !!(window.okf && typeof window.okf.getVersion==='function' &&
      typeof window.okf.checkForUpdates==='function' && typeof window.okf.installUpdate==='function' &&
      typeof window.okf.onUpdateStatus==='function'),
    claudeBridge: !!(window.okf && typeof window.okf.openClaude==='function' &&
      typeof window.okf.onBundleChanged==='function'),
    gitBridge: !!(window.okf && window.okf.git && typeof window.okf.git.status==='function' &&
      typeof window.okf.git.commit==='function'),
    paletteUI: !!(document.getElementById('palette') && document.getElementById('palette-input')),
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

  const templatesCheck = await win.webContents.executeJavaScript(`(async () => {
    const t = await window.okf.templates.list();
    return Array.isArray(t) && t.length >= 6;
  })()`);
  console.log('  modelos (bridge):', templatesCheck);

  const roundtrip = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const md = '# Título\\n\\nTexto **negrito** e *itálico*.\\n\\n- item A\\n- item B\\n\\n- [ ] tarefa\\n\\n| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n\\n[Atlas](/projetos/atlas.md)\\n';
    await window.OKFEditor.create(host, md, {});
    window.OKFEditor.cursorEnd();
    window.OKFEditor.insertConceptLink('/processos/onboarding-cliente.md', 'Onboarding');
    const out = window.OKFEditor.getMarkdown();
    await window.OKFEditor.destroy();
    host.remove();
    return {
      heading: /# Título/.test(out),
      bold: /\\*\\*negrito\\*\\*/.test(out),
      list: /[-*] item A/.test(out),
      task: /[-*] \\[[ xX]\\] tarefa/.test(out),
      table: /\\| a \\| b \\|/.test(out),
      link: /\\]\\(\\/projetos\\/atlas\\.md\\)/.test(out),
      concept: /\\[Onboarding\\]\\(\\/processos\\/onboarding-cliente\\.md\\)/.test(out),
    };
  })()`);
  const okRound = roundtrip && roundtrip.heading && roundtrip.bold && roundtrip.list && roundtrip.task && roundtrip.table && roundtrip.link && roundtrip.concept;
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

  const tableUI = await win.webContents.executeJavaScript(`(async () => {
    const host = document.createElement('div'); host.className = 'milkdown-host';
    document.body.appendChild(host);
    await window.OKFEditor.create(host, '| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n\\ntexto fora\\n', {});
    const view = window.OKFEditor.getView();
    const TextSelection = view.state.selection.constructor;
    const setCursorAt = (predicate) => {
      let target = null;
      view.state.doc.descendants((node, pos) => { if (target === null && predicate(node)) target = pos + 1; });
      if (target === null) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target))));
      return true;
    };
    const bar = () => host.querySelector('.okf-table-toolbar');
    const visible = () => { const b = bar(); return !!b && b.style.display !== 'none'; };
    const click = (act) => { const b = bar().querySelector('button[data-act="'+act+'"]');
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); };

    setCursorAt(n => n.type.name === 'table_cell' || n.type.name === 'table_header');
    const visInside = visible();
    click('col-after');
    const md3 = window.OKFEditor.getMarkdown();
    // colunas = células delimitadas por '|' na 1ª linha (cabeçalho)
    const cols = md3.split('\\n')[0].split('|').filter(s => s.trim() !== '').length;
    setCursorAt(n => n.type.name === 'table_cell' || n.type.name === 'table_header');
    click('row-after');
    const md4 = window.OKFEditor.getMarkdown();
    const pipeLines = (md4.match(/^\\|/gm) || []).length;
    setCursorAt(n => n.type.name === 'paragraph' && n.textContent === 'texto fora');
    const visOutside = visible();
    const noHtml = !/<table/i.test(md4);

    await window.OKFEditor.destroy();
    host.remove();
    return { visInside, cols, pipeLines, visOutside, noHtml };
  })()`);
  const okTable = tableUI && tableUI.visInside === true && tableUI.cols === 3 &&
    tableUI.pipeLines >= 4 && tableUI.visOutside === false && tableUI.noHtml === true;
  console.log('  table toolbar:', JSON.stringify(tableUI));

  const g6 = await win.webContents.executeJavaScript(`(async () => {
    if (!window.G6 || !window.G6.Graph) return { loaded:false };
    try {
      const host = document.createElement('div');
      host.style.width='400px'; host.style.height='300px';
      document.body.appendChild(host);
      const graph = new window.G6.Graph({ container: host, width:400, height:300,
        data:{ nodes:[{id:'a',data:{}},{id:'b',data:{}}], edges:[{id:'e',source:'a',target:'b'}] },
        layout:{ type:'force' } });
      await Promise.race([ graph.render(), new Promise((_,rej)=>setTimeout(()=>rej(new Error('render timeout')),5000)) ]);
      const ok = !!graph.getNodeData('a');
      graph.destroy(); host.remove();
      return { loaded:true, rendered: ok };
    } catch (err) { return { loaded:true, rendered:false, error:String(err && err.message || err) }; }
  })()`);
  const okGraph = g6 && g6.loaded && g6.rendered;
  console.log('  G6 graph:', JSON.stringify(g6));

  // Sidebar: agrupamento por modo e colapso refletem no DOM.
  const sidebar = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\ntags: [x, y]\\n---\\n# A\\n' },
      { relPath: 'processo/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Processo\\ntitle: B\\ntags: [x]\\n---\\n# B\\n' },
      { relPath: 'index.md', name: 'index.md', reserved: true, content: '# Índice' }
    ];
    indexDocs();
    state.collapsed = new Set();
    document.getElementById('type-filter').value = '';
    document.getElementById('search').value = '';
    setGroupMode('type'); renderTree();
    const heads = () => [...document.querySelectorAll('#tree .group-head .g-label')].map(e => e.textContent);
    const typeHeads = heads();
    setGroupMode('tag'); renderTree();
    const tagHeads = heads();
    setGroupMode('flat'); renderTree();
    const flatHeads = heads();
    setGroupMode('type'); renderTree();
    const before = document.querySelectorAll('#tree .node').length;
    toggleGroup('type:Projeto');
    const after = document.querySelectorAll('#tree .node').length;
    return { typeHeads, tagHeads, flatHeads, before, after };
  })()`);
  const okSidebar = sidebar &&
    sidebar.typeHeads.includes('Projeto') && sidebar.typeHeads.includes('Processo') && sidebar.typeHeads.includes('Sistema') &&
    sidebar.tagHeads.includes('x') && sidebar.tagHeads.includes('y') &&
    sidebar.flatHeads.length === 1 && sidebar.flatHeads[0] === 'Sistema' &&
    sidebar.after < sidebar.before;
  console.log('  sidebar agrupamento/colapso:', JSON.stringify(sidebar));

  // Regressão: o datalist de tipos deve ser populado também ao ENTRAR EM EDIÇÃO,
  // não só ao criar um conceito novo. (Bug: enterEdit não chamava refreshTypeDatalist.)
  const datalist = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' },
      { relPath: 'processo/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Processo\\ntitle: B\\n---\\n# B\\n' }
    ];
    indexDocs();
    const dl = document.getElementById('type-options');
    const savedEditor = window.OKFEditor;
    window.OKFEditor = null; // força modo Código no enterEdit (evita o milkdown no teste)
    dl.innerHTML = '';
    state.current = 'projeto/a.md';
    try { enterEdit(); } catch (e) {}
    const edit = dl.options.length;
    try { cancelEdit(); } catch (e) {}
    window.OKFEditor = savedEditor;
    dl.innerHTML = '';
    openModal(); // controle: criar conceito já funcionava
    const novo = dl.options.length;
    closeModal();
    return { edit, novo };
  })()`);
  const okDatalist = !!datalist && datalist.edit >= 2 && datalist.novo >= 2;
  console.log('  datalist tipos (edicao/novo):', JSON.stringify(datalist));

  const okGlobals = ['marked','OKF','G6','jsyaml'].every(k => result[k] === 'object' || result[k] === 'function');
  const okBridge = result.okfBridge === 'object' && result.updateBridge === true && result.claudeBridge === true && result.gitBridge === true;
  const okRender = result.renderHtml.includes('<table>') && result.renderHtml.includes('<h1>');
  const okTheme = result.themeToggle === true;
  const okEditor = result.editorGlobal === true;
  const okExtra = result.paletteUI === true && templatesCheck === true;

  console.log('RENDERER SMOKE TEST');
  console.log('  globals:', JSON.stringify({
    marked: result.marked, 'marked.parse': result.markedParse, OKF: result.OKF,
    G6: result.G6, jsyaml: result.jsyaml, 'window.okf': result.okfBridge
  }));
  console.log('  update bridge present:', result.updateBridge);
  console.log('  markdown render (table+h1):', okRender);
  console.log('  theme toggle muda data-theme:', result.themeToggle);
  console.log('  window.OKFEditor presente:', result.editorGlobal);
  console.log('  paleta + modelos:', result.paletteUI, templatesCheck);
  console.log('  CSP violations:', cspViolations.length ? cspViolations : 'none');
  console.log('  datalist tipos populado (edição + novo):', okDatalist);
  console.log('  sidebar OK:', okSidebar);
  console.log(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && okDatalist && okSidebar && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');

  app.exit(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && okDatalist && okSidebar && cspViolations.length === 0 ? 0 : 1);
});
