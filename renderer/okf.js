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

  // ---- Automação determinística (índices, log, rename, cross-links) ----
  const MARK_START = '<!-- okf:index -->';
  const MARK_END = '<!-- /okf:index -->';

  function baseName(relPath) { return relPath.split('/').pop().replace(/\.md$/i, ''); }
  function dirOf(relPath) { return relPath.includes('/') ? relPath.replace(/\/[^/]*$/, '') : ''; }
  function headingFor(seg) { return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg; }

  function titleOf(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.title) ? String(f.title) : baseName(doc.relPath);
  }
  function descOf(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.description) ? String(f.description) : '';
  }
  function bulletFor(doc) {
    const desc = descOf(doc);
    return '* [' + titleOf(doc) + '](/' + doc.relPath + ')' + (desc ? ' - ' + desc : '');
  }

  function sortedBullets(docs) {
    return docs.map(d => ({ d, t: titleOf(d) }))
      .sort((a, b) => a.t.localeCompare(b.t))
      .map(x => bulletFor(x.d));
  }
  function dirListing(docs, dir) {
    const pre = dir ? dir + '/' : '';
    const items = docs.filter(d => !isReserved(d.relPath) &&
      d.relPath.startsWith(pre) && d.relPath.slice(pre.length).indexOf('/') < 0);
    return sortedBullets(items).join('\n');
  }
  function rootListing(docs) {
    const concepts = docs.filter(d => !isReserved(d.relPath));
    const rootItems = concepts.filter(d => d.relPath.indexOf('/') < 0);
    const byTop = new Map();
    for (const d of concepts) {
      const i = d.relPath.indexOf('/');
      if (i < 0) continue;
      const top = d.relPath.slice(0, i);
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top).push(d);
    }
    const parts = [];
    if (rootItems.length) parts.push(sortedBullets(rootItems).join('\n'));
    for (const top of [...byTop.keys()].sort()) {
      parts.push('## ' + headingFor(top) + '\n' + sortedBullets(byTop.get(top)).join('\n'));
    }
    return parts.join('\n\n');
  }

  function appendLog(content, dateStr, entry) {
    const bullet = '* ' + entry;
    const dateHdr = '## ' + dateStr;
    const lines = (content || '').split('\n');
    const idx = lines.findIndex(l => l.trim() === dateHdr);
    if (idx >= 0) {
      let end = lines.length;
      for (let i = idx + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break; } }
      let ins = end;
      while (ins > idx + 1 && lines[ins - 1].trim() === '') ins--;
      lines.splice(ins, 0, bullet);
      return lines.join('\n');
    }
    const titleIdx = lines.findIndex(l => /^#\s/.test(l));
    const block = [dateHdr, bullet];
    if (titleIdx >= 0) {
      let ins = titleIdx + 1;
      if (lines[ins] !== undefined && lines[ins].trim() === '') ins++;
      lines.splice(ins, 0, '', ...block);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n');
    }
    return (block.join('\n') + '\n\n' + (content || '')).replace(/\n{3,}/g, '\n\n');
  }

  function mergeManagedBlock(content, listing) {
    const inner = '\n' + (listing ? listing + '\n' : '');
    const s = content.indexOf(MARK_START);
    const e = content.indexOf(MARK_END);
    if (s >= 0 && e > s) {
      return content.slice(0, s + MARK_START.length) + inner + content.slice(e);
    }
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    return content + sep + MARK_START + inner + MARK_END + '\n';
  }

  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor, dirListing, rootListing, mergeManagedBlock, appendLog };

  global.OKF = {
    RESERVED, isReserved, conceptId, parse, serialize,
    extractLinks, resolveTarget, isExternal, buildGraph, validate, auto
  };
})(window);
