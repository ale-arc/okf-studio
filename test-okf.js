const fs = require('fs'), path = require('path');
global.window = global;
global.jsyaml = require('js-yaml');
// load okf.js (it attaches OKF to window===global)
eval(fs.readFileSync('./renderer/okf.js','utf8'));
const OKF = global.OKF;

function walk(root, rel='') {
  let out=[];
  for (const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})) {
    if (e.name.startsWith('.')) continue;
    const cr = rel? rel+'/'+e.name : e.name;
    if (e.isDirectory()) out=out.concat(walk(root,cr));
    else if (e.name.endsWith('.md')) out.push({relPath:cr,name:e.name,reserved:OKF.isReserved(cr),content:fs.readFileSync(path.join(root,cr),'utf8')});
  }
  return out;
}

const docs = walk('./sample-library');
console.log('Arquivos .md encontrados:', docs.length);

// 1) parse + frontmatter
let typeOk=0;
for (const d of docs.filter(d=>!d.reserved)) {
  const p = OKF.parse(d.content);
  if (!p.hasFM) { console.log('  SEM FM:', d.relPath); continue; }
  if (p.fmError) { console.log('  FM ERRO:', d.relPath, p.fmError); continue; }
  if (p.frontmatter.type) typeOk++;
}
console.log('Conceitos com type válido:', typeOk);

// 2) graph
const g = OKF.buildGraph(docs);
console.log('Grafo -> nós:', g.nodes.length, '| arestas:', g.edges.length,
            '| arestas válidas:', g.edges.filter(e=>e.exists).length,
            '| arestas quebradas:', g.edges.filter(e=>!e.exists).length);
console.log('Backlinks de projetos/atlas:', (g.backlinks['projetos/atlas']||[]));

// 3) validate (should be conforme: 0 errors)
const v = OKF.validate(docs);
console.log('Validação -> conceitos:', v.counts.concepts, '| erros:', v.counts.errors, '| avisos:', v.counts.warnings);

// 4) serialize round-trip
const sample = docs.find(d=>d.relPath==='projetos/atlas.md');
const p = OKF.parse(sample.content);
const round = OKF.serialize(p.frontmatter, p.body);
const p2 = OKF.parse(round);
console.log('Round-trip type preservado:', p2.frontmatter.type === p.frontmatter.type,
            '| tags preservadas:', JSON.stringify(p2.frontmatter.tags)===JSON.stringify(p.frontmatter.tags));

// 5) inject an invalid doc (no type) and confirm error detected
docs.push({relPath:'quebrado.md',name:'quebrado.md',reserved:false,content:'---\ntitle: Sem tipo\n---\n# x'});
docs.push({relPath:'semfm.md',name:'semfm.md',reserved:false,content:'# Sem frontmatter'});
const v2 = OKF.validate(docs);
console.log('Após injetar inválidos -> erros:', v2.counts.errors, '(esperado >=2)');
console.log('Mensagens de erro:');
v2.errors.forEach(e=>console.log('   -', e.where, '::', e.msg));
console.log('\nTESTE OK');
