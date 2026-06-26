# Spec: Delta-reload (Leva 2)

- **Data:** 2026-06-26
- **Status:** Aprovado para planejamento
- **Origem:** revisão de código (perf #1 e #2 — full re-read O(n) por mutação e por evento do watcher).
- **Branch:** `perf/delta-reload`, criada a partir de `fix/review-batch-1` (PR #11 aberto) para evitar conflito em `renderer.js`. PR empilhado.

## Problema

Toda mutação no app chama `fs:applyOps` e depois `bundle:read`, que faz `walk(root)`
relendo **todos** os `.md` do disco; o renderer então reparseia tudo, reconstrói o
grafo e re-renderiza a árvore. O watcher faz o mesmo: **um** arquivo alterado
externamente dispara uma re-leitura **total**. Em bibliotecas grandes (centenas
de arquivos), e especialmente em pastas sincronizadas na nuvem, isso causa
travamento perceptível a cada salvar/criar/excluir/renomear/mover e a cada
escrita externa (ex.: Claude Code).

## Objetivo

Aplicar/recarregar apenas o **delta**, eliminando o I/O de disco O(n) tanto nas
mutações do app quanto nas mudanças externas. Grafo e árvore continuam
reconstruídos em memória (CPU barato; `parseDoc` já evita reparse redundante).

## Decisões (resumo)

| Tema | Decisão |
|------|---------|
| (A) Mutações no app | Patch de `state.docs` a partir das próprias `ops` — **sem reler o disco**. |
| (B) Mudanças externas | Watcher acumula os paths mudados; o main relê **só** esses `.md`; envia delta. |
| Fallback | Em falha do `applyOps`, ou erro/incerteza no delta → full `readBundle`. |
| Full reload preservado | Abrir biblioteca (`loadBundle`) e "Recarregar" continuam full. |
| Edição | No caminho do watcher, se o conceito aberto em edição mudou no disco, mostra o banner (não sobrescreve o editor) — como hoje. |
| Grafo/árvore | Continuam rebuild O(n) em CPU (sem I/O). Incremental fica fora de escopo. |

## Modelo do delta

```
delta = { upserts: [{ relPath, content }], deletes: [relPath] }
```

Apenas `.md` entram em `state.docs` (ops binárias/assets são ignoradas para a
árvore). `relPath` em formato posix (com `/`), como o `walk` já produz.

### Funções puras (testáveis)

- `opsToDelta(ops)` → `{ upserts, deletes }`: `create`/`write` (não-binária, `.md`)
  → upsert `{relPath, content}`; `delete` (`.md`) → push em `deletes`. Ignora ops
  binárias e não-`.md`.
- `applyDelta(docs, delta)` → novo array de docs: aplica `upserts` (substitui o doc
  de mesmo `relPath` ou acrescenta) e remove os `deletes`. Não muta o array de
  entrada nem os docs existentes (cria objetos novos para upserts, preservando o
  shape `{relPath, name, reserved, content}`). **A ordem de `state.docs` não é
  significativa** (`indexDocs`/`buildGraph` independem de ordem e o `renderTree`
  reordena por grupo/título), então upserts novos são apenas acrescentados ao fim.

## (A) Mutações no app — zero I/O

`applyOpsAndRefresh(ops, selectRel)`:
1. Chama `window.okf.applyOps({root, ops})`.
2. **Sucesso:** `state.docs = applyDelta(state.docs, opsToDelta(ops))`; depois
   `indexDocs()` (rebuild do grafo em memória — `parseDoc` reparseia só o que mudou),
   `buildTypeFilter`, `renderTree`, `refreshTypeDatalist`, e seleciona `selectRel`
   (abre o doc) — **sem `readBundle`**.
3. **Falha:** toast de erro + full `refreshFromDisk(null)` (comportamento atual).

`refreshFromDisk` (full, via `readBundle`) permanece para os casos de fallback e
"Recarregar".

## (B) Mudanças externas — re-leitura parcial

- `createWatcher(onChange)`: passa a **acumular** os paths absolutos de
  `add`/`change`/`unlink` num `Set` durante a janela de debounce (300 ms) e
  chamar `onChange(paths)` com o array (e limpar o `Set`). `pause()` limpa o
  acumulado pendente.
- `main.js` (callback do watcher): recebe os paths absolutos; para cada um sob a
  raiz e com extensão `.md` (respeitando o mesmo `ignored`): se existe no disco →
  lê o conteúdo e adiciona a `upserts`; se não existe → adiciona a `deletes`.
  Envia `bundle:changed` **com** `{ upserts, deletes }`. Se a computação do delta
  falhar, envia `bundle:changed` sem payload (sinal de "full reload").
- `preload.js`: `onBundleChanged(cb)` repassa o payload (delta ou `undefined`).
- `renderer.js` `reloadFromDisk(delta)`:
  - Sem `delta` → full `readBundle` (comportamento atual).
  - Com `delta` → patch via `applyDelta`; preserva a regra de edição: se
    `state.editing` e o conceito atual está nos `upserts` com conteúdo diferente
    do em memória, mostra `#disk-banner` em vez de sobrescrever; senão re-renderiza
    e mantém/abre a seleção.

## Consistência e segurança

- `applyOps` só retorna `ok` se **todas** as ops aplicaram → o delta do app é fiel.
- O watcher é pausado durante as mutações do app (`libWatcher.pause/resume`) → sem
  deltas espúrios das próprias escritas.
- Qualquer erro no caminho de delta (leitura, payload ausente) → full `readBundle`.
- `mtime` nos docs: hoje é gravado mas **não** é usado para invalidar cache (a
  comparação é por conteúdo); nos docs vindos do delta, `mtime` pode ser omitido
  ou `0` sem impacto.

## Arquivos afetados

- `renderer/okf.js` — `opsToDelta`, `applyDelta` (puros) + export.
- `watcher.js` — acumular paths e `onChange(paths)`.
- `main.js` — callback do watcher computa o delta (lê só os paths) e envia.
- `preload.js` — `onBundleChanged` repassa o payload.
- `renderer/renderer.js` — `applyOpsAndRefresh` (delta no sucesso) e
  `reloadFromDisk(delta)`.

## Testes

- Unidade (`test-grouping.js` ou novo, Node): `opsToDelta` (create/write/delete,
  filtra `.md`, ignora binária) e `applyDelta` (upsert substitui, append de novo,
  delete remove, não muta entrada).
- Smoke (`test-renderer.js`): aplicar um delta no renderer (via a função de patch)
  reflete na árvore sem chamar `readBundle`; e um delta de delete remove o nó.

## Fora de escopo (YAGNI)

- Grafo e árvore incrementais (continuam rebuild completo em memória).
- Mudança na semântica de busca/índices.
- Coalescência avançada de eventos do watcher além do debounce atual.
