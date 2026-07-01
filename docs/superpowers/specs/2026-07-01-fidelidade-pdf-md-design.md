# Design: fidelidade da conversão PDF→MD (motor local)

- **Data:** 2026-07-01
- **App:** OKF Studio (Electron, Windows)
- **Contexto:** continuação do refino de PDF→MD (ver
  `2026-06-25-refino-heuristica-pdf-design.md`). O usuário aplicou mudanças
  recentes (commits `197d0e6`, `7317748`) mas a fidelidade regrediu/insuficiente.
- **Status:** Aprovado para planejamento

## Objetivo

Aumentar a fidelidade da conversão **PDF→Markdown** (caminho de texto),
mantendo tudo **100% local/offline e heurístico** (sem ML, sem nuvem, sem OCR
novo). Alvo definido com o usuário: **equilíbrio** — estrutura Markdown limpa e
navegável como base, porém **conservador**: nunca perder texto; quando um bloco
não se classifica com confiança, preservá-lo como parágrafo em vez de descartar
ou reformatar agressivamente.

## Diagnóstico (em PDFs reais do usuário)

Rodando o conversor atual (`tools/pdf2md-cli.mjs`) na **NBR 14653-1:2019**
(31 páginas, 100% texto) e inspecionando os itens do pdf.js:

| Defeito | Evidência | Gravidade |
| --- | --- | --- |
| **Espaços perdidos entre palavras** | `Termos,definições,símboloseabreviaturas`, `Classificaçãodosbens`, `Métodosparaidentificarovalordeumbem`, `terminology,definitions,symbolsandabbreviations` | altíssima |
| Título da capa partido | `# NORMA ABNT NBR` + `# BRASILEIRA 14653-1` viram dois H1 | alta |
| Blockquotes falsos | `> Segundaedição`, `> © ABNT 2019`, `> 19 páginas` (texto de capa vira citação) | alta |
| TOC ilegível | Sumário inteiro vira um parágrafo gigante com pontilhados `.....` | alta |
| Níveis de título instáveis | razão de fonte contra mediana errada (front-matter) | média |

### Causa-raiz do defeito principal (espaços)

O pdf.js **emite itens de espaço explícitos** (ex.: `{str:" ", w:0.068}`) entre
palavras. Porém:

1. Em `src/convert/reconstruct.js` (`reconstructMarkdown`), o filtro inicial
   `i.str.trim() !== ''` **descarta todos os itens só-espaço** antes da
   reconstrução.
2. A remontagem passa então a depender **só de geometria**: só insere espaço se
   `gap > 0.3 × fontSize` (≈3,3pt em fonte 11). O avanço real de muitos espaços
   é menor que isso — ou o pdf.js dobrou o avanço no `x` do item seguinte,
   deixando o espaço com `w≈0` — então **nenhum espaço é inserido** e as
   palavras colam. É intermitente por depender do kerning/fonte de cada linha.

## Decisões de escopo

- Motor **local heurístico**; corrigir cada defeito na raiz (Abordagem 1).
- Manter a arquitetura de módulos atual; refatorar só o interior da
  reconstrução, extraindo a lógica de espaçamento para um módulo próprio e
  emitindo para um **modelo de blocos leve** interno antes de serializar MD.
- Criar **harness de testes golden** (snapshots) para medir cada mudança e
  travar regressões.
- **Fora de escopo:** ML, nuvem, OCR novo (Tesseract inalterado), tabelas com
  células mescladas, fidelidade pixel-perfect, preservação de quebras de página,
  extração de imagens embutidas de PDF.

## Arquitetura

Fluxo inalterado no `index.js` (classificação texto/OCR → 2 passagens →
`stripRunningHeadersFooters` → OCR Tesseract nas páginas escaneadas). Mudanças
concentradas na reconstrução de páginas de texto:

