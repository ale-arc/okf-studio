---
type: Referência
title: Regras do formato OKF
description: Instruções de manutenção desta biblioteca no Open Knowledge Format (OKF v0.1).
---

# Regras do formato OKF (v0.1)

- Cada arquivo `.md` (exceto `index.md` e `log.md`) é um **conceito**.
- Todo conceito começa com frontmatter YAML. **Obrigatório:** `type`.
  Recomendados: `title`, `description`, `resource`, `tags`, `timestamp`.
- Use links Markdown **bundle-relativos** (começando com `/`):
  `[orders](/tables/orders.md)`.
- Mantenha um `index.md` em cada diretório (lista os itens com 1 linha de
  descrição) e um `log.md` na raiz (histórico, mais recente no topo).
- Uma biblioteca é **conforme** se todo `.md` não reservado tiver frontmatter
  YAML válido com `type` não vazio.
