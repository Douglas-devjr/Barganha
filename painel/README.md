# Painel do Projeto

Uma página só, autocontida, com o estado real do Barganha: o que cada função faz,
com quem ela conversa, as regras de negócio, o status de cada etapa `C0`–`C13`,
o que impede publicar hoje e o passo a passo até a Google Play.

```powershell
cd C:\Users\exten\Desktop\Comparai
npm run painel          # gera painel/index.html
npm run painel:abrir    # abre no navegador
npm run painel:observar # regera sozinho a cada mudança (dev local)
```

## Os três arquivos

| Arquivo | O que é |
|---|---|
| `mapa.mjs` | **A única coisa que se escreve à mão.** Funções, regras, etapas, bloqueadores, roteiro de publicação, skills. |
| `gerar.mjs` | Lê o mapa, **confere contra o repositório** e emite `index.html`. Não se edita para mudar conteúdo. |
| `observar.mjs` | Observa `mapa.mjs` e o código-fonte (`app/src`, `backend/src`, `shared/src`, `supabase/migrations`, `docs`) e roda `gerar.mjs` de novo a cada mudança. Só para desenvolvimento local — o CI continua usando `painel:conferir`, que falha em vez de gerar. |

`index.html` é gerado — nunca edite direto, a próxima geração sobrescreve. Ele
está fora do gate do Prettier por isso.

## Por que existe um mapa curado

Status ("pronto / pela metade / falta") e regra de negócio não são deriváveis do
código: nenhum grep sabe que a UI da economia real está **de propósito** esperando
cobertura de dados, nem por que a zona morta é 5%. Isso é conhecimento, e mora no
mapa.

O que **é** derivável, o gerador mede sozinho a cada execução: número de rotas,
telas, parsers, tabelas, migrações, arquivos de teste, rotinas agendadas, commit
atual e se havia mudança sem commit. Esses números ninguém digita.

## Como o painel não fica desatualizado

Ele se recusa a ficar. A conferência olha para os dois lados:

- **Código → mapa:** rota ou tela que existe no repositório e nenhum item do mapa
  menciona aparece como *"novo no código, sem dono no painel"*.
- **Mapa → código:** arquivo ou rota que o mapa cita e o repositório não tem mais
  aparece marcado como *evidência que sumiu*.
- **Mapa → mapa:** um "conversa com" apontando para função inexistente, ou uma
  regra/etapa que não existe, é referência quebrada — some silenciosamente na
  página se ninguém avisar.

```powershell
npm run painel:conferir   # falha (exit 1) se houver deriva
```

Esse comando roda dentro do `npm run check` e como passo do CI. Então mudar código
sem atualizar o mapa **reprova o build**, com o nome de cada item fora de lugar.

Isso é a rede de segurança, não geração automática: `index.html` só é reescrito
quando alguém roda `npm run painel`. Para não ter que lembrar, deixe
`npm run painel:observar` rodando enquanto trabalha — ele regera sozinho a cada
save.

## O ciclo, na prática

1. Você muda o código.
2. Atualiza o item correspondente no `mapa.mjs` — normalmente uma linha: virar
   `status: 'pronto'`, ou reescrever o campo `falta`.
3. `npm run painel`.
4. Esqueceu? O `check`/CI acusa por nome.

## Detalhes

- **Sem rede.** Tudo embutido: CSS, JS e a fonte Instrument Sans (a mesma do app,
  lida de `node_modules`) como data URI. Abre por `file://`, funciona offline.
- **Tema claro e escuro** pelos tokens de `app/src/tema/cores.ts` — o painel fala a
  mesma linguagem visual do produto, incluindo verde/âmbar/vermelho como
  barato/na média/caro.
- **Ouvir**: cada seção tem um botão que lê o resumo em voz alta (`speechSynthesis`
  do navegador, pt-BR). Some sozinho onde a API não existe.
- **Imprime bem**: a barra de topo, os filtros e os detalhes recolhidos saem na
  impressão/PDF.
