# Busca full-text + Paleta (Ctrl+P) + Modelos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar busca no conteúdo dos conceitos, uma paleta de comandos (Ctrl+P) para conceitos + ações, e modelos embutidos por tipo no modal Novo.

**Architecture:** Mudanças apenas no renderer (sem dependências novas). A busca estende o filtro de `renderTree`; a paleta é um modal novo com registro de ações + conceitos e navegação por teclado; os modelos são uma constante usada pelo `createConcept` e por um seletor no modal Novo.

**Tech Stack:** Electron 42, JS do renderer (sem libs novas), padrões de modal/lista já existentes.

---

## Visão geral de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `renderer/renderer.js` | Busca por conteúdo; paleta; `CONCEPT_TEMPLATES` + `createConcept` | Modificar |
| `renderer/index.html` | Modal `#palette`; seletor `#m-template` no modal Novo | Modificar |
| `renderer/styles.css` | Estilos da paleta | Modificar |
| `test-renderer.js` | Smoke: `#palette` existe + modelos presentes | Modificar |

---

## Task 1: Busca no conteúdo (full-text)

**Files:**
- Modify: `renderer/renderer.js` (função `renderTree`)

- [ ] **Step 1: Estender o filtro de busca**

Em `renderer/renderer.js`, na função `renderTree`, localizar a linha do filtro de busca (que hoje casa título/id/tags):
```js
    if (q && !(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) || tags.toLowerCase().includes(q))) continue;
```
e substituir por (incluindo o corpo do conceito, já parseado em `p`):
```js
    const body = (p.body || '').toLowerCase();
    if (q && !(title.toLowerCase().includes(q) || id.toLowerCase().includes(q) || tags.toLowerCase().includes(q) || body.includes(q))) continue;
```
(`p` é o resultado de `parsedOf(d)` já calculado acima nesse laço.)

- [ ] **Step 2: Verificar manualmente**

Run: `npm start`, abra **✨ Exemplo**, e busque por um termo que só apareça no **corpo** de um conceito (ex.: uma palavra de dentro do texto). O conceito deve aparecer na árvore. Fechar o app.

- [ ] **Step 3: Smoke (sem regressão)**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 4: Commit**
```bash
git add renderer/renderer.js
git commit -m "feat: busca também no conteúdo (corpo) dos conceitos"
```

---

## Task 2: Modelos por tipo (embutidos)

**Files:**
- Modify: `renderer/renderer.js` (`CONCEPT_TEMPLATES`, `openModal`, `createConcept`, `init`)
- Modify: `renderer/index.html` (seletor `#m-template`)

- [ ] **Step 1: Definir os modelos (renderer.js)**

Em `renderer/renderer.js`, perto do topo (após a definição de `state`), adicionar:
```js
const CONCEPT_TEMPLATES = {
  'Em branco': { type: '', body: 'Descreva aqui.\n' },
  'Projeto':   { type: 'Projeto',   body: '## Objetivo\n\n\n## Status\n\n\n## Marcos\n\n' },
  'Processo':  { type: 'Processo',  body: '## Quando usar\n\n\n## Passos\n\n1. \n\n## Responsáveis\n\n' },
  'Métrica':   { type: 'Métrica',   body: '## Definição\n\n\n## Como calcular\n\n\n## Fonte\n\n' },
  'Referência':{ type: 'Referência',body: '## Resumo\n\n\n## Detalhes\n\n' },
  'Playbook':  { type: 'Playbook',  body: '## Gatilho\n\n\n## Passos\n\n1. \n\n## Pós-ação\n\n' }
};
window.__okfTemplates = CONCEPT_TEMPLATES; // exposto para o smoke test
```

- [ ] **Step 2: Seletor Modelo no modal Novo (HTML)**

Em `renderer/index.html`, dentro de `<div id="modal" ...>`, logo após o `<h2>Novo conceito</h2>`, adicionar:
```html
      <label>Modelo
        <select id="m-template"></select>
      </label>
```

- [ ] **Step 3: Popular o seletor e reagir à escolha (renderer.js)**

Em `renderer/renderer.js`, na função `openModal`, no início (onde já limpa os campos), garantir o preenchimento do seletor. Localizar:
```js
  ['m-path','m-type','m-title','m-description'].forEach(id => $(id).value = '');
```
e adicionar logo depois:
```js
  const tplSel = $('m-template');
  if (!tplSel.options.length) tplSel.innerHTML = Object.keys(CONCEPT_TEMPLATES).map(n => `<option>${escapeHtml(n)}</option>`).join('');
  tplSel.value = 'Em branco';
```

Em `renderer/renderer.js`, dentro de `init()`, adicionar a reação à troca de modelo (preenche o `type` se vazio):
```js
  $('m-template').addEventListener('change', () => {
    const tpl = CONCEPT_TEMPLATES[$('m-template').value];
    if (tpl && tpl.type && !$('m-type').value.trim()) $('m-type').value = tpl.type;
  });
```

