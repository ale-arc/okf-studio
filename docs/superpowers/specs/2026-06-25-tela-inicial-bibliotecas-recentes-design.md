# Spec: Tela inicial com bibliotecas recentes

- **Data:** 2026-06-25
- **Status:** Aprovado para planejamento
- **Versão atual do app:** 1.5.0

## Problema

Hoje, ao abrir o OKF Studio, a tela inicial (`#empty` em `renderer/index.html`)
oferece apenas dois botões: "Abrir biblioteca" e "Carregar exemplo". O app **não
lembra** quais bibliotecas o usuário já abriu — `currentRoot` (`main.js`) é só
estado de runtime e toda sessão começa do zero. Quem trabalha com uma ou mais
bibliotecas recorrentes precisa renavegar até a pasta toda vez.

## Objetivo

Na partida, mostrar uma **tela de seleção** com as bibliotecas recentemente
abertas, para o usuário escolher qual quer trabalhar — com favoritas, remoção da
lista e detecção de pasta ausente.

## Decisões (resumo)

| Tema | Decisão |
|------|---------|
| Partida | **Sempre** mostrar a tela de seleção; nenhuma biblioteca é auto-carregada. |
| Info por item | Nome, caminho completo no disco, último acesso ("há X"). Sem contagem de conceitos. |
| Gerenciamento | Remover item da lista; fixar favoritas no topo; detectar pasta ausente. |
| Layout | Lista centralizada (mantém o padrão visual da tela `#empty` atual). |
| Armazenamento | Arquivo JSON em `userData`, gerenciado pelo processo main. |

## Arquitetura e armazenamento

A lista de recentes precisa (a) sobreviver entre sessões e (b) detectar se a
pasta ainda existe — e `fs.existsSync` só roda no processo main. Por isso o
**main é o dono** dos recentes.

- Novo módulo **`recents.js`**, espelhando `git.js` / `templates.js`, que
  registra os handlers IPC e persiste em
  `path.join(app.getPath('userData'), 'recent-libraries.json')`.
- Registrado em `main.js` junto aos demais:
  `registerRecentsHandlers(ipcMain, app)`.
- Exposto no `preload.js` como `window.okf.recents.*`.

### Handlers IPC

| Canal | Entrada | Saída |
|-------|---------|-------|
| `recents:list` | — | `[{ path, name, lastOpened, favorite, exists }]` já ordenado |
| `recents:add` | `{ path, name }` | lista atualizada |
| `recents:remove` | `{ path }` | lista atualizada |
| `recents:toggleFavorite` | `{ path }` | lista atualizada |

`recents:list` enriquece cada item com `exists: fs.existsSync(path)` em tempo de
leitura (não é persistido).

## Modelo de dados

Cada item persistido no JSON:

```json
{ "path": "C:\\Users\\…\\okf-studio", "name": "Biblioteca OKF", "lastOpened": 1750800000000, "favorite": false }
```

- `name` e `path` são gravados **no momento em que a biblioteca é aberta com
  sucesso**, reaproveitando o que `loadBundle(res, name)` já tem em mãos —
  **sem leitura extra** da biblioteca só para montar a lista (tela inicial
  instantânea).
- `path` é a **chave de deduplicação**: reabrir a mesma pasta atualiza
  `lastOpened` e o `name`, não cria item novo.
- **Ordenação** (em `recents:list`): favoritas primeiro (entre si por
  `lastOpened` desc), depois as demais por `lastOpened` desc.
- **Cap de 20 itens**: ao exceder, descartar as mais antigas **não-favoritas**.
  Favoritas nunca são descartadas pelo cap.
- A **biblioteca de exemplo não entra** nos recentes (vive em `resources`, não é
  biblioteca do usuário). Ou seja: `openSample` não chama `recents:add`.

### Quando gravar

`recents:add` é chamado após carregamento bem-sucedido em:
- `openFolder` (abrir pasta via diálogo);
- `doCreateLibrary` (nova biblioteca);
- reabrir a partir da própria lista de recentes.

Não é chamado por `openSample`.

## Tela inicial (Layout: lista centralizada)

Substitui o conteúdo de `#empty` em `renderer/index.html`.

### Estrutura

- Título "OKF Studio" + subtítulo "Escolha uma biblioteca para começar".
- Lista centralizada de itens recentes; cada item em uma linha:
  `★ favorita · nome · caminho · "há X"` + botão `✕` remover.
- Rodapé com os botões existentes: **Abrir pasta… / Nova / Exemplo**.

### Interações por item

| Elemento | Ação |
|----------|------|
| Clique no item | Abre a biblioteca (`window.okf.readBundle(path)` → `loadBundle`) e atualiza recentes. |
| Estrela | Alterna favorita (`recents:toggleFavorite`) e re-renderiza a lista. |
| `✕` | Remove dos recentes (`recents:remove`). **Não** apaga nada no disco. |

### Pasta ausente (`exists: false`)

- Item **esmaecido**, com ícone de alerta no lugar da estrela.
- Clicar **não abre**; mostra um toast curto ("Pasta não encontrada").
- Apenas o `✕` (remover) funciona.

### Voltar à tela inicial sem reiniciar

- Nova ação **"Trocar biblioteca…"** no menu *Arquivo* (`main.js` `buildMenu`)
  e na paleta de comandos (Ctrl+P, `paletteActions` em `renderer.js`).
- Reexibe a tela inicial (recarrega a lista de recentes) sem fechar o app.

### Lista vazia

Na primeira execução (sem recentes), a tela cai no estado de boas-vindas atual:
só o título, o subtítulo e os três botões de ação.

## Renderização da data ("há X")

Helper local no renderer que formata `lastOpened` (epoch ms) em rótulo relativo
curto em pt-BR: "agora", "há N min", "há N h", "ontem", "há N dias"; acima de ~7
dias, data curta (`DD/MM/AAAA`).

## Fora de escopo (YAGNI)

- Renomear o rótulo (`name`) da biblioteca na lista.
- Contagem de conceitos por biblioteca.
- Busca/filtro dentro da lista de recentes.
- Sincronização de recentes entre máquinas.
- Auto-reabrir a última biblioteca (decidido: sempre mostrar a tela).

## Testes

Teste de unidade Node no estilo `test-*.js` do projeto, cobrindo a **lógica pura**
de `recents.js` (extraída de forma testável, sem depender de Electron):

- `add` deduplica por `path` e atualiza `lastOpened`/`name`.
- Ordenação: favoritas no topo, demais por `lastOpened` desc.
- Cap de 20 preservando favoritas (descarta a não-favorita mais antiga).
- `remove` tira o item correto.
- `toggleFavorite` alterna o flag.
- `exists` reflete pasta inexistente (com diretório temporário real).

Fluxo de UI continua coberto por verificação manual.

## Arquivos afetados (previsão)

- **Novo:** `recents.js` (módulo + handlers IPC).
- **Novo:** `test-recents.js` (teste de unidade), adicionado ao script `test`.
- `main.js` — registrar handlers; item "Trocar biblioteca…" no menu.
- `preload.js` — expor `window.okf.recents.*`.
- `renderer/index.html` — nova marcação da tela inicial em `#empty`.
- `renderer/renderer.js` — render da lista, interações, gravar recentes em
  `openFolder`/`doCreateLibrary`/reabrir, ação "Trocar biblioteca", helper de
  data relativa.
- `renderer/styles.css` — estilos da lista de recentes.
- `package.json` — incluir `recents.js` em `build.files` e `test-recents.js` no
  script `test`.
