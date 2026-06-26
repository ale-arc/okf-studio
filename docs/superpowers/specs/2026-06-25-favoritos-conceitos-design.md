# Spec: Favoritos de conceitos (Peça 2)

- **Data:** 2026-06-25
- **Status:** Aprovado para planejamento
- **Parte de:** Melhorias da sidebar (3 peças: 1-Navegação ✅ · 2-Favoritos · 3-Drag-and-drop)
- **Depende de:** Peça 1 (`OKF.auto.groupConcepts`, `renderTree` com modos e sanfona).

## Problema

A árvore da sidebar (Peça 1) agrupa por Tipo/Tag/Lista, mas não há como destacar
conceitos de acesso frequente. O usuário quer **fixar conceitos como favoritos**,
reunidos num grupo no topo da árvore.

## Decisões (resumo)

| Tema | Decisão |
|------|---------|
| Marcar/desmarcar | Ação no **menu de contexto** da árvore (não estrela clicável no item). |
| Onde aparece | Grupo **"★ Favoritos"** fixo no topo **E** ainda no grupo normal de Tipo/Tag (duplicado). |
| Persistência | Por biblioteca, em `localStorage` (`okf-favorites:<root>` = array de `relPath`). |
| Rename/Move | O favorito **migra** para o novo `relPath` (em `performMove`). |
| Marcador visual | Um **★ read-only** ao lado do título de cada item favoritado, em qualquer grupo. |

## Persistência e dados

- `state.favorites`: um `Set` de `relPath`, carregado por biblioteca a partir de
  `localStorage` na chave `okf-favorites:<root>` (array de relPaths). Mesmo padrão
  do colapso da Peça 1 (`okf-collapsed:<root>`).
- Carregado em `loadBundle` (junto de `state.collapsed`); padrão: vazio.
- **Alternativa descartada:** flag no frontmatter — poluiria o conteúdo da
  biblioteca e seria compartilhado, não uma preferência pessoal/local.
- **Migração no rename/move:** em `performMove(fromRel, toRel, ...)`, se
  `state.favorites` contém `fromRel`, troca por `toRel` e persiste. Evita perder
  o favorito quando o conceito é renomeado/movido (a app já reescreve links nesse
  fluxo).

## Marcar/desmarcar (menu de contexto)

- O menu de contexto da árvore (`#tree-menu`) ganha um botão **acima** de
  "Renomear/Mover", com `data-act="favorite"`.
- O rótulo é dinâmico ao abrir o menu: **"★ Favoritar"** se o conceito não está
  nos favoritos, **"Remover dos favoritos"** se está.
- Acionar alterna `state.favorites` (add/delete), persiste (`saveFavorites`) e
  re-renderiza a árvore.
- Disponível apenas para conceitos não reservados (o menu de contexto já só abre
  para não reservados).

## Árvore (render)

- `OKF.auto.groupConcepts(docs, mode, favorites)` ganha um 3º parâmetro
  `favorites` (um `Set` de relPaths; default vazio para compatibilidade).
- Quando há favoritos visíveis, emite um grupo **"★ Favoritos"** com
  `key = FAVORITES_GROUP_KEY` (`'__favorites__'`), contendo os itens cujo
  `relPath` está em `favorites` — **duplicados** (também permanecem no seu grupo
  normal de Tipo/Tag, e em cada tag no modo Tag).
- **Ordenação:** o grupo Favoritos vem **primeiro** (rank antes de todos os
  demais). Itens dentro dele ordenados por título.
- O grupo **não é emitido** quando não há nenhum item favoritado (lista de docs
  filtrada não contém favoritos).
- É um grupo normal quanto à sanfona: recolhível e persistido em
  `state.collapsed` como os outros; padrão **expandido**.
- No modo **Lista**, o grupo Favoritos continua fixo no topo, seguido da lista
  plana (que é "headless") e do "Sistema" ao fim.
- **Marcador ★:** cada nó cujo `relPath` está em `favorites` mostra um `★`
  discreto à direita do título (read-only — não é botão), em qualquer grupo,
  incluindo o próprio grupo Favoritos.

### Item do grupo

`groupConcepts` já retorna itens `{ relPath, title, type, reserved }`. O render
decide o marcador ★ por `state.favorites.has(it.relPath)` (o `groupConcepts` não
precisa marcar o item; ele só monta os grupos).

## Arquivos afetados

- `renderer/okf.js` — `groupConcepts(docs, mode, favorites)` + `FAVORITES_GROUP_KEY`
  exportado; grupo Favoritos com rank antes de tudo.
- `renderer/renderer.js` — `state.favorites`; `loadFavoritesSet`/`saveFavorites`;
  `toggleFavorite(rel)`; passar `state.favorites` ao `groupConcepts` no
  `renderTree`; marcador ★ no nó; rótulo dinâmico e handler do menu; migração em
  `performMove`.
- `renderer/index.html` — botão `data-act="favorite"` no `#tree-menu`.
- `renderer/styles.css` — estilo do marcador ★ e (se necessário) do grupo
  Favoritos.

## Testes

- Unidade (`test-grouping.js`): `groupConcepts` com `favorites` —
  - grupo "★ Favoritos" emitido primeiro quando há favoritos;
  - itens favoritados duplicados (no grupo Favoritos e no grupo de tipo);
  - sem favoritos → nenhum grupo Favoritos;
  - apenas conceitos **não reservados** entram no grupo Favoritos (um relPath
    reservado presente no set é ignorado pelo `groupConcepts`).
- Smoke (`test-renderer.js`): favoritar via `toggleFavorite` faz aparecer o
  grupo "★ Favoritos" no topo; desfavoritar remove o grupo.

## Fora de escopo (YAGNI / outras peças)

- Reordenar favoritos manualmente.
- Favoritos compartilhados entre bibliotecas.
- Estrela clicável diretamente no item (decidimos menu de contexto).
- Drag-and-drop → Peça 3.
