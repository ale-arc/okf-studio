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

  function suggestImportPath(meta, fileName) {
    const base = (meta && meta.title) ? meta.title : fileName.replace(/\.[^.]+$/, '');
    const slug = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
    return 'referencias/' + slug + '.md';
  }

  async function importDocument() {
    if (!state.root) { toast('Abra uma biblioteca primeiro.', 'bad'); return; }
    const filePath = await window.okf.openDocumentDialog();
    if (!filePath) return;
    const file = await window.okf.readBinary(filePath);
    const bytes = new Uint8Array(file.bytes);

    $('import-modal').classList.remove('hidden');
    $('import-md').value = '';
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
      $('import-md').value = res.markdown || '';
      $('import-path').value = suggestImportPath(res.meta, file.name);
      $('import-status').textContent = 'Pronto — revise e salve. ' +
        (res.images && res.images.length ? res.images.length + ' imagem(ns) serão salvas em assets/.' : '');
      prog.classList.add('hidden');
      $('import-save').disabled = false;
    } catch (e) {
      $('import-status').textContent = 'Falha na conversão: ' + ((e && e.message) || e);
      prog.classList.add('hidden');
    }
  }

  function closeImport() { $('import-modal').classList.add('hidden'); importDraft = null; }

  async function saveImport() {
    let rel = $('import-path').value.trim().replace(/^\/+/, '');
    if (!rel) { toast('Informe o caminho .md.', 'bad'); return; }
    if (!rel.toLowerCase().endsWith('.md')) rel += '.md';
    if (state.docs.some(d => d.relPath === rel)) { toast('Já existe um conceito em ' + rel, 'bad'); return; }

    let body = $('import-md').value;
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

    const title = (importDraft && importDraft.meta && importDraft.meta.title) ||
      baseNameOf(rel).replace(/\.md$/i, '');
    const fm = { type: 'reference', title, timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    const content = OKF.serialize(fm, body.startsWith('#') ? body : ('# ' + title + '\n\n' + body));
    ops.unshift({ op: 'create', relPath: rel, content });

    closeImport();
    const ok = await applyOpsAndRefresh(ops, rel);
    if (ok) toast('Documento importado: ' + rel, 'good');
  }

  window.OKFConvertUI = { exportCurrentPdf, importDocument, closeImport, saveImport };
})();
