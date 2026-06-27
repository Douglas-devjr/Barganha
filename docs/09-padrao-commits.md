# 09 — Padrão de Commits

Commits **semânticos, curtos e em português**. Baseado em Conventional Commits, adaptado ao PT-BR.

## Formato
```
tipo(escopo): descrição curta no imperativo
```
- **Sem ponto final.** Primeira letra minúscula. Imperativo ("adiciona", não "adicionado").
- **Assunto curto:** ideal ≤ 50 caracteres, **máximo 72**.
- **Escopo é opcional**, mas recomendado.
- **Corpo só quando necessário** (o porquê, não o como) — e curto. A maioria dos commits é só o assunto.

## Tipos
| tipo | quando usar |
|---|---|
| `feat` | nova funcionalidade |
| `fix` | correção de bug |
| `docs` | documentação |
| `style` | formatação/estilo, sem mudar lógica |
| `refactor` | refatoração sem mudar comportamento |
| `perf` | melhoria de performance |
| `test` | testes |
| `build` | build, dependências, configuração de pacote |
| `ci` | integração/entrega contínua |
| `chore` | manutenção/tarefas diversas |

## Escopos sugeridos
`app` · `api` · `sefaz` · `dados` · `estatistica` · `offline` · `auth` · `design` · `infra` · `docs`

## Exemplos
```
feat(app): adiciona tela de leitura de QR do cupom
fix(sefaz): corrige parser de NFC-e do RJ
feat(api): cria endpoint de ingestão de cupom
perf(dados): indexa observacao_preco por municipio
docs: adiciona modelo de dados v0
chore: configura ESLint e Prettier
```

## Regras de ouro
- **Um commit, uma intenção.** Mudanças sem relação entram em commits separados.
- **Nunca commitar segredos** nem `.env` (ver `.gitignore`).
- **Mudança que quebra compatibilidade:** marcar com `!` após o tipo/escopo e explicar no rodapé:
  ```
  feat(api)!: altera contrato de ingestão

  BREAKING CHANGE: o campo `qr` passou a se chamar `qrPayload`.
  ```
- **Nunca** adicionar co-autoria do Claude (`Co-Authored-By: Claude ...`) — commits saem só no nome do autor do git.

> O agente **git-committer** aplica este padrão automaticamente.
