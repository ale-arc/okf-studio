# Schema da biblioteca OKF (instruções para o Claude)

Este arquivo instrui um agente (Claude) a manter esta pasta como uma
biblioteca de conhecimento no **Open Knowledge Format (OKF v0.1)**.
Copie-o para a raiz da sua biblioteca real.

## Regras do formato

- Cada arquivo `.md` (exceto `index.md` e `log.md`) é um **conceito**.
- Todo conceito começa com frontmatter YAML. **Obrigatório:** `type`.
  Recomendados: `title`, `description`, `resource`, `tags`, `timestamp`.
- Use links Markdown bundle-relativos (começando com `/`) para conectar
  conceitos: `[orders](/tables/orders.md)`.
- Mantenha `index.md` em cada diretório (lista os itens com 1 linha de
  descrição) e um `log.md` na raiz (histórico, mais recente no topo).

## Workflows

**Ingerir uma fonte:** leia a fonte, discuta os pontos-chave, crie ou
atualize os conceitos afetados, atualize os `index.md` relevantes e
acrescente uma entrada ao `log.md` no formato
`## AAAA-MM-DD` + `* **Atualização**: …`.

**Responder perguntas:** consulte o `index.md` raiz, abra os conceitos
relevantes, sintetize com citações. Boas respostas podem virar novos
conceitos.

**Lint:** periodicamente, verifique contradições, conceitos órfãos (sem
links de entrada), links quebrados, e `type` ausente. Sugira correções.

## Convenções de corpo

Use seções com cabeçalhos quando aplicável: `# Schema`, `# Examples`,
`# Citations`. Prefira tabelas e listas a prosa longa.
