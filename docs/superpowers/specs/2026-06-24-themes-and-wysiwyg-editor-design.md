# Design — Temas claro/escuro + editor WYSIWYG de Markdown

Data: 2026-06-24
Projeto: OKF Studio (app Electron para bibliotecas Open Knowledge Format)

## Objetivo

Adicionar duas melhorias ao OKF Studio:

1. **Temas claro e escuro**, com escolha inicial seguindo o Windows e troca
   manual persistente.
2. **Editor visual (WYSIWYG) de Markdown** — editar o conceito já renderizado
   (estilo Word), com uma barra de ferramentas dos principais componentes de
   edição, mantendo acesso ao Markdown cru e à integridade dos arquivos `.md`.

## Decisões (do brainstorming)

- **Modo de edição:** WYSIWYG por padrão **+ toggle "Código"** para ver/editar
  o Markdown cru. (Conteúdo é mantido também por IA → revisar o texto exato
  importa.)
- **Biblioteca:** **Milkdown** (ProseMirror + remark) — Markdown-nativo, com
  round-trip fiel. Aceita-se introduzir uma **etapa de build**.
- **Link de conceito:** botão dedicado **"Inserir conceito"** que abre um
  seletor com busca dos conceitos existentes e insere o link interno correto.
- **Temas:** 1ª abertura segue `prefers-color-scheme`; botão 🌙/☀ alterna;
  escolha salva em `localStorage`.
- **Extras do Milkdown ativados:** atalhos de teclado, colar Markdown que vira
  formatação, e menu de barra "/" (slash) para inserir blocos.

## Barra de ferramentas

Agrupada por função (tudo suportado por CommonMark + GFM + history do Milkdown):

- **Modo:** 👁 Visual | `<>` Código
- **Histórico:** Desfazer (Ctrl+Z), Refazer (Ctrl+Y)
- **Texto:** Negrito, Itálico, Tachado, Código inline
- **Títulos:** H1, H2, H3
- **Blocos:** lista, lista numerada, **tarefas/checklist**, citação, tabela,
  bloco de código, **linha horizontal**
- **Inserir:** link, imagem (por URL), **Inserir conceito (OKF)**
- **Limpar:** limpar formatação

## Arquitetura

### 1. Etapa de build (nova)

- Adicionar **esbuild** como `devDependency`.
- Nova pasta `src/editor/` com a integração do Milkdown.
- `src/editor/index.js` importa Milkdown (`@milkdown/core`,
  `@milkdown/preset-commonmark`, `@milkdown/preset-gfm`,
  `@milkdown/plugin-history`, `@milkdown/plugin-listener`,
  `@milkdown/plugin-slash` ou equivalente, e o tema) e **expõe um global**
  `window.OKFEditor`.
- Script `npm run build:editor` → gera `renderer/vendor/editor.bundle.js` e
  `renderer/vendor/editor.css` em **formato IIFE** (`--global-name=OKFEditor`),
  carregados por `<script src>`/`<link>` normais → **CSP `script-src 'self'`
  intacto** (sem inline, sem CDN).
- Encadeamento automático: `prestart` roda `build:editor`; `dist`/`publish`
  rodam o build antes do empacotamento. `renderer/vendor/**` entra no
  `build.files` do electron-builder.
- `renderer/vendor/` é versionado? **Não** — é artefato de build (entra no
  `.gitignore`); é regenerado por `build:editor`.

### 2. API do módulo do editor (`window.OKFEditor`)

Interface pequena e estável, isolando o app dos detalhes do Milkdown:

- `create(container, markdown, { onChange, theme }) → instance`
- `getMarkdown() → string` / `setMarkdown(md)`
- `insertConceptLink(path, title)` — insere `[title](/path.md)` no cursor
- `runCommand(name)` — para os botões (bold, italic, strike, codeInline,
  h1/h2/h3, bulletList, orderedList, taskList, blockquote, table, codeBlock,
  hr, link, image, undo, redo, clear)
- `setTheme('light'|'dark')`
- `focus()` / `destroy()`

