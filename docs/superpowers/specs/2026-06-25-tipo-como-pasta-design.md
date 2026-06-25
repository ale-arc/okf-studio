# Design — "Tipo é a pasta" + correção de índices + import com editor visual

Data: 2026-06-25
Itens cobertos: **2** (seletor de tipo), **3** (index.md ao mover/editar), **4** (import de PDF com editor visual), **5** (política pasta × tipo).
Fora de escopo (ciclo próprio): **1** (editor visual de tabelas).

## Contexto

OKF Studio é um app Electron que edita bibliotecas no formato OKF v0.1. Cada `.md`
(exceto `index.md`/`log.md`) é um *conceito* com frontmatter YAML; `type` é
obrigatório. O app mantém automaticamente um **bloco gerenciado** em cada
`index.md` (entre `<!-- okf:index -->` e `<!-- /okf:index -->`) e um `log.md`.

Arquivos-chave:
- [renderer/okf.js](../../../renderer/okf.js) — núcleo OKF (parse/serialize, links, validação, automação de índices/log/rename).
- [renderer/renderer.js](../../../renderer/renderer.js) — UI, edição de conceito, índices (`indexOpsFrom`), rename/move, salvar.
- [renderer/convert-ui.js](../../../renderer/convert-ui.js) — fluxos de import (PDF→MD) e export (MD→PDF).
- [src/editor/index.js](../../../src/editor/index.js) — editor visual Milkdown empacotado como `window.OKFEditor` (instância **singleton**).
- [renderer/index.html](../../../renderer/index.html) — markup (campos `e-type`, `m-type`, `import-md`, toolbar do editor, modal de import).
- [CLAUDE.md](../../../CLAUDE.md) — regras do formato para o agente.

## Decisões tomadas (brainstorming)

1. **Pasta = tipo (1:1, flat).** Cada tipo corresponde a uma pasta única no nível raiz;
   o conceito mora em `slug(type)/slug(titulo).md`. Continua sendo OKF válido — `type`
   permanece no frontmatter; "pasta = tipo" é convenção de armazenamento do app.
2. **App é o dono da listagem** do `index.md`. O Claude deve cooperar (CLAUDE.md atualizado).
3. **Índice raiz agrupa por tipo** (que agora coincide com a pasta). Rótulo da seção vem
   do campo `type` (preserva acento/maiúscula), não do nome da pasta.
4. **Trocar o tipo = mover** o arquivo para a pasta do novo tipo.
5. **Migração legada opcional** (botão "Reorganizar por tipo", com prévia; nunca automática).
6. **Editor por instância** para reuso no modal de import sem conflitar com edição de conceito.

## Bloco 1 — Modelo "tipo é a pasta" (itens 2, 3, 5)

### 1.1 Slug e mapeamento tipo↔pasta
- Nova função utilitária `slugify(s)` em `OKF.auto` (reaproveita a lógica já usada em
  `suggestImportPath` de convert-ui): NFD, remove diacríticos, minúsculas,
  `[^a-z0-9]+` → `-`, trim de `-`. Vazio → fallback (`'sem-tipo'` para tipo, `'conceito'` para título).
- `folderForType(type)` = `slugify(type)`.
- O campo `type` (rótulo canônico) é **sempre** a fonte da exibição; a pasta é só storage.

### 1.2 Seletor de Tipo (item 2)
- `e-type` e `m-type` viram `<input list="...">` com um `<datalist>` populado pelos tipos
  existentes (computados como em `buildTypeFilter`).
- Permite escolher um tipo existente **ou** digitar um novo.
- **Guarda anti-duplicata:** ao confirmar, se `slugify(novoTipo)` coincide com a pasta de
  um tipo já existente, reaproveita o **rótulo existente** (ex.: digitar "referência"
  havendo "Referência" → usa "Referência"). Implementado por um lookup
  `slug → rótulo canônico` montado a partir dos docs.

### 1.3 Criar conceito (sem campo de caminho)
- O modal "Novo conceito" perde o campo de caminho/pasta.
- Entradas: **tipo** (combobox) + **título**. Caminho derivado: `slug(type)/slug(titulo).md`.
- Colisão de nome no mesmo tipo → sufixo `-2`, `-3`, … (reusa o padrão de `saveImport`).

### 1.4 Trocar o tipo = mover
- No salvar a edição (`saveEdit`), comparar `type` antes/depois.
- Se o **slug do tipo** mudou, o destino é `slug(novoTipo)/<basename-atual>.md`
  (basename preservado). Reusa o pipeline de `doRename`:
  `OKF.auto.rewriteRenameLinks` + `indexOpsFrom(nextDocs)` + `logOpFrom`.
- Entrada de log: `**Troca de tipo**: \`<from>\` → [titulo](/<to>) (Tipo: <novoTipo>).`
- `metaChanged` deixa de ser relevante para o índice nesse caminho — a troca de tipo é
  tratada como move (sempre regenera índices). Para edições que mudam só título/descrição,
  os índices continuam sendo regenerados (já ocorre via `metaChanged`).

### 1.5 index.md (item 3 — correção)
- **Causa-raiz:** `rewriteRenameLinks` ([renderer/okf.js:295](../../../renderer/okf.js))
  pula `index.md` (`continue` na linha ~299), assumindo reconstrução à parte. Mas a
  reconstrução só toca o **bloco gerenciado**; links escritos fora do bloco (à mão / pelo
  Claude) nunca eram atualizados → ficavam quebrados (vermelho tachado) após mover.
