# OKF Studio

Aplicativo Windows (Electron) para **visualizar, editar, criar e validar**
bibliotecas de conhecimento no **Open Knowledge Format (OKF v0.1)** — o padrão
aberto do Google para representar conhecimento como arquivos Markdown com
frontmatter YAML.

Ideal para construir uma **biblioteca de conteúdo de trabalho** versionável:
projetos, processos, playbooks, métricas, referências e contatos — tudo em
arquivos `.md` que você (e agentes de IA como o Claude) podem ler e manter.

---

## O que o app faz

- **Navegação em árvore** por diretórios/categorias da biblioteca.
- **Visualização** de cada conceito: frontmatter em destaque + corpo Markdown
  renderizado (tabelas, listas, código).
- **Links internos navegáveis** — clicar em `[texto](/categoria/arquivo.md)`
  abre o conceito; links externos abrem no navegador; links quebrados são
  marcados em vermelho.
- **"Citado por"** (backlinks) calculado a partir do grafo de links.
- **Edição** com formulário para os campos do frontmatter (`type`, `title`,
  `description`, `resource`, `tags`, `timestamp`) + campos extras em YAML +
  editor do corpo. Salva direto no arquivo `.md`.
- **Criar** novos conceitos (gera frontmatter conforme automaticamente).
- **Excluir** conceitos (com confirmação).
- **Validação de conformidade OKF v0.1**: aponta erros (sem frontmatter,
  YAML inválido, `type` ausente) e avisos (sem `title`/`description`, links
  internos quebrados).
- **Grafo de relacionamentos** (Cytoscape): nós coloridos por tipo, arestas
  pelos links entre conceitos; clique em um nó para abrir o conceito.