- [ ] **Step 4: Usar o modelo no `createConcept` (renderer.js)**

Em `renderer/renderer.js`, na função `createConcept`, localizar a montagem do conteúdo:
```js
  const content = OKF.serialize(fm, '# ' + (fm.title || 'Novo conceito') + '\n\nDescreva aqui.\n');
```
e substituir por:
```js
  const tpl = CONCEPT_TEMPLATES[$('m-template').value] || CONCEPT_TEMPLATES['Em branco'];
  const content = OKF.serialize(fm, '# ' + (fm.title || 'Novo conceito') + '\n\n' + tpl.body);
```

- [ ] **Step 5: Verificar manualmente**

Run: `npm start`, abra **✨ Exemplo** → **＋ Novo**. Escolha o modelo **Projeto** (o `type` é preenchido), informe um caminho e crie. O conceito deve abrir com as seções `## Objetivo`, `## Status`, `## Marcos`. Fechar o app.

- [ ] **Step 6: Smoke**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 7: Commit**
```bash
git add renderer/renderer.js renderer/index.html
git commit -m "feat: modelos embutidos por tipo no modal Novo conceito"
```

---

## Task 3: Paleta de comandos (Ctrl+P)

**Files:**
- Modify: `renderer/index.html` (modal `#palette`)
- Modify: `renderer/styles.css`
- Modify: `renderer/renderer.js` (lógica + atalho)

- [ ] **Step 1: Modal da paleta (HTML)**

Em `renderer/index.html`, logo após o `<div id="concept-modal" ...>...</div>`, adicionar:
```html
  <div id="palette" class="modal hidden">
    <div class="modal-card palette-card">
      <input id="palette-input" type="text" placeholder="Ir para conceito ou ação…" autocomplete="off" />
      <div id="palette-list" class="palette-list"></div>
    </div>
  </div>
```

- [ ] **Step 2: Estilos (CSS)**

Em `renderer/styles.css`, ao final, adicionar:
```css
/* paleta de comandos */
.palette-card{width:560px;max-width:92vw;padding:10px}
#palette-input{width:100%;font-size:15px}
.palette-list{max-height:50vh;overflow:auto;margin-top:10px}
.pal-item{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:6px;cursor:pointer}
.pal-item.sel,.pal-item:hover{background:var(--panel2)}
.pal-kind{font-size:10px;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);
  border-radius:4px;padding:1px 6px;min-width:58px;text-align:center}
.pal-label{flex:1}
.pal-sub{font-size:11px;color:var(--muted)}
.pal-empty{padding:12px;color:var(--muted)}
```

- [ ] **Step 3: Lógica da paleta (renderer.js)**

Em `renderer/renderer.js`, adicionar (perto de `openModal`/`showGit`):
```js
/* ---------- Paleta de comandos (Ctrl+P) ---------- */
let paletteItems = [], paletteSel = 0;
function paletteActions() {
  const lib = !!state.root;
  return [
    { label: 'Novo conceito', run: openModal, needsLib: true },
    { label: 'Grafo de relacionamentos', run: showGraph, needsLib: true },
    { label: 'Validar conformidade', run: showValidation, needsLib: true },
    { label: 'Painel Git', run: showGit, needsLib: true },
    { label: 'Claude Code (terminal)', run: openClaude, needsLib: true },
    { label: 'Recarregar biblioteca', run: reload, needsLib: true },
    { label: 'Manual do OKF Studio', run: showManual, needsLib: false },
    { label: 'Alternar tema claro/escuro', run: toggleTheme, needsLib: false },
    { label: 'Abrir biblioteca…', run: openFolder, needsLib: false },
    { label: 'Carregar biblioteca de exemplo', run: openSample, needsLib: false }
  ].filter(a => !a.needsLib || lib).map(a => ({ kind: 'ação', label: a.label, sub: '', run: a.run }));
}
function paletteConcepts() {
  if (!state.root) return [];
  return state.docs.filter(d => !d.reserved).map(d => {
    const f = parsedOf(d).frontmatter;
    return { kind: 'conceito', label: f.title || d.name.replace(/\.md$/i, ''), sub: d.relPath, run: () => openDoc(d.relPath) };
  });
}
function openPalette() {
  $('palette-input').value = '';
  renderPalette('');
  $('palette').classList.remove('hidden');
  $('palette-input').focus();
}
function closePalette() { $('palette').classList.add('hidden'); }
function renderPalette(q) {
  const ql = (q || '').toLowerCase().trim();
  const all = paletteActions().concat(paletteConcepts());
  paletteItems = all.filter(it => !ql || it.label.toLowerCase().includes(ql) || (it.sub && it.sub.toLowerCase().includes(ql)));
  paletteSel = 0;
  const list = $('palette-list');
  if (!paletteItems.length) { list.innerHTML = '<div class="pal-empty">Nada encontrado.</div>'; return; }
  list.innerHTML = paletteItems.map((it, i) =>
    `<div class="pal-item${i === 0 ? ' sel' : ''}" data-i="${i}">` +
    `<span class="pal-kind">${it.kind}</span><span class="pal-label">${escapeHtml(it.label)}</span>` +
    (it.sub ? `<span class="pal-sub">${escapeHtml(it.sub)}</span>` : '') + `</div>`).join('');
  list.querySelectorAll('.pal-item').forEach(el => el.addEventListener('click', () => activatePalette(+el.dataset.i)));
}
function movePalette(delta) {
  if (!paletteItems.length) return;
  paletteSel = (paletteSel + delta + paletteItems.length) % paletteItems.length;
  const els = $('palette-list').querySelectorAll('.pal-item');
  els.forEach((el, i) => el.classList.toggle('sel', i === paletteSel));
  if (els[paletteSel]) els[paletteSel].scrollIntoView({ block: 'nearest' });
}
function activatePalette(i) {
  const it = paletteItems[typeof i === 'number' ? i : paletteSel];
  if (!it) return;
  closePalette();
  it.run();
}
```

