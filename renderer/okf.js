/* OKF core: parsing, frontmatter, links, validation — no DOM. */
(function (global) {
  'use strict';

  const RESERVED = ['index.md', 'log.md'];

  function isReserved(relPath) {
    const base = relPath.split('/').pop().toLowerCase();
    return RESERVED.includes(base);
  }

  // conceptId = relPath minus trailing ".md"
  function conceptId(relPath) {
    return relPath.replace(/\.md$/i, '');
  }

  // Split frontmatter / body. Returns {frontmatter, fmError, body, hasFM}
  function parse(content) {
    const result = { frontmatter: {}, fmError: null, body: content, hasFM: false, raw: content };
    // Frontmatter must start at very beginning with --- on its own line.
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) { return result; }
    result.hasFM = true;
    result.body = m[2] || '';
    try {
      const obj = global.jsyaml ? global.jsyaml.load(m[1]) : {};
      result.frontmatter = (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      result.fmError = e.message || String(e);
      result.frontmatter = {};
    }
    return result;
  }

  // Serialize frontmatter + body back to a string.
  function serialize(frontmatter, body) {
    const keys = Object.keys(frontmatter || {});
    if (!keys.length) return (body || '');
    let yaml;
    try {
      yaml = global.jsyaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).replace(/\n$/, '');
    } catch (e) {
      yaml = keys.map(k => `${k}: ${frontmatter[k]}`).join('\n');
    }
    return `---\n${yaml}\n---\n\n${(body || '').replace(/^\n+/, '')}`;
  }

  // Extract markdown links [text](target) from body. Returns array of {text,target}.
  function extractLinks(body) {
    const links = [];
    const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      links.push({ text: m[1], target: m[2] });
    }
    return links;
  }

  function isExternal(target) {
    return /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:');
  }

  // Resolve a markdown link target to a conceptId, relative to the source relPath.
  // Returns null for external links or anchors.
  function resolveTarget(target, srcRelPath) {
    if (!target || isExternal(target) || target.startsWith('#')) return null;
    let t = target.split('#')[0];
    if (!t) return null;
    let resolved;
    if (t.startsWith('/')) {
      resolved = t.replace(/^\//, '');
    } else {
      const dir = srcRelPath.includes('/') ? srcRelPath.replace(/\/[^/]*$/, '') : '';
      resolved = normalizePath(dir ? dir + '/' + t : t);
    }
    return conceptId(resolved);
  }

  function normalizePath(p) {
    const parts = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  // Build a graph model from docs: nodes (concepts) + edges (resolved links).
  function buildGraph(docs) {
    const concepts = docs.filter(d => !isReserved(d.relPath));
    const idSet = new Set(concepts.map(d => conceptId(d.relPath)));
    const nodes = concepts.map(d => {
      const p = parse(d.content);
      return {
        id: conceptId(d.relPath),
        relPath: d.relPath,
        type: (p.frontmatter.type || 'Sem tipo'),
        title: p.frontmatter.title || d.name.replace(/\.md$/i, ''),
        description: p.frontmatter.description || ''
      };
    });
    const edges = [];
    const backlinks = {}; // targetId -> [sourceId]
    for (const d of concepts) {
      const p = parse(d.content);
      const src = conceptId(d.relPath);
      const seen = new Set();
      for (const lk of extractLinks(p.body)) {
        const tgt = resolveTarget(lk.target, d.relPath);
        if (!tgt || tgt === src || seen.has(tgt)) continue;
        seen.add(tgt);
        const exists = idSet.has(tgt);
        edges.push({ source: src, target: tgt, exists });
        if (exists) (backlinks[tgt] = backlinks[tgt] || []).push(src);
      }
    }
    return { nodes, edges, backlinks, idSet };
  }

  // Validate conformance with OKF v0.1. Returns {errors, warnings, oks, counts}.
  function validate(docs) {
    const errors = [], warnings = [];
    const idSet = new Set(docs.filter(d => !isReserved(d.relPath)).map(d => conceptId(d.relPath)));
    let conceptCount = 0;

    for (const d of docs) {
      if (isReserved(d.relPath)) {
        // index.md may carry frontmatter only at bundle root (okf_version). Light check.
        continue;
      }
      conceptCount++;
      const p = parse(d.content);
      if (!p.hasFM) {
        errors.push({ where: d.relPath, msg: 'Sem bloco de frontmatter YAML (--- no início do arquivo).' });
        continue;
      }
      if (p.fmError) {
        errors.push({ where: d.relPath, msg: 'YAML inválido no frontmatter: ' + p.fmError });
        continue;
      }
      const type = p.frontmatter.type;
      if (type === undefined || type === null || String(type).trim() === '') {
        errors.push({ where: d.relPath, msg: 'Campo obrigatório "type" ausente ou vazio.' });
      }
      // soft guidance
      if (!p.frontmatter.title) warnings.push({ where: d.relPath, msg: 'Sem "title" — o consumidor derivará do nome do arquivo.' });
      if (!p.frontmatter.description) warnings.push({ where: d.relPath, msg: 'Sem "description" — recomendado para índices e buscas.' });
      // broken links (informative, not a conformance error per §5.3)
      for (const lk of extractLinks(p.body)) {
        const tgt = resolveTarget(lk.target, d.relPath);
        if (tgt && !idSet.has(tgt)) {
          warnings.push({ where: d.relPath, msg: `Link interno para conceito inexistente: "${lk.target}" (pode ser conhecimento ainda não escrito).` });
        }
      }
    }
    return {
      errors, warnings,
      counts: { concepts: conceptCount, errors: errors.length, warnings: warnings.length }
    };
  }

  global.OKF = {
    RESERVED, isReserved, conceptId, parse, serialize,
    extractLinks, resolveTarget, isExternal, buildGraph, validate
  };
})(window);
