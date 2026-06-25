# Design: refinamento da heurística PDF→MD

- **Data:** 2026-06-25
- **App:** OKF Studio (Electron, Windows)
- **Contexto:** evolução da feature de importação entregue no PR #7
  (branch `feat/conversao-documentos`). Continua na MESMA branch.
- **Status:** Aprovado para planejamento

## Objetivo

Aumentar a fidelidade da conversão **PDF→Markdown** (caminho de texto), mantendo
tudo **100% local/offline e heurístico** (sem ML, sem nuvem). Foco em quatro
defeitos confirmados em PDFs reais + um bônus de ligaduras.

## Diagnóstico (em PDFs reais do usuário)

Rodando o conversor atual em normas ABNT e instruções normativas SPU:

| Defeito | Evidência | Gravidade |
| --- | --- | --- |
| Parágrafos quebrados linha-a-linha | cada linha física vira um parágrafo isolado | altíssima |
| Tabelas falsas | 48 linhas `\| --- \|` numa NBR, 17 numa IN; prosa/rodapé viram "tabela" picotada | altíssima |
| Cabeçalho/rodapé repetido | em toda página: `Exemplar para uso exclusivo … Impresso: …`, `© ABNT 2011 …`, `ABNT NBR 14653-2:2011`, nº de página | alta |
| Ligaduras fi/fl | `cientí fi ca`, `pro fi ssional`, `en fi teuta` | média (bônus) |

O pior defeito é a **tabela falsa**, frequentemente disparada pelas próprias
linhas de rodapé e pelos gaps de ligadura.

## Decisões de escopo

- Refino **heurístico local**; sem ML, sem nuvem.
- Cobrir: reflow de parágrafos (+ des-hifenização), remoção de cabeçalho/rodapé
  repetidos, ordenação de leitura multi-coluna, e endurecimento da detecção de
  tabela. Bônus: junção de ligaduras fi/fl.
- **Fora de escopo:** detecção de títulos por negrito/centralização (segue só
  por tamanho de fonte, como hoje), tabelas com células mescladas, extração de
  imagens embutidas de PDF, OCR (inalterado).

## Arquitetura

A lógica nova fica em `src/convert/reconstruct.js` (pura, testável). A única
melhoria **entre páginas** (cabeçalho/rodapé) entra como função pura separada.

- `reconstructMarkdown(items)` — continua sendo a função **por página**. Passa a
  fazer: split de colunas → por coluna, agrupar linhas → classificar blocos →
  reflow nos parágrafos → tabela (estrita) → emitir. Mantém a assinatura atual.
- `stripRunningHeadersFooters(pages)` — **nova função pura**. Recebe
  `pages = [{ items, height }, …]` (apenas páginas de texto), detecta linhas
  repetidas nas faixas de topo/rodapé e devolve as páginas com esses itens
  removidos. Não altera o conteúdo do miolo.
- `src/convert/index.js` (dispatcher, browser) — `convertPdf` passa a fazer
  **duas passagens**: (1) para cada página, ou normaliza os itens de texto
  (`normItems`) ou marca como página de OCR; (2) roda `stripRunningHeadersFooters`
  sobre as páginas de texto; (3) gera o Markdown na ordem original — páginas de
  texto via `reconstructMarkdown(itensFiltrados)`, páginas de OCR via o texto do
  Tesseract — e junta. A ordem das páginas é preservada.

## Componentes / algoritmos

### 1. Split de colunas (ordem de leitura)
Detecta uma **calha** vertical (faixa de x sem texto) que separa a página em 2+
regiões, **cada uma com texto ao longo da maior parte da altura** (≥ ~60% da
extensão vertical) e largura de calha relevante (≥ ~5% da largura da página).
Havendo calha, particiona os itens por coluna e processa **coluna a coluna**
(esquerda→direita), cada coluna como um fluxo independente. Sem calha clara →
fluxo único (comportamento atual). A exigência de calha alta (quase toda a
página) distingue layout multi-coluna de gaps locais de tabela.

### 2. Agrupamento de linhas
Mantém `groupLines` (agrupa por proximidade de `y`). Dentro de uma coluna.

### 3. Classificação de blocos
Cada linha é classificada: **título** (razão de tamanho de fonte vs. mediana,
como hoje), **lista** (regex de marcador, como hoje) ou **corpo**. Sequências
maximais de linhas de corpo formam um **bloco** que vira tabela (se passar no
detector estrito) ou parágrafos reflow-ados.

### 4. Reflow de parágrafos (+ des-hifenização)
Num bloco de corpo, calcula o gap vertical típico (mediana dos gaps entre linhas
consecutivas). Junta linhas no mesmo parágrafo, iniciando **novo parágrafo**
quando o gap > ~1,5× o típico (espaço de parágrafo). Ao juntar:
- se o texto acumulado termina em `[letra]-` e a próxima linha começa em letra
  minúscula → remove o hífen e junta sem espaço (**des-hifenização**);
