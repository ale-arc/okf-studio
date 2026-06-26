# Spec: Divisão do renderer.js em módulos

- **Data:** 2026-06-26
- **Status:** Aprovado para planejamento
- **Origem:** revisão de código (item adiado — `renderer/renderer.js` com ~1694 linhas, único arquivo grande).
- **Branch:** `refactor/split-renderer` (a partir de `main`).

## Problema

`renderer/renderer.js` concentra toda a lógica da UI (tela inicial, árvore,
edição de conceito, git, grafo, paleta, modelos, indexação, reload). 1694 linhas
num só arquivo dificultam ler, revisar e evoluir, e aumentam a chance de erro em
edições pontuais.

## Objetivo

Quebrar o arquivo em fatias focadas, **sem mudar comportamento** (refactor puro).
Cada arquivo com uma responsabilidade clara, pequeno o bastante para caber na
cabeça de uma vez.

## Mecanismo (decisão-chave)

Manter o padrão atual do app: **scripts clássicos** (`<script src=...>`)
carregados em ordem em `index.html`, compartilhando o **escopo global** entre si.
Sem bundler, sem `type=module`, sem namespace novo.

Por quê: o app já funciona assim (ex.: `okf.js` IIFE em `window.OKF`,
`convert-ui.js` separado usando globais do renderer só em *call-time*). Todas as
funções/`const` de um script clássico ficam no escopo global compartilhado e são
resolvidas em *call-time*; como o único código que **executa** no carregamento é
`init()` (no fim do arquivo de entrada, carregado por último), a ordem entre as
fatias não afeta a execução — só importa que cada declaração apareça **uma vez**
e que o arquivo de entrada carregue por **último**.

Descartados:
- **ES modules** (`type=module`): muda timing (defer), impõe strict mode e quebra
  o compartilhamento global implícito → exigiria `import/export` em toda parte.
- **Namespace `App.*`**: churn em todos os call-sites, alto risco de regressão.

## Invariantes (o que NÃO pode mudar)

1. Cada nome de topo (`function`/`const`/`let`) declarado **exatamente uma vez**
   no conjunto dos arquivos.
2. Nenhum código executa no carregamento além de `init()` — nenhuma fatia lê um
   `const`/`let` de outra fatia em *top-level* (só dentro de funções).
3. O arquivo de entrada (com a chamada `init()`) carrega por último.
4. `let` de estado de módulo (ex.: `treeMenuRel`, `draggedRel`, `g6graph`,
   `manualRendered`, `renameFrom`, `paletteItems/paletteSel`, `tplSelected`,
   `appVersion`, `newLibDir`, `toastTimer`) migra junto da sua fatia.

## Corte proposto (ordem de carga em index.html, antes de `renderer.js`)

