# Spec: Drag-and-drop na árvore (Peça 3)

- **Data:** 2026-06-25
- **Status:** Aprovado para planejamento
- **Parte de:** Melhorias da sidebar (3 peças: 1-Navegação ✅ · 2-Favoritos ✅ · 3-Drag-and-drop)
- **Depende de:** Peça 1 (`groupConcepts`/`renderTree`, modos, sanfona) e Peça 2 (`state.favorites`).
- **Branch:** `feat/sidebar-drag-drop`, criada a partir de `feat/tela-inicial-recentes` (não da `main`, pois precisa do código das Peças 1 e 2, que está no PR #9). PR empilhado sobre `feat/tela-inicial-recentes`.

## Problema

A árvore agrupa por Tipo/Tag/Lista e tem favoritos, mas recategorizar um conceito
exige abrir, editar o frontmatter e salvar. Arrastar-e-soltar torna isso direto.

## Decisões (resumo)

| Tema | Decisão |
|------|---------|
| Operações | Arrastar p/ grupo de **Tipo** = trocar tipo (move arquivo); p/ grupo de **Tag** = adicionar tag; p/ **★ Favoritos** = favoritar. |
| Alvo do drop | Apenas **cabeçalhos de grupo** (não nós; não há reordenação). |
| Confirmação | Apenas a **troca de tipo** confirma (move arquivo); tag e favoritar aplicam direto. |
| Add tag | **Adiciona** a tag, mantendo as existentes (não substitui). |
| Arrastáveis | Apenas nós de conceito **não reservados**. |

## Operações e alvos por modo

Arrasta-se um nó de conceito não reservado e solta-se **sobre um cabeçalho de
grupo**. A ação depende do grupo-alvo (e só são visíveis os grupos do modo atual):

| Grupo-alvo | Ação |
|------------|------|
| Grupo de **Tipo** (≠ tipo atual do conceito) | Troca o `type` e **move o arquivo** para a pasta do tipo (reusa `performMove`). Pede confirmação. |
| Grupo de **Tag** | **Adiciona** essa tag ao conceito (mantém as demais). Reescreve o frontmatter. |
| Grupo **★ Favoritos** | **Favorita** o conceito (add em `state.favorites`). |
| Grupo do **tipo atual** do conceito | No-op silencioso. |
| **"Sem tipo"**, **"Sem tag"**, **"Sistema"** | Inválido — rejeita o drop (sem destaque). |

No modo **Lista** não há grupos de Tipo/Tag; o único alvo possível é "★ Favoritos"
(se houver favoritos e o grupo estiver visível).

## Confirmação

Só a troca de tipo usa `window.okf.confirm({ message, detail })` (já existe),
porque move arquivo e reescreve links. Cancelar aborta sem alterações. Adicionar
tag e favoritar aplicam direto, cada um com um toast de sucesso.

## Feedback visual e arrastáveis

- Nós não reservados recebem `draggable="true"`. `dragstart` guarda o `relPath`
  arrastado (em `dataTransfer` e/ou numa variável de estado).
- Cabeçalhos de grupo **válidos** destacam no `dragover` (classe `drag-over`) e
  removem no `dragleave`/`drop`. Alvos inválidos não destacam e rejeitam (não
  chamam `preventDefault` no `dragover`).
- Soltar sobre o próprio grupo atual ou alvo inválido = nada acontece.

## Arquitetura

- **Refator (DRY):** extrair o bloco de troca-de-tipo do `saveEdit` (que computa
  `moveTargetForType`, monta o conteúdo com o novo `type` e chama `performMove`)
  para um helper `changeConceptType(rel, newType)` no renderer, usado tanto pelo
  `saveEdit` quanto pelo drop.
- **Tag:** helper puro `OKF.auto.withAddedTag(content, tag)` em `okf.js` — recebe
  o conteúdo `.md`, adiciona a tag ao frontmatter se ainda não houver (idempotente;
  cria o campo `tags` se ausente; preserva o resto), retorna o novo conteúdo. O
  renderer grava (write + refresh).
- **Favoritar:** reusa `state.favorites` + `saveFavorites` da Peça 2 (add, não
  toggle — soltar em Favoritos favorita; já favorito = no-op).
- **Dispatch:** `handleDropOnGroup(draggedRel, group)` no renderer decide a
  operação a partir do objeto `group` (usa `group.favorites`, e o tipo/tag a
  partir de `group.key`/`group.label`), isolando a regra dos eventos de DnD. A
  ligação dos eventos (`draggable`, `dragstart`, `dragover`, `dragleave`, `drop`)
  fica no `renderTree`, com os cabeçalhos carregando `data-group-key` para o
  handler localizar o grupo.

## Arquivos afetados

- `renderer/okf.js` — `withAddedTag(content, tag)` + export.
- `renderer/renderer.js` — `changeConceptType(rel, newType)` (extraído do
  `saveEdit`, e `saveEdit` passa a usá-lo); `handleDropOnGroup`; wiring de DnD no
  `renderTree`; `data-group-key` nos cabeçalhos.
- `renderer/styles.css` — `.group-head.drag-over`.

## Testes

- Unidade (`test-grouping.js`, Node): `OKF.auto.withAddedTag` —
  - adiciona uma tag nova (frontmatter passa a conter a tag);
  - idempotente (tag já presente → conteúdo inalterado ou sem duplicar);
  - cria o campo `tags` quando ausente;
  - preserva outros campos do frontmatter e o corpo.
- Smoke (`test-renderer.js`): chamar `handleDropOnGroup(rel, group)` diretamente
  (sem sintetizar eventos de DnD) para os três casos — soltar em grupo de Tag
  adiciona a tag (re-render mostra o conceito no grupo da tag); soltar em
  Favoritos favorita (grupo "★ Favoritos" aparece). A troca de tipo, por mover
  arquivo e depender de `window.okf.confirm`/IPC, é coberta por verificação
  manual.

## Fora de escopo (YAGNI)

- Reordenação manual de itens (exigiria persistir ordem).
- Arrastar conceitos reservados; arrastar múltiplos itens.
- Soltar sobre nós individuais (apenas cabeçalhos de grupo).
- Remover tag por drag; mover entre tags removendo a de origem.
