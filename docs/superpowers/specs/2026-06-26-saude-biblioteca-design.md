# Spec: Saúde da biblioteca (lint do grafo de conhecimento)

- **Data:** 2026-06-26
- **Status:** Aprovado para planejamento
- **Origem:** proposta de nova funcionalidade. Atende o workflow **Lint** descrito
  no `CLAUDE.md` ("conceitos órfãos, links quebrados, `type` ausente…").
- **Branch:** `feat/saude-biblioteca` (a partir de `main`).

## Problema

O **Validar conformidade** atual só checa o que o OKF v0.1 exige no frontmatter
(YAML válido, campo `type`). Não há visão da **saúde do grafo de conhecimento**:
links quebrados, conceitos órfãos, tipos escritos de formas divergentes, índices
desatualizados, títulos duplicados. É exatamente o "Lint" que o formato pede.

## Objetivo

Um painel **Saúde da biblioteca** (overlay novo, irmão de Grafo/Validação/Manual)
que lista os achados agrupados por categoria, cada um **clicável** (abre o
conceito). Uma única **ação automática** (decisão do usuário): "Reconstruir
índices" quando houver índices desatualizados. As demais categorias só apontam.

## Categorias (v1)

| Categoria | Definição | Severidade |
|-----------|-----------|------------|
| 🔗 Links quebrados | link interno para conceito inexistente (`resolveTarget` resolve mas o id não existe) | erro |
| 🏝️ Conceitos órfãos | conceito (não-reservado) sem nenhum backlink de entrada | aviso |
| 🏷️ Tipos inconsistentes | mesmo `folderForType` (slug), múltiplos rótulos crus distintos (ex.: `Referência`/`referencia`) | aviso |
| 📇 Índices desatualizados | `indexOpsFrom(state.docs)` retorna ops (n arquivos `index.md` a (re)escrever/remover) | aviso + **ação** |
| 👯 Títulos duplicados | dois+ conceitos com o mesmo título (normalizado) | aviso |
| 📝 Sem descrição / sem tags | conceito sem `description` / sem `tags` | dica |

## Arquitetura

### Lógica pura — `OKF.health(docs)` (em `renderer/okf.js`)

Função pura, testável por unidade. Reaproveita `buildGraph`, `extractLinks`,
`resolveTarget`, `conceptId`, `isReserved`, `auto.folderForType`. Retorna:

```js
{
  brokenLinks:       [{ where, target }],          // where=relPath origem, target=texto do link
  orphans:           [{ where, title }],
  inconsistentTypes: [{ slug, canonical, variants:[label...] }], // canonical = rótulo mais frequente
  duplicateTitles:   [{ title, items:[{ where }] }],
  noDescription:     [{ where, title }],
  noTags:            [{ where, title }],
  counts: { brokenLinks, orphans, inconsistentTypes, duplicateTitles, noDescription, noTags }
}
```

> **Índices desatualizados não entram em `OKF.health`** — `indexOpsFrom` vive no
> renderer (`data.js`) e depende do estado de exibição. O painel compõe essa
> contagem à parte (`indexOpsFrom(state.docs).length`) e oferece o botão.

Exportada em `global.OKF.health`.

### View — `renderer/health.js` (módulo novo, segue a divisão recém-feita)

- `showHealth()`: `closeOverlays()`; `const h = OKF.health(state.docs)`;
  `const stale = indexOpsFrom(state.docs).length`; `renderHealth(h, stale)`;
  mostra `#health-view`. Guarda: exige `state.root`.
- `renderHealth(h, stale)`: monta o sumário (pílulas com contagens) + as seções.
  Cada achado é uma linha com `.where[data-rel]` clicável → `openDoc(rel)`.
  Reusa as classes CSS de `validate-view` (`.v-summary`, `.v-pill`, `.v-item`,
  `.where`, `.msg`) — **sem CSS novo** (só uma classe extra opcional para os
  botões de variantes de tipo).
- Quando `stale > 0`: botão "Reconstruir índices (n)" → `await rebuildIndexes()`
  e re-renderiza o painel.
- Estado vazio (tudo ok): "✓ Biblioteca saudável".

### HTML — `renderer/index.html`

- Novo overlay `#health-view` espelhando `#validate-view` (cabeçalho com título,
  botão `#health-close`, corpo `#health-body`).
- Botão na toolbar `#btn-health` (ícone ⚕/❤), ao lado de Validar.
- `#health-view` entra na lista de overlays de `closeOverlays()` (em `core.js`).

### Wiring — `renderer.js` (init) + `palette.js` + `main.js` (menu)

- `init()`: `$('btn-health').onclick = showHealth;` e
  `$('health-close').onclick = () => { closeOverlays(); if (state.current) showViewer(); };`
  e incluir `#health-view` no fechamento do Esc.
- `palette.js`: ação "Saúde da biblioteca" (`needsLib:true`).
- `main.js`: item de menu `menu:health` → `showHealth` (registrar em `init()` como
  os demais `window.okf.onMenu`).
- `closeOverlays()` em `core.js` passa a esconder também `#health-view`.

## Consistência e segurança

- `OKF.health` é pura e não muta `docs`.
- A única escrita é via `rebuildIndexes()` já existente (confirma e usa `applyOps`).
- `#btn-health` começa desabilitado e é habilitado em `loadBundle` junto com os
  outros (adicionar `'btn-health'` à lista de ids habilitados em `data.js`).

## Testes

- **Unidade** `test-health.js` (Node, `eval` do okf.js): monta docs com um link
  quebrado, um órfão, dois tipos divergentes mapeando ao mesmo slug, dois títulos
  iguais, um sem descrição/tags → assere cada categoria e as contagens. Não muta
  entrada. Adicionar ao script `test`.
- **Smoke** `test-renderer.js`: após carregar a sample e injetar um conceito com
  link quebrado, `showHealth()` popula `#health-view` e há ao menos 1 achado de
  link quebrado; clicar numa linha navega. Agregar ao `RESULT`.

## Fora de escopo (YAGNI)

- Ação "unificar tipo" que reescreve/move arquivos (decisão do usuário: v1 só
  reconstrói índices). Fica como evolução futura.
- Detecção de contradições semânticas (exige NLP).
- Correção automática de links quebrados.
