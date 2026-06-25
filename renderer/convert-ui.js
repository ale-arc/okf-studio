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

  window.OKFConvertUI = { exportCurrentPdf };
})();