- [ ] **Step 4: Ligações e atalho (renderer.js)**

Em `renderer/renderer.js`, dentro de `init()`, adicionar:
```js
  $('palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
  $('palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); activatePalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('palette').addEventListener('click', (e) => { if (e.target === $('palette')) closePalette(); });
```

Em `renderer/renderer.js`, no listener global de `keydown` (o mesmo que trata Escape), adicionar **no início do handler** o atalho Ctrl+P:
```js
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette(); return; }
```
E, ainda no mesmo handler, na linha do `Escape`, incluir o fechamento da paleta logo após `closeModal();`:
```js
 closePalette();
```

- [ ] **Step 5: Verificar manualmente**

Run: `npm start`, abra **✨ Exemplo**, tecle **Ctrl+P**. Digite parte do nome de um conceito → use ↑/↓ e **Enter** para abri-lo. Digite "grafo" → Enter abre o grafo. **Esc** fecha. Fechar o app.

- [ ] **Step 6: Smoke**

Run: `npm run test:ui`
Expected: `RESULT: PASS`.

- [ ] **Step 7: Commit**
```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js
git commit -m "feat: paleta de comandos (Ctrl+P) para conceitos e ações"
```

---

## Task 4: Smoke da paleta/modelos e README

**Files:**
- Modify: `test-renderer.js`
- Modify: `README.md`

- [ ] **Step 1: Smoke (test-renderer.js)**

Em `test-renderer.js`, no objeto retornado pelo `executeJavaScript`, adicionar:
```js
    paletteUI: !!(document.getElementById('palette') && document.getElementById('palette-input')),
    templates: !!(window.__okfTemplates && Object.keys(window.__okfTemplates).length >= 6),
```
Na linha que compõe o veredito final (a do `console.log('RESULT...')` e a do `app.exit`), incluir `&& result.paletteUI && result.templates` nas DUAS. Por exemplo, criar uma variável e usá-la:
```js
  const okExtra = result.paletteUI === true && result.templates === true;
  console.log('  paleta + modelos:', result.paletteUI, result.templates);
```
e adicionar `&& okExtra` às duas linhas do veredito.

- [ ] **Step 2: Rodar a suíte**

Run: `npm test && npm run test:ui`
Expected: `TESTE OK`; `RESULT: PASS` com `paleta + modelos: true true` e `CSP violations: none`.

- [ ] **Step 3: Atualizar o README**

Em `README.md`, na lista de recursos ("## O que o app faz"), após a linha do "Painel Git", adicionar:
```markdown
- **Busca no conteúdo** — a busca encontra o termo também no corpo dos conceitos
  (não só título/tags).
- **Paleta de comandos** (`Ctrl+P`) — pular para qualquer conceito ou disparar
  ações pelo teclado.
- **Modelos por tipo** — ao criar um conceito, escolha um modelo (Projeto,
  Processo, Métrica, Referência, Playbook) que gera a estrutura do corpo.
```

- [ ] **Step 4: Commit + push**
```bash
git add test-renderer.js README.md
git commit -m "test+docs: smoke da paleta/modelos e README das 3 melhorias"
git push origin HEAD
```

---

## Notas de verificação

- A busca por conteúdo reusa `parsedOf(d).body` (já memoizado); sem custo extra
  de parsing por tecla.
- A paleta abre sempre; sem biblioteca, mostra só ações globais (Abrir, Exemplo,
  Tema, Manual) e nenhum conceito.
- O `Ctrl+P` é capturado no listener global de `keydown` antes do tratamento de
  Escape; o `preventDefault` evita o diálogo de impressão do Chromium.
```