- caso contrário, junta com um espaço.

### 5. Detector de tabela (estrito)
Só emite tabela quando TODAS valerem: bloco com **≥2 linhas**; **gutters**
verticais reais (faixas de x contínuas sem texto, separando ≥2 colunas
consistentes); **contagem de colunas consistente** entre a maioria das linhas; e
a **maioria das células preenchida**. Prosa com leve alinhamento, linha única,
ou gaps de ligadura **não** viram tabela. Tabelas de grade reais continuam
virando GFM. (Substitui o `isTableBlock`/`detectColumns` atuais, que são
agressivos demais.)

### 6. Cabeçalho/rodapé/numeração (entre páginas)
Faixas de topo e rodapé = ~12% superiores/inferiores da altura da página. Para
cada página, coleta as linhas inteiramente dentro das faixas; normaliza o texto
(minúsculas, espaços colapsados, sequências de dígitos → `#`). Uma forma
normalizada que aparece em **≥ max(2, 60% das páginas de texto)** é tratada como
running head/foot e seus itens são removidos de todas as páginas. Também remove,
nas faixas, linhas que sejam **apenas número de página** (só dígitos ou só
algarismo romano curto). Salvaguarda: nunca remove linhas fora das faixas.

### 7. Ligaduras (bônus)
Em `lineText`, ao decidir inserir espaço entre itens, **suprime** o espaço quando
o item atual (ou o anterior) é um token de ligadura puro (`fi`, `fl`, `ff`,
`ffi`, `ffl`, e os caracteres Unicode `ﬁ`/`ﬂ`) e o gap é pequeno (< ~0,6×
tamanho de fonte) — religando `científica`/`profissional`.

## Ordem do pipeline (resumo)

`itens das páginas → stripRunningHeadersFooters (entre páginas) → [por página] →
split de colunas → [por coluna] agrupar linhas → classificar blocos → (tabela
estrita | reflow de parágrafos) → emitir → juntar páginas`.

## Dados / API

- `reconstructMarkdown(items: Item[]) -> string` (assinatura inalterada).
  `Item = { str, x, y, w, h, fontSize, bold, italic }`, origem topo-esquerda.
- `stripRunningHeadersFooters(pages: {items: Item[], height: number}[]) ->
  {items: Item[], height: number}[]` (nova; pura).
- Exports adicionais auxiliares (`splitColumns`, `reflowBlock`, `isTableStrict`)
  conforme necessário para teste unitário; o contrato público é
  `reconstructMarkdown` + `stripRunningHeadersFooters`.

## Testes

### Fixtures sintéticas (em `test-convert.js`, estilo atual) — positivas E negativas
- **Reflow:** 2 linhas de um parágrafo viram um parágrafo; **não** junta quando
  há gap de parágrafo; des-hifenização: `experi-` + `ência` → `experiência`.
- **Multi-coluna:** itens de 2 colunas saem na ordem coluna-A inteira, depois
  coluna-B; página de 1 coluna fica inalterada.
- **Cabeçalho/rodapé:** linha repetida na faixa de topo em 3 páginas é removida;
  linha de conteúdo (1 ocorrência) é mantida; linha "só número de página" some.
- **Tabela estrita:** prosa levemente alinhada **não** vira tabela; tabela 2×3
  real continua virando GFM; bloco com 1 linha nunca vira tabela.
- **Ligaduras:** `cientí`+`fi`+`ca` (gaps pequenos) → `científica`.
- **Regressão:** todos os testes existentes continuam verdes.

### QA com corpus real (dev-only)
Harness `tools/pdf2md-cli.mjs` (NÃO empacotado) converte um PDF usando o caminho
de texto real (pdf.js em Node + `reconstructMarkdown`). Métricas objetivas de
antes/depois nos 6 PDFs do usuário (mantidos fora do repo):
- nº de linhas `| --- |` cai para ~0 falsos (só tabelas reais permanecem);
- linhas de rodapé `Exemplar para uso exclusivo …` / `© ABNT …` somem;
- texto deixa de sair linha-a-linha (parágrafos contínuos).
`.pdf-diag/` (saídas locais) entra no `.gitignore`.

## Riscos

- **Reflow agressivo demais** pode juntar coisas que deveriam ficar separadas →
  mitigado por gap-de-parágrafo conservador e testes negativos.
- **Split de colunas** pode confundir tabela larga com colunas → mitigado pela
  exigência de calha que cruza quase toda a altura da página.
- **Heurística de tabela** nunca será perfeita em tabelas sem grade/mescladas →
  aceito no v1; o objetivo é eliminar falsos positivos sem perder grades reais.
- Calibração final depende de inspeção manual no corpus real (passo do usuário).
