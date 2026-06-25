# Design: Importar Documentos → Markdown & Exportar Markdown → PDF

- **Data:** 2026-06-25
- **App:** OKF Studio (Electron, Windows)
- **Status:** Aprovado para planejamento

## Objetivo

Adicionar ao OKF Studio duas funcionalidades complementares, **100% locais e
offline** (sem instalar nada externo):

1. **Importar documentos → Markdown:** converter PDF, DOCX, HTML e TXT em
   `.md`, com **alta fidelidade de conteúdo e formato** — incluindo tabelas e
   **OCR para PDFs escaneados**.
2. **Exportar Markdown → PDF:** gerar um PDF do conceito aberto, renderizado
   igual à visualização do app.

A prioridade declarada é a **conversão fina**: os `.md` gerados não devem perder
conteúdo nem formatação.

## Decisões de escopo (tomadas no brainstorming)

- **Motor de conversão:** tudo local no app, nível **heurístico + OCR** (sem ML
  pesado e sem nuvem no v1).
- **Fidelidade de tabelas:** heurística por posição (ótima em grades
  simples/médias; tabelas muito complexas podem sair imperfeitas).
- **Destino do import:** **pré-visualizar no editor e salvar depois** (não cria
  arquivo automaticamente).
- **Escopo do export:** **somente o conceito atual** (sem PDF combinado/lote no v1).
- **Formatos de entrada:** **PDF + DOCX + HTML + TXT**.

## Arquitetura

Duas funcionalidades independentes, seguindo o padrão atual do app: módulos que
registram handlers IPC no `main.js`, no estilo de [git.js](../../../git.js) e
[templates.js](../../../templates.js).

- **Importação (Doc→MD)** roda no **renderer** (precisa de `canvas` para
  rasterizar páginas e de WASM do browser para OCR). Novo módulo
  `renderer/convert.js`, empacotado via esbuild em
  `renderer/vendor/convert.bundle.js` (mesmo mecanismo do editor).
- **Exportação (MD→PDF)** roda no **main**, via `webContents.printToPDF`
  (Chromium já embutido no Electron). Novo módulo `convert-pdf.js` registrando o
  handler IPC, no estilo de `registerGitHandlers`/`registerTemplateHandlers`.

Nenhuma dependência externa de runtime (sem Python, sem Puppeteer, sem
ferramentas no PATH).

## Componentes

### 1. Leitura binária de arquivo (main)

Novo handler IPC `file:readBinary({ path }) -> { name, ext, bytes }` para o
renderer obter os bytes do arquivo escolhido. A seleção do arquivo usa o
`dialog.showOpenDialog` (padrão já existente em `dialog:openFolder`), com filtros
para `.pdf/.docx/.html/.htm/.txt`.

### 2. Pipeline Doc→MD (`renderer/convert.js`)

Dispatcher por extensão. Retorna sempre:

```
{ markdown: string, images: [{ tempId, bytes, mime, suggestedName }], meta: { title } }
```

- **PDF (`pdfjs-dist`):**
  - Extrai `textContent` por página, com coordenadas (transform de cada item).
  - **Reconstrução de estrutura:**
    - Linhas agrupadas por coordenada Y; parágrafos separados por gaps
      verticais maiores que o normal.
    - **Títulos** detectados por tamanho de fonte relativo à mediana da página
      (mapeia para `#`, `##`, `###`).
    - **Negrito/itálico** pelo nome da fonte (heurística por sufixos
      `Bold`/`Italic`/`Oblique`).
    - **Tabelas** por clusterização de colunas no eixo X em linhas consecutivas
      alinhadas → emite tabela GFM.
    - Listas detectadas por marcadores no início de linha (`•`, `-`, `1.`).
  - **Imagens** embutidas extraídas via operator list / image XObjects → blobs
    temporários.
  - **PDF escaneado:** se a página não tem camada de texto (textContent vazio ou
    quase), rasteriza com `pdf.js` em canvas e roda **OCR (`tesseract.js`)** com
    idiomas `por`+`eng`. Os dados de treino (`*.traineddata`) ficam embutidos no
    app (offline). Expõe **progresso** (callback do tesseract).
- **DOCX (`mammoth`):** `convertToHtml` com handler de imagens (coleta como
  blobs) → `turndown` + `turndown-plugin-gfm` (HTML→MD, preserva tabelas).
- **HTML:** `turndown` + plugin GFM direto.
- **TXT:** texto puro repassado como corpo Markdown (sem transformação destrutiva).

`meta.title` vem do 1º título do documento ou do nome do arquivo.

### 3. Pré-visualização e salvar (renderer)

- Após converter, abre o resultado no **editor existente** (Milkdown / modo
  Código) como buffer **não salvo**, com aviso visível: *"Documento importado —
  revise e salve"*.
