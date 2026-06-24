---
type: Playbook
title: Resposta a incidentes
description: Passos para triagem e resolução de incidentes de produção.
tags: [oncall, incidente, operações]
timestamp: 2026-06-10T11:45:00Z
---

# Gatilho

Um alerta de indisponibilidade ou degradação dispara este playbook.

# Passos

1. Reconhecer o alerta e abrir canal de incidente.
2. Identificar o serviço afetado (ex.: pipelines do [Projeto Atlas](/projetos/atlas.md)).
3. Mitigar, comunicar status e registrar a linha do tempo.
4. Conduzir post-mortem após a resolução.

# Citations

[1] [Política de severidade de incidentes](https://intranet.exemplo.com/ops/severidade)
