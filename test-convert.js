// test-convert.js — testes do núcleo de conversão (puro, sem DOM/Electron)
const assert = require('assert');
let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }
function has(hay, needle, msg) { ok(String(hay).includes(needle), msg + ' (faltou: ' + needle + ')'); }

// ---- Task A1: buildPdfHtml ----
const { buildPdfHtml, PRINT_CSS } = require('./src/convert/pdf-html.js');
{
  const html = buildPdfHtml('# Título\n\nParágrafo com **negrito**.', { title: 'Doc', type: 'reference' }, {});
  has(html, '<!DOCTYPE html>', 'pdf-html: tem doctype');
  has(html, '<h1>Título</h1>', 'pdf-html: renderiza heading via marked');
  has(html, '<strong>negrito</strong>', 'pdf-html: renderiza negrito');
  has(html, '@page', 'pdf-html: inclui CSS @page');
  has(html, 'Doc', 'pdf-html: inclui o title do frontmatter no cabeçalho');
  const withBase = buildPdfHtml('![x](assets/a.png)', {}, { baseHref: 'file:///C:/lib/proj/' });
  has(withBase, '<base href="file:///C:/lib/proj/">', 'pdf-html: injeta base href quando fornecido');
  ok(PRINT_CSS.includes('@page'), 'PRINT_CSS exporta o CSS de impressão');
}

// ---- Task B2: txtToMarkdown ----
const { txtToMarkdown } = require('./src/convert/txt.js');
{
  ok(txtToMarkdown('linha 1\nlinha 2') === 'linha 1\nlinha 2\n', 'txt: preserva linhas e garante \\n final');
  ok(txtToMarkdown('a\r\nb') === 'a\nb\n', 'txt: normaliza CRLF');
  ok(txtToMarkdown('') === '', 'txt: vazio vira vazio');
}

