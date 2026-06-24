# Design — Painel Git no OKF Studio

Data: 2026-06-24
Projeto: OKF Studio (app Electron para bibliotecas Open Knowledge Format)

## Objetivo

Ver e versionar, dentro do app, as mudanças na biblioteca aberta — fechando o
ciclo **"Claude edita pelo terminal → app recarrega ao vivo → você
commita/envia"**, sem sair do OKF Studio.

## Decisões (do brainstorming)

- **Escopo v1 (essencial):** ver mudanças (status) + **commit de tudo** + **push**,
  com **git init** para pasta sem repositório.
- **Push:** usa as credenciais do sistema (Git Credential Manager). O app **não
  manuseia senhas/tokens**; se o push pedir login, mostra o erro e orienta usar
  o terminal.
- **UI:** botão **⎇ Git** na barra → tela de overlay (padrão do Grafo/Validar/
  Manual).
- **Ao vivo:** o status se atualiza junto com o observador de arquivos (`chokidar`).

## Arquitetura

### 1. Backend (`git.js`, processo principal)
Executa o `git` (CLI já instalado) via `child_process`, sempre com `cwd =
currentRoot` (a raiz da biblioteca aberta). Funções e handlers IPC:

- `isRepo()` → `git rev-parse --is-inside-work-tree` (true/false).
- `status()` → `git status --porcelain` → lista `[{ code, path }]`
  (code = XY do porcelain: `M`, `A`, `D`, `??` etc.) + `hasRemote`
  (`git remote` não vazio) + `branch` (`git rev-parse --abbrev-ref HEAD`).
- `commit(message)` → `git add -A` então `git commit -m <message>`.
- `push()` → `git push`.
- `init()` → `git init`.

Cada função retorna `{ ok, ...dados }` ou `{ ok:false, error }` (stderr do git).
Handlers IPC: `git:status`, `git:commit`, `git:push`, `git:init`,
respondendo no `currentRoot`. Se não houver biblioteca aberta, retornam
`{ ok:false, error:'Abra uma biblioteca primeiro.' }`.

### 2. Ponte (`preload.js`)
Expor em `window.okf.git`: `status()`, `commit(message)`, `push()`, `init()`
(todos via `ipcRenderer.invoke`).

### 3. UI (renderer)
- Botão **⎇ Git** na barra (habilitado quando há biblioteca aberta), abre a tela
  de overlay `#git-view` (some com `closeOverlays`, fecha com Esc/botão Fechar).
- Conteúdo:
  - Cabeçalho com o nome da **branch** atual e um botão **Atualizar**.
  - **Lista de mudanças**: arquivos modificados/novos/removidos, com rótulo de
    estado colorido (M = aviso, A/?? = bom, D = ruim). "Nada para commitar" quando
    limpo.
  - **Mensagem de commit** (campo de texto) + botões **Commit** e **Push**.
  - **Sem repositório:** mostra aviso + botão **Inicializar (git init)**; após
    init, recarrega o status.
  - **Sem remoto:** botão **Push** desabilitado, com dica de adicionar o remoto
    pelo terminal.
- **Atualização ao vivo:** ao receber `bundle:changed` (watcher), se o painel Git
  estiver aberto, recarrega o status.
- **Feedback:** toast de sucesso/erro; após commit bem-sucedido, recarrega o
  status (some da lista) e limpa a mensagem.

## Comportamento e segurança

- **Commit/Push são disparados explicitamente** pelo usuário (clique) — é a
  confirmação; o app nunca commita/empurra sozinho.
- Assume-se que a **pasta da biblioteca é a raiz do repositório** (o git opera a
  partir de `currentRoot`).
- Erros do git (ex.: push sem credencial, sem upstream) são exibidos como toast,
  com orientação de usar o terminal quando aplicável.

## Componentes / fronteiras

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `git.js` (main) | Rodar git no `currentRoot`; IPC `git:*` | git CLI, child_process |
| `preload.js` | Ponte `okf.git.*` | — |
| `renderer/renderer.js` | Painel: status, commit, push, init, refresh ao vivo | `okf.git`, OKF |
| `renderer/index.html` + `styles.css` | Marcação e estilo do `#git-view` | — |

## Testes

- **Headless (`test-git.js`, Node):** cria um repo git temporário
  (`git init` + `git config` local), escreve um arquivo, e verifica via `git.js`
  que `status()` lista 1 mudança; após `commit('msg')`, `status()` fica vazio.
- **Smoke (`test-renderer.js`):** confirma que `window.okf.git.status` é função e
  que não há violações de CSP.
- Verificação visual do painel (claro/escuro).

## Fora de escopo (YAGNI)

- Seleção de arquivos (staging parcial), **pull**, branches, merge,
  histórico/log e diff por arquivo.
- Manuseio de credenciais e resolução de conflitos.
- Suporte a biblioteca que seja subpasta de um repositório maior (assume raiz).
