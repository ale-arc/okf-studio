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

  // Favoritos: favoritar via toggleFavorite mostra o grupo no topo; desfavoritar remove.
  const fav = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake2';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    document.getElementById('type-filter').value = '';
    document.getElementById('search').value = '';
    setGroupMode('type'); renderTree();
    const labels = () => [...document.querySelectorAll('#tree .group-head .g-label')].map(e => e.textContent);
    const beforeFav = labels().some(l => l.indexOf('Favoritos') >= 0);
    toggleFavorite('projeto/a.md');
    const after = labels();
    const hasFav = after.some(l => l.indexOf('Favoritos') >= 0);
    const favFirst = !!(after[0] && after[0].indexOf('Favoritos') >= 0);
    const marks = document.querySelectorAll('#tree .fav-mark').length;
    toggleFavorite('projeto/a.md');
    const removed = labels().some(l => l.indexOf('Favoritos') >= 0);
    return { beforeFav, hasFav, favFirst, marks, removed };
  })()`);
  const okFav = fav && fav.beforeFav === false && fav.hasFav === true &&
    fav.favFirst === true && fav.marks >= 1 && fav.removed === false;
  console.log('  favoritos grupo/marcador:', JSON.stringify(fav));

  // Drag-and-drop: isValidDropTarget decide alvos; drop em Favoritos favorita.
  const dnd = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake3';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    const rel = 'projeto/a.md';
    const gType = { key: 'type:Processo', label: 'Processo', special: false, system: false, favorites: false };
    const gSameType = { key: 'type:Projeto', label: 'Projeto', special: false, system: false, favorites: false };
    const gTag = { key: 'tag:foo', label: 'foo', special: false, system: false, favorites: false };
    const gSpecial = { key: '__notype__', label: 'Sem tipo', special: true, system: false, favorites: false };
    const gFav = { key: '__favorites__', label: '★ Favoritos', special: false, system: false, favorites: true };
    return {
      validType: isValidDropTarget(gType, rel),
      invalidSameType: isValidDropTarget(gSameType, rel),
      validTag: isValidDropTarget(gTag, rel),
      invalidSpecial: isValidDropTarget(gSpecial, rel),
      validFav: isValidDropTarget(gFav, rel)
    };
  })()`);
  const okDnd = dnd && dnd.validType === true && dnd.invalidSameType === false &&
    dnd.validTag === true && dnd.invalidSpecial === false && dnd.validFav === true;
  console.log('  dnd isValidDropTarget:', JSON.stringify(dnd));

  const dndFav = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake3';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' }
    ];
    indexDocs();
    state.collapsed = new Set();
    state.favorites = new Set();
    setGroupMode('type'); renderTree();
    await handleDropOnGroup('projeto/a.md', { key: '__favorites__', label: '★ Favoritos', favorites: true, special: false, system: false });
    return { favorited: state.favorites.has('projeto/a.md') };
  })()`);
  const okDndFav = dndFav && dndFav.favorited === true;
  console.log('  dnd drop favoritar:', JSON.stringify(dndFav));

  // Segurança: DOMPurify presente no renderer e remove handlers/scripts.
  const sani = await win.webContents.executeJavaScript(`(() => {
    if (typeof window.DOMPurify === 'undefined') return { present: false };
    const out = window.DOMPurify.sanitize('<img src=x onerror="alert(1)"><b>ok</b><script>alert(2)<\\/script>');
    return { present: true, noOnerror: out.indexOf('onerror') === -1, noScript: out.toLowerCase().indexOf('<script') === -1, keepsText: out.indexOf('ok') !== -1 };
  })()`);
  const okSani = sani && sani.present === true && sani.noOnerror === true && sani.noScript === true && sani.keepsText === true;
  console.log('  sanitização (DOMPurify):', JSON.stringify(sani));

  // Estabilidade: cancelEdit com state.current inexistente não quebra.
  const cancel = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake4';
    state.docs = [];
    indexDocs();
    state.current = 'sumiu/x.md';
    state.editing = true;
    try { await cancelEdit(); return { ok: true }; } catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  const okCancel = cancel && cancel.ok === true;
  console.log('  cancelEdit sem doc:', JSON.stringify(cancel));

  // Delta-reload: reloadFromDisk(delta) patcha a árvore sem readBundle.
  const delta = await win.webContents.executeJavaScript(`(async () => {
    state.root = '/fake5';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\n---\\n# A\\n' },
      { relPath: 'projeto/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: B\\n---\\n# B\\n' }
    ];
    indexDocs(); state.collapsed = new Set(); state.favorites = new Set(); state.editing = false; state.current = null;
    document.getElementById('type-filter').value = ''; document.getElementById('search').value = '';
    setGroupMode('type');
    await reloadFromDisk({ upserts: [{ relPath: 'processo/c.md', name: 'c.md', reserved: false, content: '---\\ntype: Processo\\ntitle: C\\n---\\n# C\\n' }], deletes: ['projeto/b.md'] });
    const paths = state.docs.map(d => d.relPath).sort();
    return { paths, count: state.docs.length };
  })()`);
  const okDelta = delta && delta.count === 2 && delta.paths.indexOf('processo/c.md') !== -1 && delta.paths.indexOf('projeto/b.md') === -1 && delta.paths.indexOf('projeto/a.md') !== -1;
  console.log('  delta-reload:', JSON.stringify(delta));

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

  // Saúde da biblioteca: showHealth popula o painel com achados clicáveis.
  const health = await win.webContents.executeJavaScript(`(() => {
    state.root = '/fake-health';
    state.docs = [
      { relPath: 'projeto/a.md', name: 'a.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: A\\ndescription: d\\ntags: [x]\\n---\\n# A\\n[falta](/nada/zzz.md)\\n' },
      { relPath: 'projeto/b.md', name: 'b.md', reserved: false, content: '---\\ntype: Projeto\\ntitle: B\\ndescription: d\\ntags: [x]\\n---\\n# B\\n[A](/projeto/a.md)\\n' }
    ];
    indexDocs();
    state.collapsed = new Set(); state.favorites = new Set(); state.editing = false; state.current = null;
    showHealth();
    const shown = !document.getElementById('health-view').classList.contains('hidden');
    const body = document.getElementById('health-body');
    const broken = body.textContent.indexOf('conceito inexistente') !== -1;
    const orphan = body.textContent.indexOf('Nenhum outro conceito') !== -1;
    const clickable = body.querySelectorAll('.where[data-rel]').length;
    closeOverlays();
    return { shown, broken, orphan, clickable };
  })()`);
  const okHealth = !!health && health.shown && health.broken && health.orphan && health.clickable >= 1;
  console.log('  saúde da biblioteca:', JSON.stringify(health));

  // Autocomplete [[wikilink]]: detecção pura + popup filtrado ao digitar "[[".
  const wiki = await win.webContents.executeJavaScript(`(async () => {
    const q1 = window.OKFEditor.__wikiLinkQuery('texto [[ban');
    const q2 = window.OKFEditor.__wikiLinkQuery('[[a]] depois');
    const q3 = window.OKFEditor.__wikiLinkQuery('nada aqui');
    const host = document.getElementById('milkdown');
    host.classList.remove('hidden');
    await window.OKFEditor.create(host, '', { wikiLinkItems: () => [
      { relPath: 'projeto/atlas.md', title: 'Atlas' },
      { relPath: 'processo/onboarding.md', title: 'Onboarding' }
    ]});
    const view = window.OKFEditor.getView();
    view.focus();
    view.dispatch(view.state.tr.insertText('[[atl'));
    const menu = document.querySelector('.okf-wikilink-menu');
    const items = menu ? menu.querySelectorAll('.okf-wikilink-item').length : 0;
    const firstTitle = menu && menu.querySelector('.wl-title') ? menu.querySelector('.wl-title').textContent : '';
    // Enter escolhe o item selecionado e insere o link no documento.
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const md = window.OKFEditor.getMarkdown();
    const menuAfter = !!document.querySelector('.okf-wikilink-menu');
    await window.OKFEditor.destroy();
    const leftover = !!document.querySelector('.okf-wikilink-menu');
    return {
      q1ok: !!q1 && q1.query === 'ban' && q1.from === 6,
      q2null: q2 === null, q3null: q3 === null,
      hasMenu: !!menu, items, firstTitle,
      inserted: md.indexOf('[Atlas](/projeto/atlas.md)') !== -1,
      closedAfterPick: !menuAfter, cleaned: !leftover
    };
  })()`);
  const okWiki = !!wiki && wiki.q1ok && wiki.q2null && wiki.q3null && wiki.hasMenu && wiki.items === 1 && wiki.firstTitle === 'Atlas' && wiki.inserted && wiki.closedAfterPick && wiki.cleaned;
  console.log('  wikilink [[:', JSON.stringify(wiki));

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
  console.log('  favoritos OK:', okFav);
  console.log('  dnd OK:', okDnd && okDndFav);
  console.log('  sanitização OK:', okSani);
  console.log('  estabilidade OK:', okCancel);
  console.log('  delta-reload OK:', okDelta);
  console.log('  saúde OK:', okHealth);
  console.log('  wikilink OK:', okWiki);
  console.log(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && okDatalist && okSidebar && okFav && okDnd && okDndFav && okSani && okCancel && okDelta && okHealth && okWiki && cspViolations.length === 0
    ? 'RESULT: PASS' : 'RESULT: FAIL');

  app.exit(okGlobals && okBridge && okRender && okTheme && okEditor && okRound && okCommands && okGraph && okExtra && okTable && okDatalist && okSidebar && okFav && okDnd && okDndFav && okSani && okCancel && okDelta && okHealth && okWiki && cspViolations.length === 0 ? 0 : 1);
});
