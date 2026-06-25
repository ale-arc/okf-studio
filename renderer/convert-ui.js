// renderer/convert-ui.js — fluxos de importação/exportação de documentos.
'use strict';
(function () {
  // Exporta o conceito atualmente aberto para PDF.
  async function exportCurrentPdf() {
    if (!state.current) { toast('Abra um conceito primeiro.', 'bad'); return; }
    const doc = state.docs.find(d => d.relPath === state.current);
    if (!doc) { toast('Conceito não encontrado.', 'bad'); return; }
    const parsed = parsedOf(doc);
    const markdown = state.editing ? currentBodyMarkdown(doc) : parsed.body;
    const defaultName = (parsed.frontmatter.title || baseNameOf(doc.relPath).replace(/\.md$/i, ''));
    toast('Gerando PDF…', 'good');
    const res = await window.okf.exportPdf({
      markdown,
      frontmatter: parsed.frontmatter,
      conceptRelPath: doc.relPath,
      defaultName
    });
    if (res && res.ok) toast('PDF salvo: ' + res.path, 'good');
    else if (res && res.canceled) {/* silencioso */}
    else toast('Falha ao gerar PDF: ' + ((res && res.error) || 'desconhecida'), 'bad');
  }

  let importDraft = null; // { images: [...], meta: {...} }
  let importEditor = null; // handle da instância do editor do modal
  let importMode = 'visual';

  function importMarkdown() {
    return importMode === 'visual' && importEditor ? importEditor.getMarkdown() : $('import-md').value;
  }
  async function setImportMode(mode) {
    if (mode === importMode) return;
    if (mode === 'source') {
      const md = importEditor ? importEditor.getMarkdown() : $('import-md').value;
      if (importEditor) { await importEditor.destroy(); importEditor = null; }
      $('import-editor').classList.add('hidden');
      $('import-md').value = md; $('import-md').classList.remove('hidden');
    } else {
      const md = $('import-md').value;
      $('import-md').classList.add('hidden');
      $('import-editor').classList.remove('hidden');
      importEditor = await window.OKFEditor.createInstance($('import-editor'), md, {});
    }
    importMode = mode;
    $('import-mode-visual').classList.toggle('on', mode === 'visual');
    $('import-mode-source').classList.toggle('on', mode === 'source');
  }

  async function importDocument() {
    if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
    const filePath = await window.okf.openDocumentDialog();
    if (!filePath) return;
    const file = await window.okf.readBinary(filePath);
    const bytes = new Uint8Array(file.bytes);

    $('import-modal').classList.remove('hidden');
    $('import-md').value = '';
    if (importEditor) { await importEditor.destroy(); importEditor = null; }
    $('import-save').disabled = true;
    $('import-status').textContent = 'Convertendo ' + file.name + '…';
    const prog = $('import-progress');
    prog.classList.add('hidden'); prog.value = 0;

    try {
      const res = await window.OKFConvert.convert(bytes, file.ext, {
        onStatus: (s) => { $('import-status').textContent = s; },
        onProgress: (p) => { prog.classList.remove('hidden'); prog.value = Math.round((p || 0) * 100); }
      });
      importDraft = { images: res.images || [], meta: res.meta || {} };
      const md = res.markdown || '';
      $('import-md').value = md;
      if (window.OKFEditor && window.OKFEditor.createInstance) {
        importMode = 'visual';
        $('import-mode-visual').classList.add('on');
        $('import-mode-source').classList.remove('on');
        $('import-editor').classList.remove('hidden');
        $('import-md').classList.add('hidden');
        importEditor = await window.OKFEditor.createInstance($('import-editor'), md, {});
      } else {
        importMode = 'source';
        $('import-editor').classList.add('hidden');
        $('import-md').classList.remove('hidden');
      }
      $('import-type').value = (res.meta && res.meta.type) ? res.meta.type : 'Referência';
      $('import-status').textContent = 'Pronto — revise e salve. ' +
        (res.images && res.images.length ? res.images.length + ' imagem(ns) serão salvas em assets/.' : '');
      prog.classList.add('hidden');
      $('import-save').disabled = false;
    } catch (e) {
      $('import-status').textContent = 'Falha na conversão: ' + ((e && e.message) || e);
      prog.classList.add('hidden');
    }
  }

  async function closeImport() {
    $('import-modal').classList.add('hidden');
    importDraft = null;
    if (importEditor) { await importEditor.destroy(); importEditor = null; }
  }

  async function saveImport() {
    const typeRaw = $('import-type').value.trim();
    if (!typeRaw) { toast('O campo "type" é obrigatório.', 'bad'); return; }
    const type = OKF.auto.canonicalType(typeRaw, state.docs);
    const title = (importDraft && importDraft.meta && importDraft.meta.title) || 'documento';
    const taken = new Set(state.docs.map(d => d.relPath));
    const rel = OKF.auto.pathForConcept(type, title, taken);
    if (state.docs.some(d => d.relPath === rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }

    let body = importMarkdown();
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const ops = [];
    const images = (importDraft && importDraft.images) || [];

    if (images.length) {
      const assetsDir = (dir ? dir + '/' : '') + 'assets';
      const used = new Set();
      const map = {};
      for (const img of images) {
        let nameBase = window.OKFConvert.slugifyAsset(img.suggestedName || (img.tempId + '.png'));
        let name = nameBase, k = 1;
        while (used.has(name)) { name = nameBase.replace(/(\.[a-z0-9]+)$/, '-' + (k++) + '$1'); }
        used.add(name);
        const relImg = assetsDir + '/' + name;
        map[img.tempId] = 'assets/' + name; // relativo ao .md
        ops.push({ op: 'create', relPath: relImg, content: img.bytes, binary: true });
      }
      body = window.OKFConvert.rewriteImageLinks(body, map);
    }

    const fm = { type, title, timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    const content = OKF.serialize(fm, body.startsWith('#') ? body : ('# ' + title + '\n\n' + body));
    ops.unshift({ op: 'create', relPath: rel, content });

    await closeImport();
    const ok = await applyOpsAndRefresh(ops, rel);
    if (ok) toast('Documento importado: ' + rel, 'good');
  }

  window.OKFConvertUI = { exportCurrentPdf, importDocument, closeImport, saveImport, setImportMode };
})();