- As imagens aparecem no preview como **data-URI** (mantidas em memória até o
  salvar).
- Ao **salvar** pelo fluxo normal de criar conceito:
  - Grava as imagens numa subpasta **`assets/`** ao lado do `.md`.
  - Reescreve os links `data:`/temporários para **links relativos** à `assets/`.
  - Pré-preenche frontmatter OKF: `type: reference`, `title` (de `meta.title`),
    `timestamp` (data atual). Todos editáveis antes de salvar.
  - Atualiza `index.md`/`log.md` pelo mesmo mecanismo de automação que as demais
    ações de criação já usam.

### 4. Pipeline MD→PDF (`convert-pdf.js`, main)

- Handler IPC `pdf:export({ markdown, frontmatter, defaultName }) -> { path }`.
- Monta HTML com `marked` (já é dependência) + um **CSS de impressão**: tema
  **claro**, `@page` A4 com margens, `printBackground: true`. Opcionalmente
  renderiza o frontmatter como bloco de cabeçalho estilizado no topo.
- `dialog.showSaveDialog` para o destino.
- Cria uma `BrowserWindow` **oculta** (`show:false`), carrega o HTML (data URL ou
  arquivo temporário), aguarda `did-finish-load`, chama
  `webContents.printToPDF({ pageSize:'A4', printBackground:true, margins })`,
  grava o buffer no arquivo e fecha a janela.
- Retorna o caminho; a UI oferece **"abrir"** (via `shell.openPath`).

### 5. Integração na UI

Seguindo os pontos de entrada já existentes (menu Arquivo, paleta de comandos
`Ctrl+P`, botões):

- **Arquivo ▸ Importar documento…** + comando na paleta
  ("Importar documento (PDF/DOCX/HTML/TXT)").
- **Arquivo ▸ Exportar como PDF…** + comando na paleta + botão; habilitado
  somente quando há um conceito aberto.
- **Progresso de OCR:** modal/toast com porcentagem e botão **cancelar**.

## Fluxo de dados

**Import:** menu/paleta → `dialog.showOpenDialog` (main) → `file:readBinary`
(main) → `renderer/convert.js` (converte; OCR se necessário) → editor (buffer não
salvo + aviso) → usuário revisa → salvar → grava `.md` + `assets/` + atualiza
`index.md`/`log.md`.

**Export:** conceito aberto → menu/paleta/botão → `pdf:export` (main) → `marked`
+ CSS → `BrowserWindow` oculta → `printToPDF` → `showSaveDialog` → grava `.pdf` →
oferece abrir.

## Dependências novas (todas JS/WASM puras)

- `pdfjs-dist` — extração de texto + rasterização de PDF.
- `tesseract.js` — OCR em WASM; `por.traineddata` e `eng.traineddata` embutidos
  via `extraResources` (offline).
- `mammoth` — DOCX → HTML.
- `turndown` + `turndown-plugin-gfm` — HTML → Markdown (com tabelas).

Ajustes de build:

- `package.json`: incluir os novos arquivos em `build.files` e os dados do
  tesseract (worker/wasm/traineddata) em `build.extraResources`.
- `scripts/check-package-files.mjs`: validar a presença dos novos artefatos.
- Script esbuild para gerar `renderer/vendor/convert.bundle.js`.

## Tratamento de erros

- Arquivo corrompido ou tipo não suportado → mensagem amigável.
- **PDF criptografado/protegido** → detecta e avisa (não tenta forçar).
- OCR sem resultado → usa o texto que houver e avisa que pode estar incompleto.
- Arquivos grandes / OCR lento → barra de progresso + **cancelar**.
- Falha no `printToPDF` → mensagem clara; não corrompe nada no disco.
- Falha ao gravar imagens em `assets/` → aborta o salvar com mensagem (não deixa
  links quebrados).

## Testes (padrão atual `test-*.js`)

- `test-convert.js`: fixtures pequenas (PDF de texto, DOCX, HTML, TXT) →
  asserta que o MD gerado contém o título, uma tabela GFM e uma lista esperados.
  Teste de OCR marcado como lento/opcional (PDF escaneado mínimo).
- `test-pdf-export.js`: gera PDF de um `.md` de amostra e verifica que o arquivo
  começa com `%PDF` e não está vazio.
- Smoke via bridge no estilo `test-auto.js`/`test-templates.js` para os caminhos
  de IPC.

## Fora de escopo (YAGNI / fases futuras)

- Tier de **ML local** (Surya/Table-Transformer via `onnxruntime-web`) para
  tabelas complexas e scans ruins.
- API em nuvem (Datalab/Marker).
- PDF **combinado** de pasta/biblioteca, com sumário/TOC.
- Exportação em **lote** (1 PDF por arquivo).
- Formatos **RTF/ODT/EPUB**.