- **`src/convert/spacing.js` (novo).** Responsabilidade única: dada uma linha de
  itens do pdf.js, produzir o texto com espaços corretos. Combina três sinais em
  ordem de confiança:
  1. **Itens de espaço explícitos** do pdf.js (deixa de descartá-los).
  2. **Espaço já presente** no fim/início do `str` dos itens.
  3. **Gap geométrico** com limiar **relativo à fonte e ao avanço médio de
     caractere da própria linha** (não fixo em `0.3×fontSize`).

  Exposto como função pura testável; usado por `lineRawText` e
  `lineFormattedText`.

- **`src/convert/reconstruct.js` (refatorado).**
  - Para de descartar itens de espaço no filtro inicial (a limpeza vira
    "remover itens sem `str`", preservando `" "`).
  - `emitLines` passa a produzir um **modelo de blocos leve** interno:
    `{ type: 'heading'|'paragraph'|'list'|'table'|'toc'|'quote'|'code', text, meta }`.
    Um serializador final converte o modelo em Markdown. Isola a regra
    conservadora (bloco não-classificado → `paragraph`).
  - Correções pontuais nos classificadores (títulos, blockquote, TOC) — ver
    abaixo.

- **`index.js` / `tools/pdf2md-cli.mjs`.** Sem mudança estrutural. O `normItems`
  dos dois caminhos deve permanecer equivalente (o CLI é o harness de
  diagnóstico do caminho de texto).

## Correções na raiz (uma por defeito)

| Defeito | Correção |
| --- | --- |
| Espaços perdidos | `spacing.js` — preserva itens de espaço e usa limiar relativo à métrica da linha |
| Título da capa partido | Mesclar linhas visuais adjacentes de tamanho grande semelhante em **um** heading |
| Blockquote falso | Só marca `>` com recuo consistente **e** contexto de citação; capa/metadados não viram quote |
| TOC (`....`) | Detectar linhas com pontilhados de preenchimento → limpar os pontos e emitir entradas `Título — pág` (bloco `toc`), não parágrafo gigante |
| Níveis de título | Calibrar razão de fonte contra a mediana do **corpo**, não do front-matter; clampes estáveis |
| Tabelas | Reaproveita `isTableStrict`; ganho indireto do espaçamento correto nas células |

## Filosofia conservadora ("equilíbrio")

- **Nunca descartar texto.** Bloco sem classificação confiável → `paragraph`.
- Só remover o que é comprovadamente "mobília" repetida (cabeçalho/rodapé/nº de
  página), tratada já em `stripRunningHeadersFooters`.
- Sem comentários `<!-- ... -->` ruidosos por padrão.

## Testes (golden snapshots)

- **Fixtures pequenas versionadas:** reutilizar as PDFs já commitadas em
  `sample-library/pdf-test/` + 2–3 PDFs sintéticos minúsculos que isolam cada
  bug (espaço, capa, TOC, tabela). Snapshots `.md` versionados; teste falha em
  regressão e imprime o diff.
- **Diagnóstico local (não versionado):** script que roda contra as 5 normas
  ABNT/SPU que o usuário enviou, gravando o MD no scratchpad para inspeção
  manual (comparar antes/depois). As PDFs ficam fora do repo.
- Integra ao `npm test` seguindo o padrão dos `test-*.js` (Node puro; o caminho
  OCR não roda no harness).

### Restrição de licença/privacidade

**Não** commitar as 5 normas ABNT/SPU no repositório: material com direitos
autorais (ABNT), repo público no GitHub, ~16MB. Uso apenas local, como
referência e para o diagnóstico. (Decisão confirmada com o usuário.)

## Critérios de aceitação

1. Nas 5 normas, **zero** ocorrências do padrão de palavras coladas
   (`\p{L}{6,}` sem espaço onde o PDF tinha espaço) introduzidas pelo conversor —
   verificado por amostragem no diagnóstico local.
2. Capa da NBR 14653-1 → **um** H1 (não dois); sem blockquotes de metadados.
3. Sumário → bloco legível (lista/entradas), não um parágrafo com pontilhados.
4. `npm test` verde, incluindo os novos snapshots golden.
5. Nenhuma perda de texto do corpo vs. a extração bruta do pdf.js (checagem de
   cobertura de caracteres no diagnóstico).
