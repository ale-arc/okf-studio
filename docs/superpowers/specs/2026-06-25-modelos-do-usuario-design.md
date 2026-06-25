# Modelos do usuário (fora da biblioteca) — Design

- **Data:** 2026-06-25
- **App:** OKF Studio (Electron)
- **Status:** Aprovado para planejamento

## Problema

Hoje os modelos de conceito (`CONCEPT_TEMPLATES`) são um objeto fixo dentro de
`renderer/renderer.js`: o usuário não pode criar nem editar modelos, e eles não
existem fora do código. O objetivo é tornar os modelos **propriedade do
usuário**, guardados **fora de qualquer biblioteca**, reutilizáveis em todas as
bibliotecas que ele abrir, e gerenciáveis (criar/editar/excluir) pelo app.

## Decisões já tomadas (do brainstorming)

- **Armazenamento:** uma **pasta de arquivos `.md`** em
  `app.getPath('userData')/templates/` (Windows: `%APPDATA%/OKF Studio/templates/`).
  Cada modelo é um `.md`; **nome do arquivo = nome do modelo**.
- **Padrões:** os 5 modelos atuais são **semeados na 1ª execução** (editáveis a
  partir daí). Um comando **"Restaurar padrões"** recria apenas os que faltarem.
- **Conteúdo do modelo:** frontmatter com `type` (obrigatório) e opcionalmente
  `description` e `tags`; o corpo é o esqueleto. Ao escolher um modelo no "Novo
  conceito", esses campos **pré-preenchem** o formulário (sobrescrevíveis).
- **UI:** um **diálogo dedicado "Modelos"** (lista + formulário) para CRUD,
  aberto por menu, paleta e por um atalho ao lado do seletor no "Novo conceito".
- **Arquitetura:** abordagem **A** — módulo `templates.js` no processo principal
  (IO + defaults + helpers puros); o **renderer** parseia/gera os `.md` com o
  `OKF` já existente (sem duplicar parsing).

## Arquitetura

- **`templates.js`** (novo módulo do processo principal, ao estilo de
  `git.js`/`watcher.js`): faz todo o IO em `userData/templates/`, guarda os
  defaults e helpers puros. Exporta `registerTemplateHandlers(ipcMain)` e os
  símbolos puros (`DEFAULTS`, `sanitizeName`) para teste em Node.
- **`renderer/okf.js`** (`OKF.parse`/`OKF.serialize`): reusado pelo renderer
  para converter `.md` ⇄ `{type, description, tags, body}`. Nenhuma lógica de
  parsing nova.
- **`renderer/renderer.js`**: carrega os modelos do usuário no start, usa-os no
  modal "Novo conceito", e implementa o diálogo "Modelos". `CONCEPT_TEMPLATES`
  deixa de existir.

Os modelos vivem em `userData` (só acessível pelo processo principal), por isso
todo acesso passa por IPC.

## Componente 1 — Módulo `templates.js` (processo principal)

- **`DEFAULTS`**: array `[{ name, content }]` com os 5 modelos atuais como `.md`
  completos (frontmatter + corpo). Fonte única — substitui o objeto fixo do
  renderer. Os nomes/corpos espelham os atuais:
  - `Em branco` — sem `type` (frontmatter vazio ou `type: ''`), corpo
    `Descreva aqui.`
  - `Projeto` — `type: Projeto`, corpo `## Objetivo … ## Status … ## Marcos`
  - `Processo` — `type: Processo`, corpo `## Quando usar … ## Passos … ## Responsáveis`
  - `Métrica` — `type: Métrica`, corpo `## Definição … ## Como calcular … ## Fonte`
  - `Referência` — `type: Referência`, corpo `## Resumo … ## Detalhes`
  - `Playbook` — `type: Playbook`, corpo `## Gatilho … ## Passos … ## Pós-ação`
- **`sanitizeName(name)`**: aparа espaços; rejeita vazio e nomes com separadores
  de caminho ou caracteres inválidos de arquivo (`/ \ : * ? " < > |`) e os nomes
  reservados; retorna o nome validado ou lança erro. (Função pura, testável.)
