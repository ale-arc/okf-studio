# Design — Editor visual de tabelas (item 1)

Data: 2026-06-25
Item coberto: **1** (melhorar a edição visual de tabelas no editor Milkdown).

## Contexto

O editor visual ([src/editor/index.js](../../../src/editor/index.js), Milkdown/ProseMirror,
empacotado como `window.OKFEditor`) hoje só consegue **inserir** uma tabela 3×3
(`insertTableCommand` ligado ao botão "Tabela" e ao slash). Não há UI para editar a
estrutura: incluir/excluir/mover linhas e colunas, alinhamento etc. O `@milkdown/preset-gfm`
já expõe os comandos necessários — eles só não estão ligados a nenhuma interface.

A partir do ciclo anterior, o editor passou a ser **por instância** (`createInstance`), usado
tanto na edição de conceito quanto no modal de import.

## Decisões (brainstorming)

1. **GFM puro.** Tabelas continuam em Markdown GFM. **Mesclar células** e **cor de fundo de
   célula** ficam **fora de escopo** — não são representáveis em GFM (só em HTML, o que
   quebraria a portabilidade/simplicidade do OKF e o round-trip Markdown do editor).
2. **Barra contextual (padrão A).** Uma barra de ferramentas surge **acima da tabela** quando
   o cursor entra nela e some quando sai.
3. Cabeçalho: no GFM a 1ª linha é sempre o cabeçalho (obrigatório); não há botão de
   liga/desliga (comportamento fixo do formato).

## Recursos da barra

Cada botão dispara um comando já existente (ProseMirror/Milkdown), operando sobre a tabela
onde está o cursor:

| Grupo | Ações | Comando |
|---|---|---|
| Colunas | inserir à esquerda / à direita | `addColBeforeCommand` / `addColAfterCommand` (preset-gfm) |
| Colunas | excluir coluna | `deleteColumn` (prosemirror-tables, via `@milkdown/prose/tables`) |
| Colunas | mover ◀ / ▶ | `moveColCommand` (preset-gfm) |
| Linhas | inserir acima / abaixo | `addRowBeforeCommand` / `addRowAfterCommand` (preset-gfm) |
| Linhas | excluir linha | `deleteRow` (prosemirror-tables) |
| Linhas | mover ▲ / ▼ | `moveRowCommand` (preset-gfm) |
| Alinhamento | esquerda / centro / direita | `setAlignCommand` (preset-gfm) com `'left'|'center'|'right'` |
| Tabela | excluir tabela | selecionar o nó `table` e `deleteSelection` |

Observações:
- `moveColCommand`/`moveRowCommand` recebem `{ from, to }` (índices). A barra calcula
  `from` a partir da célula atual e `to = from ± 1`, respeitando limites.
- `deleteColumn`/`deleteRow` do `prosemirror-tables` operam direto no estado; chamadas como
  `cmd(view.state, view.dispatch)`.
- Excluir tabela: localizar a posição do nó `table` que contém a seleção, criar uma
  `NodeSelection`/range e despachar `delete`.

## Arquitetura

### Novo: `src/editor/table-toolbar.js`
Plugin Milkdown construído com `$prose((ctx) => new Plugin({...}))` (de `@milkdown/utils` +
`@milkdown/prose/state`). Responsabilidades:

- **Detecção de contexto:** no `view.update`, subir de `state.selection.$from` procurando um
  nó `table`; guardar sua posição e o DOM (`view.nodeDOM(pos)`).
- **Barra (DOM):** um `<div class="okf-table-toolbar">` criado uma vez e **anexado dentro do
  host do editor** (o elemento que rola). Posição via `offsetTop`/`offsetLeft` do DOM da
  tabela (acima dela). Sem tabela na seleção → `display:none`.
- **Botões → comandos:** cada botão chama `ctx.get(commandsCtx).call(key, payload)` para os
  comandos do preset-gfm, ou aplica diretamente os comandos de `@milkdown/prose/tables`
  (`deleteColumn`/`deleteRow`) via `view.state`/`view.dispatch`. Depois `view.focus()`.
- **Limpeza:** `destroy()` remove o nó da barra e listeners.

Exporta `tableToolbar` (o plugin) para `index.js`.

### `src/editor/index.js`
- Importar `tableToolbar` e adicioná-lo em `createInstance` com `.use(tableToolbar)` (depois
  de `gfm`). Como cada instância registra seu próprio plugin/barra, funciona isolado por
  instância (edição de conceito e modal de import não colidem).
- API pública (`getMarkdown`, `setMarkdown`, `runCommand`, `destroy`, …) **inalterada**.

### `renderer/styles.css`
- `.okf-table-toolbar`: posicionado `absolute` dentro do host, fundo `var(--panel)`, borda
  `var(--line)`, sombra leve, `z-index` acima do conteúdo; botões pequenos no estilo de
  `.editor-toolbar` (separadores `.tb-sep`). Visível em tema claro/escuro via variáveis.

### Host do editor
- Garantir que o host (`.milkdown-host`) seja `position: relative` para o `offsetTop` da barra
  ser relativo a ele. (Hoje já é o contêiner de rolagem; adicionar `position:relative` se
  faltar.)

### Mitigação de risco (posicionamento)
Se o posicionamento flutuante acima da tabela se mostrar instável dentro do modal de import ou
com rolagem, a barra passa a ficar **fixada no topo da área de edição** (sticky), mantendo os
mesmos botões e a mesma lógica de habilitar/desabilitar conforme o contexto. Decisão tomada na
implementação, com base no comportamento real; não muda a API nem os testes de comportamento.

## Escopo

**Fora de escopo:** mesclar células; cor de fundo de célula; múltiplas linhas de cabeçalho;
tabelas em HTML. (Todos exigiriam abandonar o Markdown GFM portável.)

## Testes

Smoke Electron, estendendo [test-renderer.js](../../../test-renderer.js) (já exercita o editor
e o round-trip de tabela):

1. Criar a instância do editor com um corpo que contém uma tabela GFM 2×2.
2. Posicionar a seleção dentro de uma célula → `.okf-table-toolbar` fica **visível**.
3. Clicar "inserir coluna à direita" → `getMarkdown()` passa a ter 3 colunas (3 `|` por linha
   na linha de cabeçalho/separador).
4. Clicar "inserir linha abaixo" → uma linha de corpo a mais.
5. Clicar "alinhar à direita" na 1ª coluna → a linha separadora vira `---:` na 1ª coluna.
6. Mover a seleção para fora da tabela → barra **oculta**.
7. O round-trip do markdown continua sem `<table>`/HTML (permanece GFM).

`npm test` (node) permanece igual — a lógica é ProseMirror/DOM e fica coberta pelo smoke
Electron (`npm run test:ui`).

Smoke manual: editar um conceito, inserir tabela, exercitar todos os botões, salvar e conferir
que o `.md` salvo é GFM limpo (sem HTML).

## Riscos / observações

- **Posicionamento** em contexto de modal/scroll — mitigado pela alternativa sticky acima.
- **`commandsCtx`/`$prose`** — APIs públicas do Milkdown v7 (confirmadas nos pacotes
  instalados). `deleteColumn`/`deleteRow`/`CellSelection` vêm de `prosemirror-tables`,
  reexportados por `@milkdown/prose/tables`.
- **Bundle** — `npm run build:editor` precisa rodar após mudanças em `src/editor/*`; é parte
  do `prestart`.
