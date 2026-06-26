# Spec: Busca global + localizar-e-substituir

- **Data:** 2026-06-26
- **Status:** Implementado
- **Origem:** proposta de melhoria (poder de busca/refatoração de texto).
- **Branch:** `feat/busca-substituir` (a partir de `main`).

## Problema

A busca da sidebar (`#search`) casa no corpo, mas só **filtra a lista** — não
mostra onde casou nem permite substituir. Falta uma ferramenta para encontrar um
termo em toda a biblioteca (com trechos) e trocá-lo em massa.

## Decisões (do usuário)

- **Abrangência:** substitui **apenas no corpo** do conceito (frontmatter YAML
  preservado).
- **Motor/fluxo:** **literal** (busca case-insensitive por padrão, com toggle
  "Aa") + **revisão por arquivo** (checkboxes) antes de aplicar.

## Arquitetura

### Lógica pura — `renderer/okf.js` (exportada, testável)

- `searchConcepts(docs, query, opts)` → `[{ relPath, title, count, snippets }]`.
  Busca literal no **corpo** (ignora reservados e frontmatter). `snippets` = até 3
  trechos `{ before, match, after }` com ~30 chars de contexto. `opts.caseSensitive`.
- `replaceInBody(content, query, replacement, opts)` → `{ content, count }`.
  Substitui literalmente no corpo e re-serializa preservando o frontmatter
  (`serialize({}, body)` devolve o corpo intacto p/ arquivos sem FM). Sem match →
  conteúdo original e `count: 0`.

### View — `renderer/search.js` (módulo novo)

- `showSearch()` (exige `state.root`): abre o overlay `#search-view`, foca a busca.
- `runSearch()`: chama `OKF.searchConcepts` e renderiza resultados — por conceito:
  checkbox (marcado), título clicável (`openDoc`), caminho, contagem e trechos com
  `<mark>` no termo.
- `applyReplace()`: para cada conceito **marcado**, `OKF.replaceInBody` → `op:write`;
  confirma (mostra total) e aplica via `applyOpsAndRefresh`; re-roda a busca.

### HTML/CSS

- Overlay `#search-view` (irmão de health/validate): barra com `#sq` (buscar),
  `#sr` (substituir), `#sc` (toggle Aa), botões Buscar / Substituir; corpo
  `#search-body`. CSS próprio (`.search-*`, `mark`).

### Wiring

- `core.js closeOverlays()` inclui `#search-view`.
- `renderer.js init()`: fechar, `#sq-go`→runSearch, `#sr-go`→applyReplace, Enter
  nos campos, `onMenu('menu:search', showSearch)`, Esc inclui `#search-view`.
- `palette.js`: ação "Buscar e substituir" (`needsLib`).
- `main.js`: item de menu **Buscar e substituir** (`CmdOrCtrl+Shift+F`) → `menu:search`.
- `preload.js`: whitelist `menu:search`.

## Consistência e segurança

- Substituição só no corpo → YAML intacto (decisão).
- `applyOpsAndRefresh` já garante atomicidade (tudo-ou-nada) + patch sem reler disco.
- Revisão por arquivo (checkboxes) antes do confirm = dupla proteção.
- Sem regen de índices: a troca no corpo não afeta as listagens (título/descrição).

## Testes

- **Unidade** `test-search.js`: `searchConcepts` (contagem, snippets, case toggle,
  reservados/frontmatter ignorados) e `replaceInBody` (preserva FM, case toggle,
  no-match inalterado, arquivo sem FM). Adicionado ao `test`.
- **Smoke** `test-renderer.js`: `showSearch`+`runSearch` rendem 1 item, 2 trechos
  com `<mark>`, checkbox e sumário correto (sem IPC de escrita). Agregado ao `RESULT`.

## Fora de escopo (YAGNI)

- Regex e grupos de captura.
- Substituir no frontmatter / em títulos.
- Substituir tudo sem revisão (fluxo único escolhido: revisão por arquivo).
