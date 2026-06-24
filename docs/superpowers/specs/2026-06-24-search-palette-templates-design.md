# Design — Busca no conteúdo + Paleta de comandos + Modelos por tipo

Data: 2026-06-24
Projeto: OKF Studio (app Electron para bibliotecas Open Knowledge Format)

## Objetivo

Três melhorias de produtividade, independentes entre si:

1. **Busca no conteúdo (full-text):** a busca da árvore passa a casar também o
   corpo dos conceitos.
2. **Paleta de comandos (Ctrl+P):** pular para qualquer conceito e disparar ações
   pelo teclado.
3. **Modelos por tipo (embutidos):** ao criar um conceito, escolher um esqueleto
   pronto conforme o tipo.

## Decisões (do brainstorming)

- **Busca:** apenas **filtra a árvore** pelo conteúdo (sem trecho/realce).
- **Paleta:** **conceitos + ações principais**; substring simples; navegação por
  teclado.
- **Modelos:** **embutidos no app**, escolhidos no modal Novo.

## 1. Busca no conteúdo

- Em `renderTree`, o filtro de busca passa a incluir o corpo do conceito:
  hoje casa `title`/`id`/`tags`; passa a casar também `parsedOf(d).body`
  (minúsculas, substring). Reusa o `parsedOf` memoizado.
- Sem mudança de UI; conceitos cujo corpo contém o termo aparecem na árvore.

## 2. Paleta de comandos (Ctrl+P)

- **Modal `#palette`** (estilo dos modais existentes): campo de busca
  `#palette-input` + lista `#palette-list`.
- **Abrir:** `Ctrl+P` (ou `Cmd+P`); **fechar:** Esc ou clique fora.
- **Itens:** um registro combinado de
  - **Ações** (estáticas): Novo conceito, Grafo, Validar, Painel Git,
    Claude Code, Manual, Alternar tema, Recarregar, Abrir biblioteca, Exemplo.
    Cada ação: `{ label, run, needsLib }`.
  - **Conceitos** (dinâmicos): para cada doc não-reservado, `{ label: title,
    sub: relPath, run: () => openDoc(relPath) }`.
- **Filtro:** substring (minúsculas) sobre `label` + `sub`. Ações que exigem
  biblioteca (`needsLib`) só aparecem com biblioteca aberta.
- **Navegação por teclado:** ↑/↓ move a seleção (com destaque visual), **Enter**
  ativa o item selecionado, **Esc** fecha. Clique do mouse também ativa.
- **Disponibilidade:** a paleta abre sempre; sem biblioteca, mostra só ações
  globais (Abrir, Exemplo, Alternar tema, Manual) e nenhum conceito.

## 3. Modelos por tipo (embutidos)

- Constante `CONCEPT_TEMPLATES` (em `renderer/renderer.js`): mapa
  `nome → { type, body }`, com:
  - **Em branco** → `type: ''`, body genérico ("# título\n\nDescreva aqui.").
  - **Projeto** → seções `## Objetivo`, `## Status`, `## Marcos`.
  - **Processo** → `## Quando usar`, `## Passos`, `## Responsáveis`.
  - **Métrica** → `## Definição`, `## Como calcular`, `## Fonte`.
  - **Referência** → `## Resumo`, `## Detalhes`.
  - **Playbook** → `## Gatilho`, `## Passos`, `## Pós-ação`.
- No modal **Novo**, adicionar um seletor `#m-template` (Modelo) listando os
  nomes acima (default "Em branco").
- Ao mudar o seletor: se o campo `type` estiver vazio, preenche com o `type` do
  modelo. Em `createConcept`, o **corpo** do conceito passa a ser o `body` do
  modelo escolhido (substituindo o esqueleto genérico atual). O título no body
  usa o `title` informado (ou "Novo conceito").

## Componentes / fronteiras

| Unidade | Responsabilidade |
|---|---|
| `renderer/renderer.js` | Busca por conteúdo; paleta (open/filter/render/teclado/ativar); `CONCEPT_TEMPLATES` + `createConcept` |
| `renderer/index.html` | Modal `#palette`; seletor `#m-template` no modal Novo |
| `renderer/styles.css` | Estilos da paleta |

## Testes

- **Smoke (`test-renderer.js`):** confirma que o modal `#palette` existe no DOM e
  que `window.__okfTemplates` (exposto para teste) tem ao menos os 6 modelos; sem
  violações de CSP.
- **Verificação manual + screenshot:** busca filtra por conteúdo; `Ctrl+P` abre a
  paleta e navega por teclado; escolher um modelo gera o esqueleto correto.

## Fora de escopo (YAGNI)

- Realce/trecho do termo na busca; fuzzy-match avançado na paleta; modelos
  editáveis pelo usuário (arquivos na biblioteca).
