# 08 — Equipe de Agentes

O Barganha é construído por um "time" de agentes especialistas (em `.claude/agents/`), todos **sênior** e com domínio profundo da sua área. Delegue cada tarefa ao agente certo.

## Quem é quem

| Agente | Papel | Aciona quando… |
|---|---|---|
| **tech-lead-arquiteto** | Tech Lead / Arquiteto | decisão de arquitetura, contratos entre áreas, trade-offs, impasses, features transversais |
| **product-manager** | Product Manager | escopo, prioridade, histórias/critérios de aceite, MVP vs. depois, roadmap |
| **ux-designer** | Designer UX/UI | telas, fluxos, design system, microcopy, onboarding/consentimento, exibição do veredito |
| **mobile-engineer** | Eng. Mobile (Expo/RN) | qualquer trabalho dentro do app: telas, QR, SQLite, offline, cache |
| **backend-engineer** | Eng. Backend | APIs, fila de parsing, camada de anonimização, Postgres, delta sync |
| **sefaz-integration-engineer** | Integração SEFAZ | parsers de NFC-e por estado, contrato `NotaEstruturada`, resiliência de portais |
| **data-engineer** | Eng. de Dados | schema, migrations, índices, pipeline de estatística, performance geo, delta sync |
| **data-scientist** | Cientista de Dados | lógica do veredito, mediana/percentis, decaimento, promoção, casamento por texto |
| **qa-engineer** | QA | estratégia/implementação de testes, fixtures, casos de borda, gate de release |
| **devops-engineer** | DevOps/Plataforma | CI/CD, EAS/Play, infra, filas, observabilidade, escala e custo |
| **privacy-lgpd-specialist** | Privacidade/LGPD | **gate obrigatório** em toda PR que toca dados; política e consentimento |
| **git-committer** | Commits | criar commits no padrão semântico PT-BR (curto e organizado) — ver `09-padrao-commits.md` |

## Como o time colabora (fluxo típico de uma feature)
1. **product-manager** define a história e os critérios de aceite.
2. **ux-designer** desenha o fluxo/telas.
3. **tech-lead-arquiteto** define os contratos entre app/backend/dados.
4. **mobile-engineer**, **backend-engineer**, **sefaz-integration-engineer**, **data-engineer** implementam atrás dos contratos; **data-scientist** especifica a lógica estatística.
5. **qa-engineer** testa (incl. casos de borda e gate LGPD).
6. **privacy-lgpd-specialist** revisa tudo que toca dados — pode **bloquear**.
7. **devops-engineer** publica e monitora.

## Regras de ouro do time
- Todo agente lê `CLAUDE.md` e respeita as **decisões não-negociáveis**.
- Implementação acontece **atrás de contratos** definidos pelo tech-lead.
- Nenhuma feature que toca dados sobe sem o **gate de privacidade** verde.
- Cada agente se **posiciona** com recomendação clara — não enumera opções sem decidir.

## Modelos
Os papéis de raciocínio estratégico e de risco (tech-lead, product, data-scientist, privacy) rodam em **Opus**; os de implementação focada, em **Sonnet**. Ajustável conforme necessidade.