- **Busca** (título, id, tags) e **filtro por tipo**.
- **Atualizações automáticas** da versão instalada (sem reinstalar) — veja a
  seção [Atualizações automáticas](#atualizações-automáticas-sem-reinstalar).
- **Editor visual (WYSIWYG)** de Markdown (Milkdown): edição renderizada estilo
  Word, barra de ferramentas (negrito, itálico, títulos, listas, tarefas,
  citação, tabela, código, linha, link, imagem, desfazer/refazer), menu "/" e
  botão **Inserir conceito**; com toggle **Código** para o Markdown cru.
- **Temas claro e escuro** — segue o tema do Windows na 1ª abertura e alterna
  pelo botão 🌙/☀ (escolha salva).
- **Claude Code + atualização ao vivo** — o botão **⌨ Claude Code** abre o Claude
  Code num terminal (PowerShell) já na pasta da biblioteca; o app **recarrega
  sozinho** conforme os arquivos `.md` mudam no disco (com aviso para não
  sobrescrever uma edição em andamento). Requer o **Claude Code** instalado e no
  PATH.
- **Painel Git** (botão ⎇ Git): vê os arquivos alterados, faz **commit** e
  **push** da biblioteca sem sair do app; oferece **git init** se a pasta ainda
  não for um repositório. O status atualiza ao vivo conforme os arquivos mudam.

---

## Como rodar e gerar o .exe

Pré-requisito: **Node.js 18+** instalado no Windows
(https://nodejs.org — baixe a versão LTS).

Abra o **Prompt de Comando** ou **PowerShell** dentro da pasta `okf-studio` e:

```bat
:: 1. instalar as dependências (uma vez)
npm install

:: 2. rodar o app em modo desenvolvimento
npm start

:: 3. gerar o instalador .exe (NSIS) + versão portátil
npm run dist
```

> O `npm start` e o `npm run dist` rodam automaticamente `npm run build:editor`
> (esbuild) para gerar `renderer/vendor/editor.bundle.js`.

Após `npm run dist`, os arquivos ficam em **`dist/`**:

- `OKF-Studio-Setup-1.0.0-x64.exe` — instalador (cria atalho na área de trabalho).
- `OKF-Studio-Portable-1.0.0-x64.exe` — executável avulso, sem instalação.

> Para gerar apenas a versão portátil: `npm run dist:portable`.

---

## Atualizações automáticas (sem reinstalar)

A **versão instalada** (`OKF-Studio-Setup-…exe`) se **atualiza sozinha** via
[`electron-updater`](https://www.electron.build/auto-update), usando o
**GitHub Releases** como fonte. O usuário **não precisa baixar e instalar de
novo**: o app verifica, baixa em segundo plano e instala ao reiniciar.

> A versão **portátil** não tem auto-update (é um `.exe` avulso). Para receber
> atualizações automáticas, use o instalador.

### Como funciona para o usuário

1. ~3 s após abrir, o app verifica se há uma versão nova no GitHub.
2. Se houver, baixa em segundo plano (o botão **⬆ Atualizar** mostra o progresso).
3. Quando termina, aparece um aviso: **Reiniciar e instalar** ou **Depois**
   (nesse caso instala automaticamente ao fechar o app).
4. Há também **Ajuda ▸ Verificar atualizações…** para checar manualmente.

### Configuração (uma vez)

O destino já está configurado no `package.json`, em `build.publish`:

```json
"publish": [
  { "provider": "github", "owner": "ale-arc", "repo": "okf-studio" }
]
```

### Publicando uma nova versão

1. **Suba o número da versão** em `package.json` (ex.: `1.1.2` → `1.1.3`).
2. Garanta que o **GitHub CLI** está autenticado: `gh auth status`.
3. Gere e publique:

   ```bat
   npm run publish
   ```

   Isso compila o app e cria **uma única release** `vX.Y.Z` no GitHub, marcada
   como *latest*, com o instalador, a versão portátil, o `latest.yml` e o
   blockmap — tudo de uma vez. As notas são geradas automaticamente a partir
   dos PRs. Os apps já instalados detectam a nova versão e se atualizam sozinhos.

> Use `npm run release:dry` para ver o comando que será executado, sem publicar.
>
> A publicação é feita pelo `gh` (script `scripts/publish-release.mjs`), e **não**
> pelo publicador do electron-builder — isso evita a criação de releases
> duplicadas. O `gh` usa a própria autenticação; não é preciso `GH_TOKEN`.

---

## Como usar

1. Abra o app e clique em **✨ Exemplo** para carregar a biblioteca de
   demonstração incluída, ou em **📂 Abrir** para escolher uma pasta sua com
   arquivos `.md`.
2. Navegue pela árvore à esquerda; clique em um conceito para visualizar.
3. **✎ Editar** para alterar; **💾 Salvar** grava no disco.
4. **＋ Novo** cria um conceito (ex.: caminho `projetos/novo.md`, tipo `Projeto`).
5. **✓ Validar** mostra a conformidade; **🕸 Grafo** mostra o mapa de relações.

Atalhos: `Ctrl+O` abrir · `Ctrl+N` novo · `Ctrl+S` salvar · `Ctrl+R` recarregar.

---

## Estrutura do projeto

```
okf-studio/
├── package.json         Configuração do Electron + electron-builder
├── main.js              Processo principal: janela, menu, leitura/gravação de arquivos
├── preload.js           Ponte segura (contextBridge) entre interface e disco
├── watcher.js           Observador de arquivos (chokidar) — recarga ao vivo
├── git.js               Operações git (status/commit/push/init) — processo principal
├── src/editor/          Fonte do editor Milkdown (compilado por esbuild)
├── renderer/vendor/     Bundle gerado do editor (não versionado)
├── renderer/
│   ├── index.html       Layout da interface
│   ├── styles.css       Estilos (tema escuro)
│   ├── okf.js           Núcleo OKF: parsing, frontmatter, links, validação, grafo
│   └── renderer.js      Controlador da interface
├── sample-library/      Biblioteca OKF de exemplo (carregada pelo botão "Exemplo")
└── README.md
```

A pasta `sample-library/` é empacotada junto ao app (em `resources/`) para que o
botão **Exemplo** funcione mesmo no `.exe` instalado.

---

## Sobre o formato OKF (resumo)

- Uma **biblioteca (bundle)** é um diretório de arquivos `.md`.
- Cada `.md` (exceto os reservados) é um **conceito**.
- O **id do conceito** é o caminho do arquivo sem `.md`
  (ex.: `tables/orders.md` → `tables/orders`).
- **Frontmatter YAML** no topo. Único campo **obrigatório**: `type`.
  Recomendados: `title`, `description`, `resource`, `tags`, `timestamp`.
  Campos extras são permitidos e preservados.
- Arquivos **reservados**: `index.md` (listagem do diretório) e `log.md`
  (histórico de mudanças).
- Conceitos se ligam por **links Markdown**, formando um **grafo**.
- Um bundle é **conforme** se todo `.md` não-reservado tem frontmatter YAML
  parseável com `type` não-vazio. Consumidores toleram tipos/campos/links
  desconhecidos.

Especificação completa: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

---

## Usando junto com o Claude

Como a biblioteca é só arquivos `.md` + git, você pode pedir ao Claude para
atuar como mantenedor do "LLM-wiki": ingerir novas fontes, escrever/atualizar
conceitos, manter os `index.md`/`log.md` e os cross-links. O OKF Studio é a
janela visual sobre esse acervo — você curadoria, o Claude faz o trabalho
braçal de organização, e o app mostra o resultado.

## Licença

MIT.