| # | Arquivo | Conteúdo (funções/estado) |
|---|---------|---------------------------|
| 1 | `core.js` | `$`, `state`, `LS`, `todayStr`, `baseNameOf`, `docByRel`, `escapeHtml`, `escapeAttr`, `fmtTimestamp`, `relTime`, `toast`+`toastTimer`, `parsedOf`, `bodyLcOf`, `showEmpty`, `showViewer`, `closeOverlays` |
| 2 | `prefs.js` | tema (`currentTheme`/`applyTheme`/`initTheme`/`toggleTheme`), `autoIndexEnabled`/`setAutoIndex`, `currentGroupMode`/`setGroupMode`/`updateGroupModeButtons`, `collapseKey`/`loadCollapsedSet`/`saveCollapsed`/`toggleGroup`, `favoritesKey`/`loadFavoritesSet`/`saveFavorites`/`toggleFavorite` |
| 3 | `data.js` | `indexDirs`, `indexContentFor`, `indexOpsFrom`, `logOpFrom`, `rerenderFromState`, `applyOpsAndRefresh`, `refreshFromDisk`, `reloadFromDisk`, `loadBundle`, `indexDocs`, `buildTypeFilter`, `refreshTypeDatalist` |
| 4 | `start.js` | `showStart`, `renderRecents`, `openRecent`, `switchLibrary`, `openFolder`, `openSample`, `newLibrary`+`newLibDir`, `closeNewLib`, `doCreateLibrary`, `reload`, `openClaude` |
| 5 | `tree.js` | `isValidDropTarget`, `handleDropOnGroup`, `renderTree`, `openTreeMenu`/`closeTreeMenu`+`treeMenuRel`/`draggedRel`, `openDoc` |
| 6 | `concept.js` | `renderConcept`, `rewireLinks`, `currentConceptsForLinks`, `refreshLinkSuggestions`, `openLinkPanel`, `applyBodyEdit`, `acceptSuggestion`/`dismissSuggestion`/`acceptAllSuggestions`, `enterEdit`, `setModeButtons`, `openConceptPicker`/`closeConceptPicker`/`renderConceptList`, `runToolbar`, `setEditorMode`, `currentBodyMarkdown`, `cancelEdit`, `saveEdit`, `changeConceptType`, `performMove`, `openRename`/`closeRename`/`doRename`+`renameFrom`, `openReorg`/`closeReorg`/`applyReorg`, `deleteCurrent`, `openModal`/`closeModal`/`createConcept`, `rebuildIndexes`, `applyTemplateToForm` |
| 7 | `git-panel.js` | `showGit`, `refreshGit`, `renderGit`, `gitCommit`, `gitPush`, `gitInit` |
| 8 | `graph-view.js` | `TYPE_COLORS`, `g6graph`, `graphThemeColors`, `showGraph`, `showValidation`, `itemHtml`, `showManual`+`manualRendered` |
| 9 | `palette.js` | `paletteItems`/`paletteSel`, `paletteActions`, `paletteConcepts`, `openPalette`/`closePalette`/`renderPalette`/`movePalette`/`activatePalette` |
| 10 | `templates-ui.js` | `loadTemplates`, `tplSelected`, `openTemplates`/`closeTemplates`/`renderTplList`/`clearTplForm`/`loadTplToForm`/`refreshTemplateSelect`/`saveTpl`/`deleteTpl`/`restoreTpl` |
| 11 | `renderer.js` (entry) | `appVersion`, `loadVersion`, `wireUpdates`, `init()` + chamada `init()` |

> `applyTemplateToForm` fica em `concept.js` (usa o form do modal de criação);
> `loadTemplates`/CRUD ficam em `templates-ui.js`. Limite definido por uso do form.

## Execução

Fatia por vez, em ordem (1→11). Para cada fatia:
1. Criar `renderer/<arquivo>.js` com as declarações movidas.
2. Removê-las de `renderer.js`.
3. Adicionar `<script src="<arquivo>.js">` em `index.html` **antes** de `renderer.js`
   (na posição correta da ordem).
4. Adicionar o arquivo a `build.files` no `package.json` (via padrão `renderer/**/*`
   já cobre; confirmar com `npm run check:files`).
5. `node -c` (sintaxe) + `npm test` + `npm run test:ui` → tudo verde.
6. Commit.

Cada passo deixa o app **funcional** (globais continuam globais, só mudam de
arquivo). `git bisect`-friendly.

## Pastas/arquivos afetados

- `renderer/core.js`, `prefs.js`, `data.js`, `start.js`, `tree.js`, `concept.js`,
  `git-panel.js`, `graph-view.js`, `palette.js`, `templates-ui.js` (novos).
- `renderer/renderer.js` (reduzido ao entry).
- `renderer/index.html` (10 novas tags `<script>` na ordem, antes de `renderer.js`).
- `package.json` `build.files` já cobre `renderer/**/*` — sem mudança esperada,
  mas `check:files` roda como rede de segurança.

## Testes

- `npm test` (unidades Node) — inalterado; garante que a lógica pura segue ok.
- `npm run test:ui` (smoke Electron que carrega o renderer real) — é a rede
  principal: detecta nome não-resolvido, declaração duplicada ou ordem de carga
  quebrada. Roda a cada fatia.

## Fora de escopo (YAGNI)

- Converter para ES modules / bundler do renderer.
- Introduzir namespace ou injeção de dependência.
- Qualquer mudança de comportamento, estilo ou API.