// ---- Task B3: htmlToMarkdown ----
const { htmlToMarkdown } = require('./src/convert/html.js');
{
  has(htmlToMarkdown('<h1>Olá</h1>'), '# Olá', 'html: h1 vira #');
  has(htmlToMarkdown('<p><strong>x</strong></p>'), '**x**', 'html: strong vira **');
  has(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>'), '-   a', 'html: lista');
  const t = htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  has(t, '| A | B |', 'html: tabela GFM (cabeçalho)');
  has(t, '| 1 | 2 |', 'html: tabela GFM (linha)');
  has(htmlToMarkdown('<a href="https://x.com">link</a>'), '[link](https://x.com)', 'html: link');
}

// ---- Task B4: reconstructMarkdown ----
const { reconstructMarkdown } = require('./src/convert/reconstruct.js');
function it(str, x, y, fontSize, extra) { return Object.assign({ str, x, y, w: str.length * fontSize * 0.5, h: fontSize, fontSize, bold: false, italic: false }, extra || {}); }
{
  // Título grande + parágrafo normal
  const md1 = reconstructMarkdown([
    it('Capítulo 1', 50, 50, 24),
    it('Texto normal do parágrafo.', 50, 90, 12)
  ]);
  has(md1, '# Capítulo 1', 'reconstruct: fonte grande vira heading');
  has(md1, 'Texto normal do parágrafo.', 'reconstruct: parágrafo preservado');

  // Itens na mesma linha (mesmo y) juntam-se
  const md2 = reconstructMarkdown([ it('Olá ', 50, 50, 12), it('mundo', 90, 50, 12) ]);
  has(md2, 'Olá mundo', 'reconstruct: itens na mesma linha juntam');

  // Lista por marcador
  const md3 = reconstructMarkdown([ it('• Item um', 50, 50, 12), it('• Item dois', 50, 70, 12) ]);
  has(md3, '- Item um', 'reconstruct: bullet vira "-"');
  has(md3, '- Item dois', 'reconstruct: 2º bullet');

  // Tabela: 2 colunas alinhadas em x, 2 linhas
  const md4 = reconstructMarkdown([
    it('Nome', 50, 50, 12), it('Idade', 200, 50, 12),
    it('Ana', 50, 70, 12),  it('30', 200, 70, 12)
  ]);
  has(md4, '| Nome | Idade |', 'reconstruct: tabela cabeçalho');
  has(md4, '| --- | --- |', 'reconstruct: separador GFM');
  has(md4, '| Ana | 30 |', 'reconstruct: linha da tabela');

  // Negrito
  const md5 = reconstructMarkdown([ it('forte', 50, 50, 12, { bold: true }) ]);
  has(md5, '**forte**', 'reconstruct: negrito');
}

// ---- Task B5: assets ----
const { slugifyAsset, rewriteImageLinks } = require('./src/convert/assets.js');
{
  ok(slugifyAsset('Minha Foto.PNG') === 'minha-foto.png', 'assets: slug minúsculo com hífens');
  ok(slugifyAsset('a/b\\c.jpg') === 'a-b-c.jpg', 'assets: remove separadores');
  const md = 'Veja ![diagrama](okf-img:img1) e ![](okf-img:img2).';
  const out = rewriteImageLinks(md, { img1: 'assets/diagrama.png', img2: 'assets/img2.png' });
  has(out, '![diagrama](assets/diagrama.png)', 'assets: reescreve 1º link');
  has(out, '![](assets/img2.png)', 'assets: reescreve 2º link');
  ok(!out.includes('okf-img:'), 'assets: não sobra placeholder');
}

// ---- R1: ligaduras ----
const { reconstructMarkdown: _rmLig } = require('./src/convert/reconstruct.js');
{
  const md = _rmLig([ it('cientí', 50, 50, 12), it('fi', 78, 50, 12), it('ca', 86, 50, 12) ]);
  has(md, 'científica', 'ligadura: religa fi sem espaço');
  ok(!/cient[íi]\s+fi/.test(md), 'ligadura: não deixa "cientí fi"');
}

// ---- R2: tabela estrita ----
const RC = require('./src/convert/reconstruct.js');
{
  const tbl = [
    it('Nome', 50, 50, 12), it('Idade', 200, 50, 12),
    it('Ana', 50, 70, 12),  it('30', 200, 70, 12),
    it('Beto', 50, 90, 12), it('41', 200, 90, 12)
  ];
  ok(RC.isTableStrict(tbl) && RC.isTableStrict(tbl).length === 2, 'tabela: 3x2 real detectada (2 colunas)');

  ok(RC.isTableStrict([ it('uma linha só', 50, 50, 12) ]) === null, 'tabela: 1 linha -> null');

  const inc = [ it('A', 50, 50, 12), it('B', 200, 50, 12), it('frase longa', 50, 70, 12), it('outra', 50, 90, 12) ];
  ok(RC.isTableStrict(inc) === null, 'tabela: colunas inconsistentes -> null');

  const cross = [
    it('x', 50, 50, 12), it('y', 150, 50, 12), it('atravessa tudo', 40, 50, 12, { w: 140 }),
    it('x', 50, 70, 12), it('y', 150, 70, 12), it('atravessa tudo', 40, 70, 12, { w: 140 })
  ];
  ok(RC.isTableStrict(cross) === null, 'tabela: item cruzando gutter -> null');
}

// ---- R3: reflow + des-hifenização ----
const RC3 = require('./src/convert/reconstruct.js');
{
  const md1 = RC3.reconstructMarkdown([ it('Primeira linha do', 50, 50, 12), it('mesmo parágrafo.', 50, 64, 12) ]);
  has(md1, 'Primeira linha do mesmo parágrafo.', 'reflow: junta linhas do mesmo parágrafo');

  const md2 = RC3.reconstructMarkdown([ it('Parágrafo um.', 50, 50, 12), it('Parágrafo dois.', 50, 120, 12) ]);
  has(md2, 'Parágrafo um.\n\nParágrafo dois.', 'reflow: gap grande separa parágrafos');

  const md3 = RC3.reconstructMarkdown([ it('uma experi-', 50, 50, 12), it('ência boa', 50, 64, 12) ]);
  has(md3, 'experiência', 'reflow: des-hifeniza palavra quebrada');
  ok(!md3.includes('experi- ') && !/experi-\s*ência/.test(md3), 'reflow: remove o hífen de quebra');
}

// ---- R4: multi-coluna ----
const RC4 = require('./src/convert/reconstruct.js');
{
  const items = [];
  for (let k = 0; k < 6; k++) { items.push(it('L' + k, 50, 30 + k * 40, 12)); items.push(it('R' + k, 400, 30 + k * 40, 12)); }
  const groups = RC4.splitColumns(items);
  ok(groups.length === 2, 'colunas: detecta 2 colunas');
  ok(groups[0].every(i => i.x < 200) && groups[1].every(i => i.x >= 200), 'colunas: separa esquerda/direita');

  const md = RC4.reconstructMarkdown(items);
  ok(md.indexOf('L5') < md.indexOf('R0'), 'colunas: lê coluna esquerda inteira antes da direita');

  const single = [];
  for (let k = 0; k < 8; k++) single.push(it('linha ' + k, 50, 30 + k * 20, 12));
  ok(RC4.splitColumns(single).length === 1, 'colunas: 1 coluna permanece única');

  // regressão: tabela de 2 colunas e poucas linhas NÃO pode ser dividida em colunas
  const tbl3x2 = [
    it('Nome', 50, 50, 12), it('Idade', 200, 50, 12),
    it('Ana', 50, 70, 12),  it('30', 200, 70, 12),
    it('Beto', 50, 90, 12), it('41', 200, 90, 12)
  ];
  ok(RC4.splitColumns(tbl3x2).length === 1, 'colunas: tabela 3x2 não é dividida em colunas');
  has(RC4.reconstructMarkdown(tbl3x2), '| Nome | Idade |', 'colunas: tabela 3x2 sobrevive como tabela no pipeline');
}

// ---- R5: cabeçalho/rodapé ----
const RC5 = require('./src/convert/reconstruct.js');
{
  function page(items, height) { return { items, height }; }
  const mk = (n) => page([ it('Relatório X', 50, 5, 10), it('Conteúdo ' + n, 50, 50, 12) ], 100);
  const stripped = RC5.stripRunningHeadersFooters([ mk(1), mk(2), mk(3) ]);
  const allText = stripped.map(p => p.items.map(i => i.str).join(' ')).join(' | ');
  ok(!allText.includes('Relatório X'), 'head/foot: remove cabeçalho repetido');
  ok(allText.includes('Conteúdo 1') && allText.includes('Conteúdo 3'), 'head/foot: mantém conteúdo do miolo');

  const pn = [
    page([ it('3', 50, 95, 10), it('miolo a', 50, 50, 12) ], 100),
    page([ it('4', 50, 95, 10), it('miolo b', 50, 50, 12) ], 100)
  ];
  const s2 = RC5.stripRunningHeadersFooters(pn);
  const t2 = s2.map(p => p.items.map(i => i.str).join(' ')).join(' | ');
  ok(!/\b[34]\b/.test(t2) && t2.includes('miolo a'), 'head/foot: remove número de página solitário');

  const once = [ page([ it('Aviso único', 50, 5, 10), it('corpo', 50, 50, 12) ], 100),
                 page([ it('corpo só', 50, 50, 12) ], 100) ];
  const s3 = RC5.stripRunningHeadersFooters(once);
  ok(s3.map(p => p.items.map(i => i.str).join(' ')).join(' ').includes('Aviso único'), 'head/foot: mantém banda não repetida');
}

// ---- R7: rodapé com número de página embutido (alternando esquerda/direita) ----
{
  function pageHF(items, height) { return { items, height }; }
  // rodapé "© ABNT 2011 - reservados" + algarismo romano que varia e alterna de lado
  const fp = [
    pageHF([ it('ii © ABNT 2011 - reservados', 50, 95, 10), it('corpo 1', 50, 50, 12) ], 100),
    pageHF([ it('© ABNT 2011 - reservados iii', 50, 95, 10), it('corpo 2', 50, 50, 12) ], 100),
    pageHF([ it('iv © ABNT 2011 - reservados', 50, 95, 10), it('corpo 3', 50, 50, 12) ], 100)
  ];
  const sf = RC5.stripRunningHeadersFooters(fp);
  const tf = sf.map(p => p.items.map(i => i.str).join(' ')).join(' | ');
  ok(!tf.includes('reservados'), 'head/foot: remove rodapé repetido apesar do nº de página variável');
  ok(tf.includes('corpo 1') && tf.includes('corpo 3'), 'head/foot: mantém o miolo (variável)');
}

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('CONVERT OK');
