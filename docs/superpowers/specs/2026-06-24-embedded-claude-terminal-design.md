# Design — Terminal Claude Code acoplado ao OKF Studio

Data: 2026-06-24
Projeto: OKF Studio (app Electron para bibliotecas Open Knowledge Format)

## Objetivo

Embutir um **terminal real** no OKF Studio (doca inferior) rodando um shell na
pasta da biblioteca aberta, com um botão para iniciar o **Claude Code**. A
biblioteca permanece aberta e **se atualiza sozinha** conforme o Claude Code (ou
qualquer processo) edita os arquivos `.md` no disco.

## Decisões (do brainstorming)

- **Experiência:** terminal de verdade **dentro da janela** (não um terminal
  externo, nem chat via SDK).
- **Conteúdo:** **shell (PowerShell)** na raiz da biblioteca + botão
  **▸ Iniciar Claude Code** (envia `claude⏎`).
- **Atualização ao vivo:** observador de arquivos recarrega a biblioteca
  automaticamente; protege a edição em andamento no app.
- **Layout:** **doca inferior** redimensionável, oculta por padrão.
- **Atalho:** **Ctrl+J** abre/fecha o terminal.
- **Sem biblioteca aberta:** o terminal fica **desabilitado** até abrir uma
  pasta (o `cwd` é sempre a raiz da biblioteca).

## Arquitetura

### 1. PTY no processo principal (`node-pty`)
- Ao abrir o terminal, `main.js` cria um pseudo-terminal rodando **PowerShell**
  (`powershell.exe`) com `cwd` = raiz da biblioteca aberta e `env` herdado
  (para que `claude` esteja no PATH).
- Encaminha dados PTY→renderer e entrada renderer→PTY; trata `resize` (colunas/
  linhas) e `exit`.
- Uma instância por janela (v1: terminal único, não múltiplas abas).

### 2. UI do terminal no renderer (`@xterm/xterm`)
- Painel na doca inferior com `xterm.js` + addon de ajuste (`@xterm/addon-fit`),
  carregado como **bundle/arquivo local** (CSP `script-src 'self'`) junto do CSS
  do xterm.
- Tema do terminal acompanha o tema do app (claro/escuro) via cores do xterm.
- Cabeçalho da doca: rótulo com o `cwd`, botão **▸ Iniciar Claude Code**, botão
  **fechar**. Alça de redimensionamento no topo da doca.

### 3. Ponte segura (preload)
Canais expostos via `contextBridge`:
- `term:start({ cols, rows })` → cria o PTY (cwd = biblioteca atual).
- `term:input(data)` → escreve no PTY.
- `term:resize({ cols, rows })` → redimensiona o PTY.
- `onTermData(cb)` → recebe a saída do PTY (`term:data`).
- `onTermExit(cb)` → notifica encerramento (`term:exit`).
- `term:kill()` → encerra o PTY (ao fechar a doca/janela).

### 4. Observador de arquivos (`chokidar`)
- Vigia a raiz da biblioteca, **ignorando** `.git`, `node_modules`, `dist`,
  `.superpowers` e arquivos ocultos.
- Em `add`/`change`/`unlink`, com **debounce** (~300 ms), envia `bundle:changed`
  ao renderer.
- Reiniciado a cada `bundle:read`/`bundle:sample` (passa a vigiar a nova raiz);
  encerrado ao trocar de biblioteca ou fechar a janela.

## Comportamento de atualização ao vivo (renderer)

- Ao receber `bundle:changed`, o app **re-lê** a biblioteca (re-walk), reconstrói
  índices/grafo e atualiza a árvore, **preservando a seleção** atual.
- Se o conceito aberto ainda existe e **não está em edição**, é re-renderizado.
- **Proteção de edição:** se o usuário está **editando** um conceito no app e
  *esse mesmo arquivo* mudou no disco, o app **não sobrescreve**: mostra um aviso
  não destrutivo **"Este conceito mudou no disco — recarregar e descartar suas
  alterações?"** (Recarregar / Manter edição). Mudanças em outros arquivos
  atualizam a árvore sem interromper a edição.
- **Anti-loop:** gravações do próprio app (salvar/criar/excluir) marcam o
  caminho afetado numa "janela de ignorar" curta para o observador não disparar
  recarga redundante.

## Empacotamento

- `node-pty` é **módulo nativo**: precisa ser recompilado para a ABI do Electron.
  - O **electron-builder recompila** módulos nativos no `dist`/`publish`
    (`npmRebuild` padrão = true).
  - Para o modo dev, adicionar `@electron/rebuild` (devDependency) e um script
    `rebuild` (rodar após `npm install`).
  - No empacotamento, o binário sai do asar via `asarUnpack` (ex.:
    `node_modules/node-pty/**`).
- `@xterm/xterm` e `@xterm/addon-fit` são JS puro (renderer); o CSS do xterm é
  copiado para `renderer/vendor/` (ou referenciado localmente).
- `chokidar` é JS puro (sem binário nativo obrigatório).

## Componentes e fronteiras

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `main.js` (seção PTY) | Criar/gerenciar o PTY; IPC term:* | node-pty |
| `main.js` (watcher) | Vigiar a biblioteca; emitir `bundle:changed` | chokidar |
| `preload.js` | Expor a ponte do terminal e do watcher | — |
| `renderer/terminal.js` (novo) | Montar xterm, doca, botão Claude, resize | xterm |
| `renderer/renderer.js` | Toggle da doca (Ctrl+J), recarga ao vivo, proteção de edição | OKF, ponte |
| `renderer/index.html` | Marcação da doca + `<script>`/CSS do xterm | — |
| `renderer/styles.css` | Estilos da doca e alça de redimensionamento | — |

## Testes / verificação

- **Headless (test-renderer):** `term:start` cria o PTY, escreve um comando
  simples (ex.: `echo okf-pty-ok`) e confirma a saída via `onTermData`; o
  observador detecta uma alteração num arquivo de teste e dispara
  `bundle:changed`; smoke test confirma que o app carrega, `xterm` está presente
  e **sem violações de CSP**.
- **Verificação visual** da doca (claro/escuro) por screenshot.
- `npm test` (núcleo) e `npm run dist` (build com `node-pty` recompilado e
  `asarUnpack`) continuam funcionando.

## Fora de escopo (YAGNI)

- Múltiplas abas/instâncias de terminal.
- Perfis de shell configuráveis (v1: PowerShell no Windows).
- Integração via API/SDK do Claude (usa-se o Claude Code de verdade no PATH).
- Suporte a macOS/Linux (foco Windows; a arquitetura não impede no futuro).

## Riscos e mitigações

- **Dependência nativa (`node-pty`)**: aumenta a complexidade de build e pode
  exigir recompilar a cada upgrade do Electron. Mitigação: `@electron/rebuild`
  (dev) + `npmRebuild` do electron-builder (prod); fixar versões compatíveis.
- **Execução de comandos arbitrários** no terminal: esperado (máquina e controle
  do usuário); o app não adiciona privilégios.
- **Concorrência de edição** (app e Claude no mesmo arquivo): tratada pela
  proteção de edição (aviso não destrutivo) e pela recarga preservando seleção.
- **`claude` ausente no PATH**: o botão apenas envia o comando; se não existir, o
  shell mostra o erro normalmente (documentar que o Claude Code precisa estar
  instalado).
