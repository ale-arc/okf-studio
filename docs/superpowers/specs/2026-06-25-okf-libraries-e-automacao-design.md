# Criar bibliotecas OKF + automação de conceitos — Design

- **Data:** 2026-06-25
- **App:** OKF Studio (Electron)
- **Status:** Aprovado para planejamento

## Problema

Hoje o OKF Studio só **abre** bibliotecas existentes (ou a de exemplo) e cria
conceitos como arquivos `.md` isolados. Manter as regras do formato OKF — um
`index.md` por diretório e o `log.md` na raiz — é 100% manual (ou delegado ao
Claude Code). Não há como **criar uma biblioteca nova** pelo app, nem como
**renomear/mover** um conceito sem quebrar os links.

Este design cobre quatro frentes, todas **determinísticas** (sem IA escrevendo
conteúdo):

1. Criar uma biblioteca OKF nova (scaffolding mínimo + `CLAUDE.md`).
2. Manter `index.md`/`log.md` automaticamente ao criar/editar/excluir/mover.
3. Renomear/mover conceitos preservando a integridade dos links.
4. Sugerir cross-links automaticamente (confirmados pelo usuário).

## Decisões já tomadas (do brainstorming)

- **Sentido de "automatizar":** manter `index.md`/`log.md`, scaffolding
  inteligente de frontmatter/diretórios, e renomear/mover com integridade.
- **Gatilho:** automático nas ações do app **+** botão "Reconstruir índices".
- **Scaffolding de biblioteca:** mínimo (`index.md` raiz + `log.md`) **+** um
  `CLAUDE.md` **enxuto** (só as regras do formato OKF).
- **Conformidade total:** todo artefato gerado pelo app (scaffolding,
  `index.md`, `log.md`, `CLAUDE.md`, links) **deve obedecer ao OKF v0.1** — uma
  biblioteca recém-criada passa em `OKF.validate` com **0 erros**, e todos os
  links gerados são **bundle-relativos** (começando com `/`), conforme manda o
  `CLAUDE.md`.
- **Granularidade do log:** **só estruturais** (criar/excluir/renomear/mover +
  criação da biblioteca). Edições de conteúdo não logam.
- **Arquitetura:** abordagem **C (híbrida)** — lógica pura no `OKF` do renderer,
  gravação por um IPC transacional único no main.
- **Cross-links:** sugestão automática **dentro do escopo** (determinística,
  sempre confirmada pelo usuário).

## Arquitetura (abordagem C — híbrida)

- **Inteligência** vive em funções puras no `renderer/okf.js`, sob um novo
  namespace `OKF.auto`. Elas calculam *o que* gravar; nunca tocam o disco.
  Continuam testáveis em Node como o resto do `okf.js` (via `eval` +
  `js-yaml`, ver `test-okf.js`).
- **Gravação** passa por **um IPC transacional novo** em `main.js`:
  `fs:applyOps({ root, ops })`, onde `ops` é uma lista ordenada de:
  - `{ op: 'create', relPath, content }`
  - `{ op: 'write',  relPath, content }`
  - `{ op: 'delete', relPath }`
  - `{ op: 'rename', from, to }`

  O handler:
  1. **pausa o watcher** da biblioteca;
  2. aplica as ops em ordem, validando cada caminho com `safeJoin`;
  3. **retoma o watcher**;
  4. dispara **um único** `bundle:changed`.

  Em falha de uma op, retorna `{ ok:false, applied:n, error }` e o renderer
  recarrega do disco (estado real, sem suposição de rollback). Os handlers
  simples atuais (`file:create`/`file:write`/`file:delete`) permanecem para
  chamadas avulsas.

- **`createLibrary({ parentDir, name })`** — handler novo no main que faz o
  scaffolding (precisa do `parentDir`, criação de pasta, e cópia do `CLAUDE.md`
  empacotado).

- **`preload.js`** expõe `applyOps`, `createLibrary` e o diálogo de pasta para
  nova biblioteca. Menu e paleta de comandos ganham as novas ações.

### Watcher: pausa/retoma