- **`templatesDir()`**: `path.join(app.getPath('userData'), 'templates')`.
- **`registerTemplateHandlers(ipcMain)`** registra:
  - `templates:list` → se a pasta **não existe** (1ª execução), cria-a e escreve
    os `DEFAULTS` (seed). Se a pasta já existe — mesmo vazia — **não semeia**
    (respeita exclusões do usuário; a recuperação é o "Restaurar padrões").
    Retorna `[{ name, content }]` de cada `.md` (ordenado por nome, com "Em
    branco" primeiro se presente).
  - `templates:save` `({ name, content, oldName })` → valida `name` via
    `sanitizeName`; grava `<name>.md`; se `oldName` foi informado e difere de
    `name`, remove `<oldName>.md` (renomear). Recusa sobrescrever um nome
    diferente já existente (colisão).
  - `templates:delete` `({ name })` → remove `<name>.md`.
  - `templates:restoreDefaults` → para cada `DEFAULTS`, cria o `.md`
    **apenas se faltar** (nunca sobrescreve um modelo existente do usuário).
  - `templates:dir` → retorna o caminho da pasta (para exibir/abrir no Explorer).
- Todo path é resolvido sob `templatesDir()` com verificação de contenção
  (impede escapar da pasta), análogo ao `safeJoin` da biblioteca.

## Componente 2 — `preload.js`

Expõe em `window.okf.templates`:
- `list()` → `templates:list`
- `save(payload)` → `templates:save`
- `remove(payload)` → `templates:delete`
- `restoreDefaults()` → `templates:restoreDefaults`
- `dir()` → `templates:dir`

E adiciona o canal de menu `menu:templates` à allowlist de `onMenu`.

## Componente 3 — main.js (registro + menu)

- `const { registerTemplateHandlers } = require('./templates.js')` e chamada no
  bootstrap (como `registerGitHandlers`).
- Item de menu **Arquivo ▸ Modelos…** que envia `menu:templates`.

## Componente 4 — Renderer: consumo dos modelos

- **Estado:** `state.templates = []` — array `[{ name, type, description, tags,
  body }]`. Função `loadTemplates()` chama `okf.templates.list()` e parseia cada
  `content` com `OKF.parse` (frontmatter → type/description/tags; resto → body).
  Chamada no `init()` (start) e após qualquer alteração no diálogo de modelos.
- **`openModal`** (Novo conceito): popula `#m-template` a partir de
  `state.templates` (seleciona "Em branco" se existir, senão o 1º).
- **Troca de modelo** (`#m-template` change): pré-preenche `#m-type`,
  `#m-description`, `#m-tags` com os valores do modelo selecionado
  (sobrescrevíveis pelo usuário).
- **`createConcept`**: o corpo do novo conceito vem do **body do modelo
  selecionado** em `state.templates` (fallback: corpo vazio). O restante do fluxo
  (frontmatter a partir do formulário, ops de índice/log) permanece igual.
- **Remoção:** `CONCEPT_TEMPLATES` e o objeto fixo saem do `renderer.js`.

## Componente 5 — Diálogo "Modelos" (CRUD)

- **Markup `#templates-modal`** (modal, no padrão dos demais): **lista** à
  esquerda (nomes de `state.templates`) + **formulário** à direita:
  - `#tpl-name` (nome do modelo), `#tpl-type`, `#tpl-description`, `#tpl-tags`,
    `#tpl-body` (`<textarea>` para o corpo em markdown cru).
  - Botões: **Novo** (limpa o formulário para um modelo novo), **Salvar**,
    **Excluir**, **Restaurar padrões**, **Fechar**.
- **Lógica (renderer):**
  - Selecionar um item da lista carrega seus campos no formulário (parse já feito
    em `state.templates`).
  - **Salvar:** valida nome (não vazio; sem caracteres inválidos — espelha
    `sanitizeName`); monta o `.md` com `OKF.serialize({type, description, tags},
    body)` (omitindo campos vazios); chama `okf.templates.save({ name, content,
    oldName })` (`oldName` = nome carregado, para renomear). Em seguida
    `loadTemplates()` + re-renderiza a lista; se o "Novo conceito" estiver aberto,
    atualiza `#m-template`.
  - **Excluir:** confirma; `okf.templates.remove({ name })`; recarrega.
  - **Restaurar padrões:** `okf.templates.restoreDefaults()`; recarrega; informa
    quantos foram recriados.
- **Abertura:** menu `menu:templates`; ação na paleta ("Gerenciar modelos",
  `needsLib:false`); e um botão **⚙** ao lado do `#m-template` no "Novo conceito".
- **Edição do corpo:** `<textarea>` (markdown cru) — suficiente para esqueletos;
  sem Milkdown.

## Componente 6 — Empacotamento

`templates.js` é adicionado a `build.files` no `package.json` (senão o
`scripts/check-package-files.mjs` falha no `npm run dist`, pois `main.js` passa a
`require('./templates.js')`). Sem `extraResources` (os defaults são strings no
código, não arquivos).

## Testes

- **Node — `test-templates.js`** (carrega `templates.js` + `OKF` no estilo de
  `test-okf.js`, sem Electron):
  - Cada `DEFAULTS[i].content` parseia com `OKF.parse`; todos menos "Em branco"
    têm `type` não-vazio; "Em branco" tem `type` vazio/ausente.
  - `sanitizeName` aceita nomes válidos ("Projeto", "Notas de reunião") e
    **rejeita** vazio/só-espaços e nomes com qualquer inválido (`/ \ : * ? " < > |`).
  - Há exatamente 6 defaults com nomes únicos.
- **Smoke — `test-renderer.js`**: atualizar o check de `templates` para refletir
  o carregamento assíncrono — `window.__okfTemplates` passa a expor
  `state.templates` (após `loadTemplates()`), e o smoke verifica `length >= 6`.

## Fora de escopo (YAGNI)

- Categorias/pastas de modelos, import/export, sincronização em nuvem.
- Placeholders dinâmicos no corpo (ex.: `{{data}}`, `{{titulo}}`).
- Editor visual (Milkdown) para o corpo do modelo — `<textarea>` basta.
- Migração automática de modelos "antigos" (não existiam fora do código).

## Arquivos impactados

- `templates.js` — **criar** (módulo do processo principal).
- `main.js` — `require` + `registerTemplateHandlers` + item de menu Modelos….
- `preload.js` — `window.okf.templates.*` + canal `menu:templates`.
- `renderer/renderer.js` — remover `CONCEPT_TEMPLATES`; `loadTemplates`;
  ajustar `openModal`/troca de modelo/`createConcept`; diálogo "Modelos";
  wiring (menu/paleta/atalho ⚙).
- `renderer/index.html` — `#templates-modal` + botão ⚙ no "Novo conceito".
- `renderer/styles.css` — estilos do diálogo (lista + formulário).
- `package.json` — `templates.js` em `build.files`; script `test:templates`.
- `test-templates.js` — **criar**; `test-renderer.js` — atualizar smoke.
