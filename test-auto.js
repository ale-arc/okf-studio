// test-auto.js — testes do núcleo OKF.auto (puro, sem DOM)
const fs = require('fs');
global.window = global;
global.jsyaml = require('js-yaml');
eval(fs.readFileSync('./renderer/okf.js', 'utf8'));
const OKF = global.OKF;
const A = OKF.auto;

let n = 0, fail = 0;
function eq(got, exp, msg) {
  n++;
  const G = JSON.stringify(got), E = JSON.stringify(exp);
  if (G !== E) { fail++; console.error('FAIL:', msg, '\n   got: ' + G + '\n   exp: ' + E); }
}
function ok(cond, msg) { n++; if (!cond) { fail++; console.error('FAIL:', msg); } }

// doc fake: relPath + content
function doc(relPath, fm, body) {
  return { relPath, name: relPath.split('/').pop(), content: OKF.serialize(fm, body || '') };
}

// ---- Task 1: helpers básicos ----
eq(A.headingFor('projetos'), 'Projetos', 'headingFor capitaliza');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas' })), 'Projeto Atlas', 'titleOf usa frontmatter');
eq(A.titleOf(doc('projetos/atlas.md', { type: 'Projeto' })), 'atlas', 'titleOf cai para nome do arquivo');
eq(A.descOf(doc('x.md', { type: 'X', description: 'Desc.' })), 'Desc.', 'descOf usa frontmatter');
eq(A.bulletFor(doc('projetos/atlas.md', { type: 'Projeto', title: 'Projeto Atlas', description: 'Migração.' })),
   '* [Projeto Atlas](/projetos/atlas.md) - Migração.', 'bulletFor com descrição');
eq(A.bulletFor(doc('a.md', { type: 'X', title: 'A' })), '* [A](/a.md)', 'bulletFor sem descrição');

// ---- Task 5: relativePath + rename ----
eq(A.relativePath('', 'projetos/x.md'), 'projetos/x.md', 'relativePath da raiz');
eq(A.relativePath('projetos', 'processos/x.md'), '../processos/x.md', 'relativePath entre pastas');
eq(A.relativePath('projetos', 'projetos/y.md'), 'y.md', 'relativePath mesma pasta');

const docsT5 = [
  doc('projetos/atlas.md', { type: 'Projeto', title: 'Atlas' },
      'Ver [abs](/processos/inc.md) e [rel](../processos/inc.md) e [anc](/processos/inc.md#sec).'),
  doc('processos/inc.md', { type: 'Processo', title: 'Inc' },
      'Liga em [atlas](/projetos/atlas.md).'),
  doc('log.md', {}, '# Histórico\n\n## 2026-06-24\n* **Criação**: [inc](/processos/inc.md).'),
];
const changes = A.rewriteRenameLinks(docsT5, 'processos/inc.md', 'ops/incidente.md');

const atlas = changes.find(c => c.relPath === 'projetos/atlas.md');
ok(atlas && atlas.newContent.includes('[abs](/ops/incidente.md)'), 'reescreve link absoluto');
ok(atlas && atlas.newContent.includes('[rel](../ops/incidente.md)'), 'reescreve link relativo preservando estilo');
ok(atlas && atlas.newContent.includes('[anc](/ops/incidente.md#sec)'), 'preserva âncora');

const moved = changes.find(c => c.relPath === 'processos/inc.md');
ok(!moved || moved.newContent.includes('[atlas](/projetos/atlas.md)'), 'link absoluto de saída do arquivo movido permanece');

const logc = changes.find(c => c.relPath === 'log.md');
ok(logc && logc.newContent.includes('[inc](/ops/incidente.md)'), 'reescreve links no log.md');

// ---- Task 4: log ----
const log0 = '# Histórico de Atualizações\n';
const log1 = A.appendLog(log0, '2026-06-25', '**Criação**: [X](/x.md).');
ok(log1.includes('## 2026-06-25\n* **Criação**: [X](/x.md).'), 'cria seção do dia');
ok(log1.indexOf('# Histórico') < log1.indexOf('## 2026-06-25'), 'título permanece no topo');

const log2 = A.appendLog(log1, '2026-06-25', '**Exclusão**: removido `y.md`.');
ok(log2.match(/## 2026-06-25/g).length === 1, 'não duplica a seção do dia');
ok(log2.indexOf('Criação') < log2.indexOf('Exclusão'), 'apenda bullet ao dia existente');

const log3 = A.appendLog(log1, '2026-06-26', '**Criação**: [Z](/z.md).');
ok(log3.indexOf('## 2026-06-26') < log3.indexOf('## 2026-06-25'), 'dia novo entra no topo (mais recente primeiro)');

// ---- Task 3: bloco gerenciado ----
const semMarcadores = '# Projetos\n\nTexto humano.\n';
const merged1 = A.mergeManagedBlock(semMarcadores, '* [X](/projetos/x.md)');
ok(merged1.startsWith('# Projetos\n\nTexto humano.\n'), 'preserva conteúdo existente');
ok(merged1.includes(A.MARK_START + '\n* [X](/projetos/x.md)\n' + A.MARK_END), 'insere bloco com listing');

const comMarcadores = 'topo\n' + A.MARK_START + '\nantigo\n' + A.MARK_END + '\nrodapé\n';
const merged2 = A.mergeManagedBlock(comMarcadores, '* [Y](/y.md)');
ok(merged2.includes('topo\n') && merged2.includes('rodapé\n'), 'preserva fora do bloco');
ok(merged2.includes(A.MARK_START + '\n* [Y](/y.md)\n' + A.MARK_END), 'substitui só o miolo');
ok(!merged2.includes('antigo'), 'remove conteúdo antigo do bloco');

const vazio = A.mergeManagedBlock(comMarcadores, '');
ok(vazio.includes(A.MARK_START + '\n' + A.MARK_END), 'listing vazio = bloco vazio');

// ---- Task 2: listagens ----
const docsT2 = [
  doc('processos/a.md', { type: 'Processo', title: 'Beta', description: 'B.' }),
  doc('processos/b.md', { type: 'Processo', title: 'Alfa', description: 'A.' }),
  doc('processos/index.md', {}, '# Processos'),
  doc('raiz.md', { type: 'Nota', title: 'Raiz', description: 'R.' }),
];
eq(A.dirListing(docsT2, 'processos'),
   '* [Alfa](/processos/b.md) - A.\n* [Beta](/processos/a.md) - B.',
   'dirListing ordena por título e ignora index.md');
ok(A.rootListing(docsT2).includes('## Processos'), 'rootListing tem seção da categoria');
ok(A.rootListing(docsT2).indexOf('* [Raiz](/raiz.md) - R.') < A.rootListing(docsT2).indexOf('## Processos'),
   'rootListing lista conceitos da raiz antes das categorias');

console.log(`\n${n} checagens, ${fail} falha(s)`);
if (fail) process.exit(1);
console.log('AUTO OK');