- **Correção:** `rewriteRenameLinks` **deixa de pular** `index.md`. Passa a reescrever links
  para o conceito movido também no corpo dos `index.md` (dentro e fora do bloco gerenciado).
  O bloco gerenciado continua sendo regenerado por `indexOpsFrom` por cima — convergem para o
  mesmo destino correto.
- **Agrupamento por tipo:** `OKF.auto.rootListing` passa a agrupar por `type`
  (rótulo canônico do frontmatter) em vez de pelo primeiro segmento da pasta. Como pasta ==
  slug(type) no modelo novo, os dois coincidem; a diferença é que o **cabeçalho** usa o
  rótulo do `type` (com acento). Conceitos sem `type` → seção "Sem tipo".
- Subpastas continuam com `index.md` próprio via `dirListing` (inalterado).

### 1.6 Migração legada (opcional)
- Novo `OKF.auto.planReorg(docs)`: retorna a lista de moves para todo conceito onde
  `dirOf(relPath) !== slug(type)` (no modelo flat, qualquer pasta diferente de `slug(type)`).
  Para cada move calcula `from`, `to` e o título.
- UI: botão "Reorganizar por tipo" (na barra ou no menu) → modal de **prévia** listando os
  movimentos. Confirmar aplica como um único lote: para cada move, o mesmo pipeline de
  `doRename` (reescrita de links + índices + log), agregado. Nada é movido sem confirmação.
- Conflitos de destino (dois conceitos colidiriam no mesmo `to`) → sufixo incremental, com a
  prévia mostrando o nome final.

### 1.7 CLAUDE.md
- Acrescentar regra: "O OKF Studio é o dono da **listagem** dos `index.md` (bloco
  `<!-- okf:index -->`) — não edite a listagem à mão. A biblioteca segue a convenção
  **pasta = tipo** (`slug(type)/…`); ao criar/mover conceitos, respeite-a."

## Bloco 2 — Import de PDF com editor visual (item 4)

### 2.1 Editor por instância (refator de `src/editor/index.js`)
- Extrair a lógica atual para `createInstance(container, markdown, opts)` que retorna um
  **handle**: `{ getMarkdown, setMarkdown, runCommand, taskList, link, image,
  insertConceptLink, focus, cursorEnd, destroy }`.
- As exportações atuais (`create`, `getMarkdown`, …) passam a operar sobre uma **instância
  padrão** (mantida internamente), preservando `window.OKFEditor.*` e o comportamento de hoje.
- O bundle (`build:editor`) e o global `OKFEditor` permanecem; só ganha a API de instância.

### 2.2 Modal de import
- Substituir `<textarea id="import-md">` por um host do editor visual + a mesma toolbar e a
  alternância **Visual / Código** da edição de conceito (reuso do markup/handlers).
- Campo de caminho do import dá lugar ao **seletor de tipo** (combobox do Bloco 1). Caminho
  final = `slug(tipo)/slug(titulo).md`. O `type` do frontmatter passa a vir do seletor
  (default sugerido: "Referência").
- No `saveImport`: obter o markdown via `handle.getMarkdown()` (modo visual) ou do textarea
  de código (modo código), e seguir o fluxo atual de `rewriteImageLinks` + criação de assets.
- Instância do editor do modal é criada ao abrir e destruída ao fechar — isolada da edição
  de conceito (que usa a instância padrão).

## Bloco 3 — Escopo e testes

### Fora de escopo
- Item 1 (editor visual de tabelas) — spec dedicado seguinte.
- Tipos aninhados (mantém-se flat).
- Mesclagem/cor de célula (limitação do Markdown; tratada no ciclo do item 1).

### Testes (TDD; harness atual: `test-okf.js`, `test-convert.js`, smoke de UI)
1. `slugify`: acentos, espaços, símbolos, vazio→fallback.
2. `folderForType` e lookup `slug→rótulo` (anti-duplicata).
3. Troca de tipo = move: `from`/`to` corretos, basename preservado, links reescritos,
   `indexOpsFrom`/log gerados.
4. **Bug do item 3 (regressão):** doc `index.md` com link para conceito **fora** do bloco
   gerenciado; após move, o link aponta para o novo caminho (não fica quebrado). Falha antes
   da correção, passa depois.
5. `rootListing` agrupa por `type` com rótulo acentuado; "Sem tipo" para faltantes.
6. `planReorg`: a partir de docs fora do padrão, retorna os moves esperados (incl. resolução
   de colisão de destino).
7. Criar conceito: caminho derivado `slug(type)/slug(titulo).md`; colisão → sufixo.
8. Smoke de UI: modal de import abre o editor visual, alterna Visual/Código, salva e cria o
   conceito na pasta do tipo, com assets reescritos.

## Riscos / observações
- **Compatibilidade do `window.OKFEditor`:** o refator por instância deve manter a API
  global idêntica; cobrir com o smoke test existente do editor.
- **Migração:** operação em lote pode tocar muitos arquivos; a prévia e o caráter opcional
  mitigam. Aplicar via `applyOps` (atômico já existente) e recarregar do disco.
- **Watcher:** mudanças em lote disparam o chokidar; o app já lida com refresh do disco.