### 3. Integração com o modo de edição (`renderer/renderer.js`)

- O modo de edição passa a ter: formulário do frontmatter (como hoje) +
  **barra do editor** (HTML/CSS do app, tematizada pelas variáveis) +
  container do Milkdown (Visual) + `textarea` (Código, oculto por padrão).
- **Toggle Visual/Código:** ao ir para Código, preenche a `textarea` com
  `getMarkdown()`; ao voltar, `setMarkdown(textarea.value)`.
- **Salvar:** obtém o Markdown do modo ativo e serializa com o frontmatter via
  `OKF.serialize`. A memoização `parsedOf` e a reconstrução de índices/grafo
  seguem como hoje.
- **Inserir conceito:** botão abre um seletor (modal no estilo do app) com
  busca; ao escolher, chama `insertConceptLink(path, title)`.
- **Arquivos reservados** (`index.md`/`log.md`): permanecem **somente em modo
  Código** (textarea com o conteúdo bruto completo), preservando o frontmatter
  — mantém a correção já aplicada.
- **Ciclo de vida:** destruir a instância do Milkdown ao sair da edição ou
  trocar de documento (evitar vazamento).

### 4. Temas claro/escuro

- O CSS já usa variáveis em `:root`. Adicionar bloco `[data-theme="light"]`
  com a paleta clara (bg/panel/line/text/muted/accent/good/warn/bad/chip…).
- O tema é aplicado via `document.documentElement.dataset.theme`.
- O Milkdown é tematizado pelas mesmas variáveis CSS (override no
  `editor.css`/`styles.css`), reagindo ao `data-theme`.
- Inicialização: se não houver escolha salva, usa
  `matchMedia('(prefers-color-scheme: dark)')`; botão 🌙/☀ na barra alterna e
  grava em `localStorage`.
- Corrigir cores "hardcoded" que não vêm de variável — notadamente o
  `text-background-color` dos nós no grafo Cytoscape — para lerem a cor do tema
  atual em tempo de render.

### 5. Componentes e fronteiras

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `src/editor/index.js` (→ `renderer/vendor/editor.bundle.js`) | Encapsular Milkdown; expor `window.OKFEditor` | Milkdown |
| `renderer/renderer.js` | Controlar UI: edição, toggle, seletor de conceito, tema | `OKFEditor`, `OKF`, `window.okf` |
| `renderer/styles.css` | Paleta clara/escura + estilos da barra + overrides do Milkdown | — |
| `renderer/index.html` | Marcação da barra do editor, botão de tema, `<script>`/`<link>` do vendor | — |
| build (esbuild) | Gerar o bundle do editor | esbuild |

## Testes / verificação

- **`test-renderer.js` (estendido):** após `build:editor`, carregar o app,
  inicializar o editor com Markdown de exemplo e verificar **round-trip** de
  heading, lista, lista de tarefas, tabela, link e bloco de código; verificar
  `insertConceptLink`; verificar troca de tema (`data-theme` aplicado) e
  **ausência de violações de CSP**.
- **`test-okf.js` (núcleo):** segue intacto (parsing/grafo/validação).
- Build de produção (`npm run dist`) deve continuar gerando os `.exe` e o
  `latest.yml`.

## Fora de escopo (YAGNI)

- Imagem apenas por **URL** (sem upload/colar arquivo).
- Sem colaboração/multi-cursor, sem exportação para PDF/DOCX.
- Sem mudanças no mecanismo de auto-update já existente.

## Riscos e mitigações

- **Round-trip do Markdown:** o Milkdown normaliza a formatação ao serializar.
  É aceitável e desejável para OKF; cobrir com teste de round-trip dos
  construtos usados na biblioteca.
- **CSP:** Milkdown injeta estilos inline (já permitido por
  `style-src 'unsafe-inline'`) e roda como script local (permitido por
  `script-src 'self'`). Verificar no smoke test que não há violação nem uso de
  `eval`/`Function`.
- **Etapa de build:** introduz dependência de tooling; mitigado por esbuild
  (binário único, sem config) e encadeamento automático via `prestart`/predist.
