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
  function typeOfDoc(doc) {
    const f = parse(doc.content).frontmatter;
    return (f && f.type != null && String(f.type).trim() !== '') ? String(f.type).trim() : 'Sem tipo';
  }
  function rootListing(docs) {
    const concepts = docs.filter(d => !isReserved(d.relPath));
    const byType = new Map();
    for (const d of concepts) {
      const t = typeOfDoc(d);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(d);
    }
    const parts = [];
    for (const t of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
      parts.push('## ' + t + '\n' + sortedBullets(byType.get(t)).join('\n'));
    }
    return parts.join('\n\n');
  }

  function protectedRanges(body) {
    const ranges = [];
    const add = (re) => { let m; while ((m = re.exec(body)) !== null) ranges.push([m.index, m.index + m[0].length]); };
    add(/```[\s\S]*?```/g);          // blocos de código
    add(/`[^`]*`/g);                 // código inline
    add(/\[[^\]]*\]\([^)]*\)/g);     // links existentes
    add(/\bhttps?:\/\/\S+/g);        // URLs
    return ranges;
  }
  function inRanges(start, end, ranges) {
    return ranges.some(([a, b]) => start < b && end > a);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function suggestLinks(body, concepts, selfId) {
    const ranges = protectedRanges(body);
    // títulos mais longos primeiro (mais específicos)
    const allCand = concepts
      .filter(c => c.title && c.title.trim())
      .map(c => ({ rel: c.relPath, title: String(c.title), isSelf: conceptId(c.relPath) === selfId }))
      .sort((a, b) => b.title.length - a.title.length);
    const out = [];
    const taken = []; // ranges já sugeridos (evita sobreposição)
    const seen = new Set();
    for (const c of allCand) {
      if (seen.has(c.rel)) continue;
      const re = new RegExp('(^|[^\\p{L}\\p{N}_])(' + escapeRe(c.title) + ')(?![\\p{L}\\p{N}_])', 'giu');
      let m;
      while ((m = re.exec(body)) !== null) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (inRanges(start, end, ranges) || inRanges(start, end, taken)) continue;
        taken.push([start, end]); // marca como ocupado mesmo que seja self
        if (!c.isSelf) {
          out.push({ text: m[2], start, end, targetRel: '/' + c.rel });
          seen.add(c.rel);
        }
        break; // só a 1ª ocorrência por alvo
      }
      if (c.isSelf) seen.add(c.rel); // não re-processar self
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function libraryFiles(name, dateStr) {
    const safeName = (name && name.trim()) ? name.trim() : 'Biblioteca';
    const indexBody = '# ' + safeName + '\n\n' +
      'Biblioteca de conhecimento no formato Open Knowledge Format (OKF v0.1).\n' +
      'Cada arquivo `.md` é um *conceito*. Use os links para navegar pelo grafo.\n\n' +
      MARK_START + '\n' + MARK_END + '\n';
    const index = serialize({ okf_version: '0.1' }, indexBody);
    const log = '# Histórico de Atualizações\n\n## ' + dateStr + '\n' +
      '* **Criação**: estrutura inicial da biblioteca com [índice raiz](/index.md).\n';
    return [
      { relPath: 'index.md', content: index },
      { relPath: 'log.md', content: log },
    ];
  }

  function applySuggestions(body, suggestions) {
    const sorted = [...suggestions].sort((a, b) => b.start - a.start); // da direita p/ esquerda
    let out = body;
    for (const s of sorted) {
      out = out.slice(0, s.start) + '[' + s.text + '](' + s.targetRel + ')' + out.slice(s.end);
    }
    return out;
  }

  function relativePath(fromDir, toRel) {
    const from = fromDir ? fromDir.split('/') : [];
    const to = toRel.split('/');
    const toFile = to.pop();
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const segs = from.slice(i).map(() => '..').concat(to.slice(i), [toFile]);
    return segs.join('/') || toFile;
  }

  const RENAME_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  function splitAnchor(t) { const i = t.indexOf('#'); return i >= 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, '']; }

  function rewriteRenameLinks(docs, fromRel, toRel) {
    const fromId = conceptId(fromRel);
    const out = [];
    for (const d of docs) {
      const p = parse(d.content);
      let changed = false;
      const body = p.body.replace(RENAME_LINK_RE, (full, text, target) => {
        if (isExternal(target) || target.startsWith('#')) return full;
        const [path0, anchor] = splitAnchor(target);
        if (d.relPath === fromRel) {
          // arquivo movido: recalcula seus próprios links relativos (a base mudou)
          if (target.startsWith('/')) return full;
          const id = resolveTarget(path0, fromRel);
          if (!id) return full;
          const nt = relativePath(dirOf(toRel), id + '.md') + (anchor ? '#' + anchor : '');
          if (nt !== target) changed = true;
          return '[' + text + '](' + nt + ')';
        }
        const id = resolveTarget(path0, d.relPath);
        if (id !== fromId) return full;
        let nt = target.startsWith('/') ? '/' + toRel : relativePath(dirOf(d.relPath), toRel);
        nt += anchor ? '#' + anchor : '';
        changed = true;
        return '[' + text + '](' + nt + ')';
      });
      if (changed) out.push({ relPath: d.relPath, newContent: serialize(p.frontmatter, body) });
    }
    return out;
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
      const newEnd = ins + 1 + block.length;
      if (lines[newEnd] !== undefined && /^##\s/.test(lines[newEnd])) {
        lines.splice(newEnd, 0, '');
      }
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

  // ---- Convenção "tipo é a pasta" ----
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function folderForType(type) { return slugify(type) || 'sem-tipo'; }
  function pathForConcept(type, title, taken) {
    const dir = folderForType(type);
    const base = slugify(title) || 'conceito';
    let name = base, k = 2;
    const has = (n) => (taken && (taken.has ? taken.has(dir + '/' + n + '.md') : false));
    while (has(name)) { name = base + '-' + (k++); }
    return dir + '/' + name + '.md';
  }
  function typeLabelLookup(docs) {
    const map = new Map();
    for (const d of docs) {
      if (isReserved(d.relPath)) continue;
      const t = parse(d.content).frontmatter.type;
      if (t == null || String(t).trim() === '') continue;
      const label = String(t).trim();
      const slug = folderForType(label);
      if (!map.has(slug)) map.set(slug, label);
    }
    return map;
  }
  function canonicalType(input, docs) {
    const label = String(input == null ? '' : input).trim();
    const existing = typeLabelLookup(docs).get(folderForType(label));
    return existing || label;
  }
  function moveTargetForType(relPath, type) {
    const base = relPath.split('/').pop();
    return folderForType(type) + '/' + base;
  }
  function planReorg(docs) {
    const taken = new Set(docs.map(d => d.relPath));
    const out = [];
    for (const d of docs) {
      if (isReserved(d.relPath)) continue;
      const f = parse(d.content).frontmatter;
      const type = (f && f.type != null) ? String(f.type).trim() : '';
      if (!type) continue;
      const dir = folderForType(type);
      const curDir = d.relPath.includes('/') ? d.relPath.replace(/\/[^/]*$/, '') : '';
      if (curDir === dir) continue; // já no lugar
      let to = dir + '/' + d.relPath.split('/').pop();
      let k = 2;
      while (taken.has(to)) { to = dir + '/' + d.relPath.split('/').pop().replace(/\.md$/i, '') + '-' + (k++) + '.md'; }
      taken.add(to);
      out.push({ from: d.relPath, to, title: (f && f.title) ? String(f.title) : d.relPath.split('/').pop().replace(/\.md$/i, '') });
    }
    return out;
  }

  const SYSTEM_GROUP_KEY = '__system__';
  // Agrupa conceitos para a árvore da sidebar. mode ∈ {'type','tag','flat'}.
  // Retorna grupos ordenados: normais alfabéticos; "Sem tipo"/"Sem tag" depois;
  // "Sistema" (reservados) sempre por último. Em 'tag', um conceito com várias
  // tags aparece em cada grupo de tag (duplicado).
  function groupConcepts(docs, mode) {
    const list = Array.isArray(docs) ? docs : [];
    const NOTYPE = '__notype__', NOTAG = '__notag__', FLAT = '__all__';
    const groups = new Map();
    const ensure = (key, label, opts) => {
      if (!groups.has(key)) groups.set(key, {
        key, label,
        special: !!(opts && opts.special),
        system: !!(opts && opts.system),
        items: []
      });
      return groups.get(key);
    };
    for (const d of list) {
      const f = parse(d.content).frontmatter || {};
      const reserved = isReserved(d.relPath);
      const base = d.relPath.split('/').pop().replace(/\.md$/i, '');
      const title = (f.title != null && String(f.title).trim() !== '') ? String(f.title) : base;
      const type = reserved ? '' : ((f.type != null && String(f.type).trim() !== '') ? String(f.type).trim() : '');
      const item = { relPath: d.relPath, title, type, reserved };
      if (reserved) { ensure(SYSTEM_GROUP_KEY, 'Sistema', { special: true, system: true }).items.push(item); continue; }
      if (mode === 'flat') { ensure(FLAT, '', {}).items.push(item); continue; }
      if (mode === 'tag') {
        const tags = Array.isArray(f.tags)
          ? f.tags.map(t => String(t).trim()).filter(Boolean)
          : (f.tags != null && String(f.tags).trim() !== '' ? [String(f.tags).trim()] : []);
        if (!tags.length) ensure(NOTAG, 'Sem tag', { special: true }).items.push(item);
        else for (const t of tags) ensure('tag:' + t, t, {}).items.push(item);
        continue;
      }
      if (!type) ensure(NOTYPE, 'Sem tipo', { special: true }).items.push(item);
      else ensure('type:' + type, type, {}).items.push(item);
    }
    for (const g of groups.values()) g.items.sort((a, b) => a.title.localeCompare(b.title));
    const rank = (g) => g.system ? 3 : (g.special ? 2 : (g.key === FLAT ? 0 : 1));
    return [...groups.values()].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
    });
  }

  const auto = { MARK_START, MARK_END, headingFor, titleOf, descOf, bulletFor, dirListing, rootListing, mergeManagedBlock, appendLog, relativePath, rewriteRenameLinks, suggestLinks, applySuggestions, libraryFiles, slugify, folderForType, pathForConcept, typeLabelLookup, canonicalType, moveTargetForType, planReorg, groupConcepts, SYSTEM_GROUP_KEY };

  global.OKF = {
    RESERVED, isReserved, conceptId, parse, serialize,
    extractLinks, resolveTarget, isExternal, buildGraph, validate, auto
  };
})(window);
