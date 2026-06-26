# Spec: Autocomplete de [[wikilink]] no editor

- **Data:** 2026-06-26
- **Status:** Aprovado para planejamento
- **Origem:** proposta de nova funcionalidade (fluidez de escrita estilo
  Obsidian/Logseq).
- **Branch:** `feat/wikilink-autocomplete` (a partir de `main`).

## Problema

Para inserir um link a outro conceito hoje é preciso abrir o picker pelo botão
da barra. Quem escreve muito quer o gesto inline: digitar `[[`, buscar e inserir
sem tirar as mãos do texto.

## Objetivo

Ao digitar `[[` no editor (modo Visual/Milkdown), abrir um **popup ancorado no
cursor** com busca fuzzy dos conceitos da biblioteca; ↑/↓ navega, Enter/clique
escolhe, Esc fecha. A escolha substitui `[[query` por um link
`[Título](/caminho.md)` (mesmo formato do picker atual, resolvido pelos backlinks).

## Decisão de UX

Dropdown **inline no cursor** (não reusar o modal atual) — decisão do usuário.

## Arquitetura

### `src/editor/wikilink.js` (novo, dentro do bundle do editor)

- **`wikiLinkQuery(textBeforeCursor)`** — função **pura, exportada e testável**.
  Acha o último `[[` antes do cursor; retorna `{ from, query }` se estiver
  "aberto" (sem `]`/`[`/`\n` depois) ou `null`. `from` é o índice do `[[`.
- **`wikiLinkPlugin(getItems)`** — fábrica que devolve um plugin ProseMirror
  (via `$prose`) isolado por instância (PluginKey com seq). Gerencia:
  - um popup DOM (`.okf-wikilink-menu`, `position:fixed`) posicionado por
    `view.coordsAtPos`;
  - `recompute(view)` no `update`: lê o texto do bloco até o cursor, aplica
    `wikiLinkQuery`, filtra `getItems()` pelo termo (título/relPath), mostra/oculta;
  - `props.handleKeyDown`: quando ativo, ↑/↓/Enter/Esc controlam o popup;
  - `pick`: substitui o intervalo `[[query` por um nó de texto com a mark `link`
    (`href=/relPath`), reposiciona o cursor e remove a stored mark.
  - `getItems: () => [{ relPath, title }]` é injetado pelo renderer.

### `src/editor/index.js`

- `import { wikiLinkPlugin, wikiLinkQuery } from './wikilink.js'`.
- `const wikiLink = wikiLinkPlugin(opts.wikiLinkItems)` e `.use(wikiLink)` no build.
- `export { wikiLinkQuery as __wikiLinkQuery }` (hook de teste, via o bundle).

### Renderer — `renderer/concept.js`

- `editorOpts()` (helper novo): `{ onChange, wikiLinkItems: () => currentConceptsForLinks() }`.
  `currentConceptsForLinks()` já retorna `[{relPath, title}]` (exclui reservados e
  o conceito atual) — exatamente o provedor desejado.
- As **3** chamadas de `window.OKFEditor.create(...)` (enterEdit, setEditorMode
  visual, applyBodyEdit) passam `editorOpts()` no lugar do `{ onChange }` inline.

### Estilo — `renderer/styles.css`

- `.okf-wikilink-menu` + itens (`.wl-title` / `.wl-path` / `.sel`), no padrão do
  `.okf-slash-menu` existente.

## Consistência e segurança

- Plugin isolado por instância (PluginKey único) — sem vazamento entre editores.
- `destroy()` do plugin remove o popup (sem leak de DOM).
- O link inserido usa a mark `link` do schema → serializa como
  `[Título](/relPath)`, idêntico ao `insertConceptLink` atual.
- Sem rede; só conceitos locais. Sem alteração na CSP (o bundle já é `self`).

## Testes

- **Smoke** (`test-renderer.js`, ambiente real com o bundle):
  - `OKFEditor.__wikiLinkQuery('texto [[ban')` → `{from:6, query:'ban'}`;
    `'[[a]] depois'` e `'nada aqui'` → `null`.
  - Cria instância com `wikiLinkItems` fixo, digita `[[atl` → popup aparece com
    **1** item ("Atlas"); Enter insere `[Atlas](/projeto/atlas.md)` no markdown;
    popup fecha; `destroy()` não deixa popup órfão. Agregado ao `RESULT`.
- A função pura é coberta pelo `__wikiLinkQuery` rodando dentro do bundle real
  (evita um runner ESM separado só para uma função).

## Fora de escopo (YAGNI)

- Criar conceito novo a partir de um `[[` que não casa (ex.: "criar 'X'").
- Sintaxe `[[alvo|alias]]`.
- Autocomplete no modo Código (textarea) — só no Visual.
