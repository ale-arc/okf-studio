# Spec: Navegação da sidebar (Peça 1)

- **Data:** 2026-06-25
- **Status:** Aprovado para planejamento
- **Parte de:** Melhorias da sidebar (3 peças: 1-Navegação · 2-Favoritos · 3-Drag-and-drop)

## Problema

O menu lateral (`#sidebar` → `#tree`) hoje agrupa os conceitos **por diretório
de topo** (que equivale ao slug do tipo), com seções fixas (sem recolher) e
ordenação alfabética. A busca (`#search`) e o filtro de tipo (`#type-filter`)
ficam no **toolbar do topo**, longe da árvore. Falta flexibilidade de navegação:
agrupar de outras formas, recolher seções e ter busca/filtro junto da lista.

Esta peça (1 de 3) cobre: mover busca/filtro para a sidebar, agrupar por
Tipo/Tag/Lista e seções recolhíveis (sanfona). Favoritos e drag-and-drop são as
Peças 2 e 3 (fora deste spec).

## Decisões (resumo)

| Tema | Decisão |
|------|---------|
| Modos de agrupamento | **Tipo**, **Tag**, **Lista** (plana), em controle segmentado. |
| Multi-tag | No modo Tag, o conceito aparece em **cada** tag; sem tag → grupo "Sem tag". |
| Reservados (`index.md`, `log.md`) | Grupo **"Sistema"**, recolhido por padrão (em Lista, ao fim após separador). |
| Busca + filtro | **Movidos** do toolbar para o cabeçalho da sidebar. |
| Persistência do colapso | Por biblioteca (localStorage com a chave do caminho); padrão tudo expandido, exceto "Sistema" (recolhido por padrão). |
| Persistência do modo | Preferência **global** (localStorage), padrão **Tipo**. |
| Controle de agrupamento | Botões segmentados (Tipo \| Tag \| Lista). |

## Comportamento de agrupamento

Três modos:

- **Tipo:** agrupa por `frontmatter.type` (rótulo canônico). Conceito sem `type`
  → grupo **"Sem tipo"**. Neste modo o badge de tipo de cada item é **omitido**
  (redundante).
- **Tag:** agrupa por tag. Um conceito com tags `[a, b]` aparece nos grupos
  `a` **e** `b` (duplicado). Conceito sem tags → grupo **"Sem tag"**.
- **Lista:** lista plana única, **sem cabeçalhos de grupo**, ordenada por título.
  O badge de tipo é mostrado (ajuda a distinguir).

**Reservados** (`OKF.isReserved`: `index.md` de qualquer pasta e `log.md`):
agrupados em **"Sistema"**. Nos modos Tipo/Tag aparece como um grupo recolhível
(recolhido por padrão). No modo Lista, aparecem ao final, após um separador.

**Ordenação:**
- Itens dentro de um grupo: por título (`localeCompare`).
- Grupos: alfabética por rótulo; os grupos especiais **"Sem tipo"**, **"Sem
  tag"** e **"Sistema"** vão sempre por último (nessa prioridade relativa,
  "Sistema" por último de todos).

**Busca e filtro** (sem mudança de semântica, só de lugar):
- Busca casa título, id (relPath sem `.md`), tags e corpo — como hoje.
- Filtro de tipo restringe a um `type`; é **ortogonal** ao agrupamento (ex.:
  agrupar por Tag e ainda filtrar a um tipo).
- Grupos que ficam **sem itens** após busca/filtro são ocultados.
- Nenhum item após busca/filtro → mensagem **"Nenhum resultado"**.

**Seleção:** o conceito aberto continua destacado (`active`). No modo Tag, se ele
aparece em vários grupos, **todas** as instâncias ficam destacadas.

## Cabeçalho da sidebar

`#search` e `#type-filter` saem do toolbar (`.tools` em `index.html`) e entram no
topo da `#sidebar`, na ordem:

1. Nome da biblioteca + contagem (`#bundle-name`, já existe).
2. Campo de **busca**.
3. Linha com o **controle segmentado** `Tipo | Tag | Lista` + o **filtro de
   tipo** (dropdown) ao lado.
4. A árvore (`#tree`).

O toolbar do topo perde a busca e o filtro (os demais botões permanecem).

## Sanfona (recolher/expandir) + persistência

- Cada cabeçalho de grupo tem um chevron e recolhe/expande ao clique (no
  cabeçalho inteiro). Chevron ▾ = expandido, ▸ = recolhido.
- **Colapso persistido por biblioteca:** localStorage, chave derivada do caminho
  da biblioteca (`state.root`); guarda o conjunto de rótulos de grupo recolhidos.
  Padrão: tudo expandido (exceto "Sistema", recolhido por padrão na primeira vez).
- **Modo de agrupamento persistido globalmente:** localStorage (ex.:
  `okf-group-mode`), padrão `Tipo`. Mesmo padrão de `okf-theme`/`okf-auto-index`.
- A troca de modo re-renderiza a árvore aplicando o colapso persistido do novo
  conjunto de grupos.

## Arquitetura, arquivos e testes

**Lógica pura (testável):** nova função em `okf.js` dentro de `OKF.auto`:

```
groupConcepts(docs, mode) -> [{ key, label, special, items: [{ relPath, title, type, reserved }] }]
```

- `mode` ∈ `{'type','tag','flat'}`.
- Aplica as regras acima (multi-tag duplicado, "Sem tipo"/"Sem tag", reservados →
  "Sistema", ordenação de itens e de grupos). `flat` retorna um único grupo
  sem rótulo (mais "Sistema" ao fim).
- Não conhece DOM, busca nem filtro. Responsabilidade clara: **o renderer
  aplica busca + filtro de tipo primeiro e chama `groupConcepts` sobre o
  subconjunto já filtrado.**

**Render:** `renderTree()` em `renderer.js` passa a:
1. Ler o modo atual e o texto de busca/filtro.
2. Filtrar `state.docs` (busca + filtro de tipo), como hoje.
3. Chamar `OKF.auto.groupConcepts(filtered, mode)`.
4. Desenhar cabeçalhos de grupo recolhíveis (lendo o colapso persistido) e os
   nós, reaproveitando o nó atual (ícone, título, badge, clique, menu de
   contexto). No modo Lista, sem cabeçalhos.

**Arquivos afetados:**
- `renderer/okf.js` — `OKF.auto.groupConcepts` + export.
- `renderer/renderer.js` — `renderTree` reescrito; helpers de modo e de colapso
  (ler/gravar localStorage); listeners do segmentado e do filtro; relocação.
- `renderer/index.html` — mover `#search` e `#type-filter` para a sidebar; novo
  controle segmentado de agrupamento.
- `renderer/styles.css` — cabeçalho da sidebar, controle segmentado, cabeçalhos
  de grupo e estado recolhido.

**Testes:**
- Unidade (estilo `test-okf.js`, Node): `groupConcepts` — agrupamento por tipo,
  por tag com duplicação multi-tag + "Sem tag", lista plana, reservados →
  "Sistema", ordenação de itens e de grupos (especiais por último).
- Smoke opcional no `test-renderer.js`: alternar modo e recolher um grupo
  reflete no DOM.

## Fora de escopo (YAGNI / outras peças)

- **Favoritar conceitos** → Peça 2.
- **Drag-and-drop** (mover/retag arrastando) → Peça 3.
- Reordenação manual dentro de um grupo.
- Agrupar por outros critérios (data, etc.) além de Tipo/Tag/Lista.
- Busca/filtro com nova semântica (mantém a atual).