`watcher.js` ganha `pause()`/`resume()` (ou um sinalizador "ignorar próximos
eventos até resume"), para que gravações originadas no app não disparem reloads
no meio de um lote. Após `resume()`, um único `bundle:changed` é emitido pelo
`applyOps`.

## Componente 1 — Modelo de bloco gerenciado do `index.md`

`index.md` mistura prosa humana e listagem. A automação só reescreve um **bloco
gerenciado** delimitado por marcadores HTML; tudo fora dele é preservado.

```markdown
<!-- okf:index -->
* [Projeto Atlas](atlas.md) - Migração da plataforma de dados.
* [Projeto Aurora](aurora.md) - Novo portal de clientes.
<!-- /okf:index -->
```

- **Subdiretório** (`projetos/index.md`): o heading/título é preservado se já
  existir, senão é gerado a partir do nome da pasta. O bloco gerenciado contém
  apenas os bullets dos conceitos daquele diretório.
- **Raiz** (`index.md`): frontmatter `okf_version` e a intro humana são
  **preservados**. O bloco gerenciado lista por categoria (`## Projetos`,
  `## Processos`, …) seguindo as subpastas, mais os conceitos da raiz.
- **Sem marcadores** (ex.: a `sample-library` atual, ou um index feito à mão):
  na primeira atualização, o app **insere o bloco no fim do arquivo**,
  preservando todo o texto existente. "Reconstruir índices" faz o mesmo.
- **Formato do bullet:** `* [title](/categoria/arquivo.md) - description.`
  - `title`: `frontmatter.title` (fallback: nome do arquivo sem `.md`).
  - `description`: `frontmatter.description` (se ausente, omite o ` - …`).
  - **Link bundle-relativo** (com `/` inicial), igual em todos os `index.md`
    (raiz e subdiretório), em log e em cross-links — regra do `CLAUDE.md`.
  - **Ordem alfabética por título** (estável no git).

### Funções puras (em `OKF.auto`)

- `buildListing(conceptsInScope, mode)` → string do miolo do bloco
  (`mode: 'dir' | 'root'`).
- `mergeManagedBlock(existingContent, listing)` → conteúdo final do `index.md`,
  inserindo/atualizando o bloco entre os marcadores e preservando o resto.
- `planIndexUpdates(docs, affectedDirs)` → lista de ops `write`/`create` para os
  `index.md` afetados (inclui a raiz).

## Componente 2 — Criar biblioteca ("Nova biblioteca…")

- **Entradas na UI:** menu **Arquivo ▸ Nova biblioteca…** + botão na barra.
- **Fluxo:**
  1. Diálogo de pasta (`properties: ['openDirectory', 'createDirectory']`) para
     escolher/criar a pasta destino.
  2. Modal pedindo o **nome da biblioteca**.
  3. `createLibrary` faz o scaffolding.
  4. O app abre a biblioteca recém-criada.
- **Gera:**
  - `index.md` raiz: frontmatter `okf_version: "0.1"`, `# <nome>`, intro padrão,
    e um bloco gerenciado vazio (`<!-- okf:index -->`/`<!-- /okf:index -->`).
  - `log.md`: `# Histórico de Atualizações` + `## <hoje>` +
    `* **Criação**: estrutura inicial da biblioteca com [índice raiz](/index.md).`
  - **`CLAUDE.md` enxuto** com **só as regras do formato OKF** (frontmatter
    obrigatório/recomendado, links bundle-relativos `/…`, papel de
    `index.md`/`log.md`). Para obedecer ao próprio OKF, ele leva frontmatter
    conforme — ex.: `type: Referência`, `title: Regras do formato OKF`,
    `description: …` — de modo que a biblioteca valide sem erros. Empacotado
    como `extraResources` (um template em `tools/`, não o `CLAUDE.md` deste
    repositório, que é mais extenso).
- **Guarda:** recusa (com aviso) uma pasta que já contenha `index.md`/`log.md`
  ou `.md` conflitantes — evita sobrescrever uma biblioteca existente.
- **Conformidade:** logo após o scaffolding, a biblioteca passa em
  `OKF.validate` com **0 erros** (verificado em teste).

## Componente 3 — Criar conceito (scaffolding inteligente)

Estende o modal atual (`createConcept`):

- **Categoria:** dropdown com as pastas de topo existentes + "nova categoria…"
  (preenche o início do caminho).
- **Título vazio → derivado** do nome do arquivo.
- **`timestamp`** automático (já existe).
- **Tags** (campo opcional) → `tags:` (lista) no frontmatter.
- Ao criar, o renderer monta **um lote `applyOps`**:
  1. `create` do `.md` do conceito (frontmatter + corpo do modelo escolhido);
  2. `create` do `index.md` da pasta, se faltar;
  3. `write` dos `index.md` afetados (pasta + raiz) com o bloco atualizado;
  4. `write` do `log.md` com `* **Criação**: [title](/rel.md) - description.`.

## Componente 4 — Editar / Excluir

- **Editar (Salvar):** se `title`/`description` mudaram, atualiza os bullets nos
  `index.md` afetados **no mesmo lote** do save. **Não** loga (decisão "só
  estruturais").
- **Excluir:** `delete` do `.md`; remove o bullet dos `index.md`; loga
  `* **Exclusão**: removido` com o caminho. Tudo num lote.

## Componente 5 — Renomear / Mover (integridade de links)

- **UI:** ação **"Renomear/Mover…"** no rodapé do conceito aberto **e** no
  **menu de clique-direito da árvore** (sobre qualquer conceito). Coleta `to`
  (novo caminho relativo) a partir de `from` (caminho atual). O mesmo menu de
  contexto da árvore também oferece **Excluir** para consistência.
- **Reescrita de links** (`OKF.auto.planRename(docs, from, to)`):
  - Para cada doc cujo corpo tenha um link que **resolve** (via
    `OKF.resolveTarget`) ao conceito movido: reescreve o alvo,
    **preservando o estilo** — alvo absoluto (`/x`) continua absoluto;
    relativo é recalculado a partir da pasta da origem do link — e mantendo
    âncoras `#sec`.
  - Reescreve também os **links de saída relativos do próprio arquivo movido**,
    cuja base muda ao mudar de pasta.
- **Índices/log:** atualiza `index.md` da pasta de origem e de destino + raiz;
  loga `* **Renomeação**:` (mesma pasta) ou `* **Movimentação**:` (pasta
  diferente).
- Tudo num **único `applyOps`** (atomicidade — o ponto forte da abordagem C).

## Componente 6 — Reconstruir índices (reparo)

- **UI:** **Exibir ▸ Reconstruir índices** + comando na paleta (`Ctrl+P`).
- Recalcula todos os blocos gerenciados de todos os `index.md` e **(re)insere
  marcadores onde faltam**; **não** mexe em prosa fora dos blocos.
- Mostra um **resumo do que vai mudar** (nº de arquivos afetados) e **confirma**
  antes de aplicar (via `applyOps`).
- Uso típico: depois que o Claude Code mexeu na biblioteca, ou para consertar
  uma biblioteca antiga sem marcadores.

## Componente 7 — Preferência

- Toggle **"Manter índices automaticamente"** (default **ON**), persistido em
  `localStorage` (como o tema). Com **OFF**, as ações do app não atualizam
  `index.md`/`log.md` — só o botão "Reconstruir índices" age.

## Componente 8 — Sugestão automática de cross-links

- **Detecção (função pura):** `OKF.auto.suggestLinks(body, concepts, selfId)`
  varre o corpo procurando menções aos **títulos** dos demais conceitos (e ao
  nome derivado do arquivo) como **palavras inteiras, case-insensitive**, e
  retorna `[{ trecho, início, fim, targetId, targetRel }]`.
- **Regras anti-ruído:**
  - Ignora trechos já dentro de um link, dentro de código (`` `inline` `` e
    blocos ```` ``` ````), em URLs e no frontmatter.
  - Não sugere **autolink** (o próprio conceito).
  - **Só a 1ª ocorrência** por conceito-alvo (convenção wiki).
  - Em empate de substring, prefere o **título mais longo** (mais específico).
- **UI:** ao abrir/editar um conceito, o app calcula as sugestões e mostra um
  **badge "N sugestões de links"** no rodapé do editor. O painel lista cada
  `…trecho… → [Conceito]` com **Aceitar / Dispensar** e **Aceitar todas**.
- **Aplicação:** aceitar reescreve aquela ocorrência para um link
  **bundle-relativo** `[(trecho)](/categoria/arquivo.md)` (estilo exigido pelo
  `CLAUDE.md`). As edições vão para o **editor em memória** (Milkdown/código),
  não direto ao disco — só persistem no **Salvar** normal, passando pela
  atualização de índices já descrita. **Sem IPC novo.**

## Testes

Funções puras novas em `OKF.auto`, testadas no estilo do `test-okf.js`
(`eval` + `js-yaml`, sem DOM):

- **Bloco gerenciado:** index sem marcadores → bloco inserido no fim, prosa
  preservada; index raiz com intro → intro e `okf_version` intactos; ordem
  alfabética; bullet sem `description`; links de bullet **bundle-relativos
  `/…`**.
- **Conformidade do scaffolding:** biblioteca recém-criada (com o `CLAUDE.md`
  enxuto) passa em `OKF.validate` com **0 erros**.
- **Log:** entrada no dia já existente apenda bullet; dia novo entra no topo;
  formato `## AAAA-MM-DD` + `* **<Ação>**:`.
- **Rename:** reescrita de link absoluto, relativo e com âncora; reescrita dos
  links de saída do arquivo movido; index de origem e destino atualizados.
- **Cross-links:** menção em texto puro vira sugestão; menção dentro de
  link/código/URL é ignorada; autolink não sugerido; só a 1ª ocorrência;
  título mais longo vence o mais curto.

Smoke em `test-renderer.js`: criar conceito atualiza `index.md` da pasta + raiz
e acrescenta entrada no `log.md`.

## Fora de escopo (YAGNI)

- **Autoria de conteúdo por IA** (gerar/reescrever o corpo do conceito).
- **Reação automática a edições externas** do Claude Code — coberto sob demanda
  pelo "Reconstruir índices".

## Arquivos impactados (estimativa)

- `renderer/okf.js` — novo namespace `OKF.auto` (listagem, bloco gerenciado,
  log, rename, cross-links).
- `renderer/renderer.js` — modal de criar conceito (categoria/tags/título
  derivado), ações de excluir/renomear/mover, painel de cross-links, botão
  "Reconstruir índices", "Nova biblioteca…", toggle de preferência.
- `renderer/index.html` + `renderer/styles.css` — UI nova (modais, painel de
  sugestões, badge, botões).
- `main.js` — `fs:applyOps`, `createLibrary`, diálogo de nova biblioteca,
  entradas de menu.
- `preload.js` — expor `applyOps`, `createLibrary` e o diálogo.
- `watcher.js` — `pause()`/`resume()`.
- `tools/` — template do `CLAUDE.md` enxuto (regras do formato OKF, com
  frontmatter conforme); `package.json` o inclui em `extraResources`.
- `test-okf.js` / `test-renderer.js` — testes novos.
