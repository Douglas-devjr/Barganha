# 21 — Assinatura & Planos (C13 / estratégia)

Como o Barganha separa o que é **grátis para sempre** do que é **pago**, sem
quebrar o efeito de rede que faz o veredito existir. Decidido em 31/07/2026.

Este documento é irmão do `18-ofertas-e-monetizacao.md`: aquele trata da receita
que vem **dos mercados** (oferta anunciada, parceria); este trata da receita que
vem **do usuário** (assinatura). São linhas independentes e podem coexistir.

---

## Decisão travada: o que a assinatura NUNCA pode vender

O Barganha é um produto de **rede**. O veredito só é bom porque muita gente manda
cupom; menos cupons significam mediana pior, e mediana pior é um app pior
**inclusive para quem paga**. Daí as duas regras:

> **1. Nunca se cobra por nada que alimente o pool.** Escanear cupom é ilimitado
> no plano grátis, para sempre. Limitar a contribuição é a única forma de a
> assinatura destruir o produto que ela financia.
>
> **2. Nunca se cobra pelo veredito honesto.** A faixa típica, a mediana e o
> "barato / na média / caro" são os mesmos para todo mundo. Pagar não compra uma
> verdade melhor, mais recente ou mais precisa.

A regra 2 é a decisão travada nº 8 (muro da neutralidade) aplicada ao usuário: se
o dinheiro não pode influenciar o veredito quando vem do mercado, também não pode
quando vem do assinante.

**O que a assinatura vende, então:** profundidade (histórico longo), conveniência
(listas, alertas, várias regiões) e tempo (a cesta comparada completa). Nunca o
julgamento de preço em si.

## O corte

| | Grátis (para sempre) | Barganha+ |
|---|---|---|
| Escanear cupom | ilimitado | ilimitado |
| Veredito na gôndola (faixa típica + promoção) | completo | igual |
| Busca e catálogo regional | completo | igual |
| Histórico de compras | últimos 3 meses | completo |
| Gráfico de preço do produto (C7.5) | 30 dias | 12 meses + exportar |
| Lista de compras | 1 lista | ilimitadas + compartilhada |
| Cesta comparada (C12.1) | 3 mercados mais próximos | todos + dividir em 2 mercados |
| Alertas de preço (C8.4) | 3 produtos | ilimitados |
| Estatísticas de gasto (C8.3) | total do mês | por categoria, por mercado, tendência |
| Economia real (C8.4.1) | o número acumulado | o detalhe item a item |
| Regiões | 1, troca a cada 30 dias | várias, troca livre |
| Ofertas anunciadas (C12.4) | exibidas | ocultáveis |

> **Backup do histórico / trocar de aparelho NÃO entra no plano pago.** A versão
> anterior deste documento o listava como benefício do Barganha+ — está errado:
> o restore no login **já existe e já é grátis** (docs/04, `sincronizador`), e a
> própria tela de sair promete isso ao usuário ("seu histórico volta quando você
> entrar de novo, aqui ou em outro aparelho"). Passar para o pago seria **tirar
> algo que as pessoas já têm** — a forma mais rápida de queimar a confiança que
> sustenta o app. Fica grátis.

A lógica: o **grátis entrega a decisão na gôndola** — o motivo pelo qual alguém
baixa o app e o motivo pelo qual manda cupom. O **pago entrega o retrospecto e o
planejamento**, que interessa a quem gasta muito em mercado e topa pagar R$ 10
por mês para economizar R$ 200.

As duas features com chance real de venda são **cesta comparada completa** e
**economia real detalhada**: as duas mostram dinheiro. O resto é acessório e não
sustenta uma assinatura sozinho.

## Plus por contribuição — o modelo que encaixa neste app

> Contribuiu com **4 cupons no mês** → Barganha+ liberado no mês seguinte, de
> graça.

Por que isto é melhor aqui do que uma assinatura pura:

- quem contribui é o ativo mais valioso do produto; recompensar sai mais barato
  que comprar mídia para repor dado;
- quem **não** contribui — o carona, que só consulta preço — é exatamente quem
  deve pagar em dinheiro;
- resolve o conflito grátis × pago sem nunca travar o fluxo de cupons (regra 1);
- reaproveita a gamificação já pronta (C12.2) e as telas de conquistas.

Isso dá **três estados de conta**, sendo que os dois últimos concedem o mesmo
direito:

| estado | como se chega | validade |
|---|---|---|
| `gratis` | padrão | — |
| `plus_contribuindo` | ≥ 4 cupons processados no mês anterior | renovada mês a mês |
| `plus_pago` | assinatura ativa na Google Play | enquanto o Google confirmar |

A contagem usa **cupons processados com sucesso**, não enviados — senão vira
incentivo a mandar lixo. E a contagem é do lado privado da conta, nunca do pool.

## Pré-requisitos inegociáveis

### 1. Autenticação de verdade (C4.3.1)

Hoje o Bearer **é** o `usuarioId` — um UUID sem segredo. Quem descobre o id de
alguém vira aquela pessoa. **Não se vende assinatura em cima de uma credencial
que qualquer um copia**, nem se guarda vínculo de pagamento sob ela. O C4.3.1
deixa de ser dívida técnica e passa a ser bloqueador de C13.

### 2. Google Play Billing, obrigatoriamente

Assinatura de conteúdo digital dentro do app tem de passar pelo faturamento do
Google — Pix, Stripe ou link externo na tela violam a política e derrubam o app
da loja. Consequências:

- **A taxa entra no preço.** A alíquota de assinatura para desenvolvedor pequeno
  girava em 15%; **confirmar a vigente na data**. R$ 9,90 viram ~R$ 8,40.
- **A verdade sobre "está pago?" vem do backend, nunca do app.** O Google avisa
  por webhook (Real-time Developer Notifications); o backend confirma na API do
  Play e atualiza o estado. Cliente não decide entitlement — cliente é copiável.
- **Cancelamento, reembolso, período de carência e upgrade** são estados do
  Google que o backend precisa refletir, não inventar.

### 3. LGPD (gate obrigatório do `privacy-lgpd-specialist`)

O vínculo `usuário ↔ pagamento` é dado pessoal e vive **só no mundo privado**:

- tabela `assinatura` com `usuario_id`, token de compra do Play e estado — com
  RLS explícita na migração (ver a nota de drift de RLS do projeto);
- **jamais** encosta em `observacao_preco`: nada de "plano" no pool, nada de
  marcar a observação de quem paga. O pool não tem ponteiro de volta para
  usuário e continua sem ter;
- não se guarda cartão, nem CPF, nem nada do meio de pagamento — o Google guarda;
- a política de privacidade ganha uma linha: cancelar ou excluir a conta **não**
  remove o que já foi para o pool, porque o pool é anônimo de nascença e não há
  como identificar as observações de uma pessoa. Isso já é verdade hoje; passa a
  precisar estar escrito.

## Forma técnica

Um conceito único de **direito** (entitlement), para não espalhar `if (pago)` por
25 telas:

```
shared/    type Plano = 'gratis' | 'plus'
           type Recurso = 'historico_completo' | 'alertas_ilimitados' | ...
           podeUsar(plano, recurso): boolean        ← regra única, testável

backend/   tabela `assinatura` (privada, com RLS)
           webhook do Play → estado
           job mensal: quem contribuiu ≥ 4 cupons vira plus_contribuindo
           toda resposta de conta carrega { plano, valido_ate }

app/       cacheia { plano, valido_ate } no SQLite local
           degrada para `gratis` só depois de 7 dias sem conseguir revalidar
```

Dois detalhes que não são negociáveis pelo produto:

- **O plano precisa funcionar offline.** O app é usado no corredor do mercado,
  às vezes sem sinal. Um paywall que exige rede transforma o assinante em usuário
  grátis exatamente no momento de maior valor. Daí o cache com folga de 7 dias.
- **Recurso bloqueado aparece, não some.** Cadeado + prévia do valor ("veja onde
  seus R$ 187 foram parar"). Feature invisível não converte e ainda faz o app
  parecer menor do que é.

## Preço e momento

**Faixa sugerida:** R$ 9,90/mês ou R$ 79,90/ano (~33% de desconto no anual, que é
o que segura churn). O teste mental é simples: o assinante precisa enxergar a
economia de um mês pagando o ano inteiro.

**Quando construir:** depois do lançamento e da retenção provada — a mesma ordem
que o `18-ofertas-e-monetizacao.md` defende para as ofertas. Antes disso não se
sabe quais dessas features as pessoas usam, e cobrar pela errada queima a única
chance de primeira impressão. Sequência:

1. **Agora:** deixar o gancho pronto — `plano` no modelo de dados e `podeUsar()`
   em `shared/`, com todo mundo em `gratis`. É barato e evita refatorar 25 telas
   depois.
2. **Lançamento:** tudo liberado, instrumentado. Medir o que é realmente usado.
3. **Pós-retenção:** ligar o corte com base no que os números disserem — a tabela
   acima é hipótese, não verdade.

## Estado da implementação (31/07/2026)

Construído o **gancho**, sem cobrança nenhuma — o passo 1 da sequência acima:

| | onde |
|---|---|
| A regra, única e testada | `shared/src/plano/direitos.ts` (+ `direitos.test.ts`) |
| Plano no aparelho | `meta.obterPlano()/definirPlano()` em `app/src/dados/repositorio-meta.ts` |
| Leitura no app | `usePlano()` em `app/src/plano/` |
| Cadeado com prévia do valor | `app/src/componentes/BloqueioPlus.tsx` + `app/src/plano/FolhaPlus.tsx` |
| Cortes aplicados | Minhas compras (3 meses), gráfico do produto (30 dias), alertas (3), ranking de mercados (3) |
| Interruptor de teste | Perfil → Configurações da conta → "Simular Barganha+" |

O teste `direitos.test.ts` cruza `NUNCA_COBRAVEL` com `RECURSOS`: mover
"escanear cupom" ou "veredito" para o lado pago **reprova o build**. As duas
regras travadas deste documento deixaram de depender de alguém lembrar delas.

### Linha a linha do corte: o que está de pé e o que não está

| Linha do corte | Estado |
|---|---|
| Cupom ilimitado, veredito, faixa típica, busca, catálogo | **garantido** — e travado por teste |
| Histórico de 3 meses | **aplicado** na tela Minhas compras |
| Gráfico de 30 dias | **aplicado** no detalhe do produto |
| 3 alertas | **aplicado** (criar novo; editar/desligar nunca esbarra) |
| 3 mercados no ranking | **aplicado** na Comparar mercados |
| Estatísticas de gasto | **sem gate** — a tela não existe (C8.3) |
| Economia real detalhada | **sem gate** — a UI não existe (C8.4.1) |
| Ofertas ocultáveis | **sem gate** — a camada não existe (C12.4) |
| Listas ilimitadas / compartilhadas | **sem gate e sem feature** — o app tem UMA lista, sem `id`; virar várias é mudança de esquema local, não é um cadeado |
| Trocar de região livremente | **sem gate** — o recurso está declarado em `direitos.ts`, mas ninguém o consulta: falta guardar a data da última troca e barrar em `EditorRegiao` |

Os quatro recursos de `RECURSOS` (`estatisticas_detalhadas`,
`economia_detalhada`, `exportar_historico`, `trocar_regiao_livre`) estão
**declarados e não consultados** — `podeUsar()` existe e nenhuma tela chama.
É de propósito: três dependem de telas que ainda não foram construídas, e o
quarto (região) precisa de estado novo. Ficam declarados para a tela nascer já
perguntando ao lugar certo, mas **não confunda declaração com corte aplicado**.

### O que não existe de jeito nenhum

- **Cobrança** — nada é cobrado, não há preço em lugar nenhum do app.
- **Google Play Billing** (C13.3) — sem compra, sem webhook, sem estado do Google.
- **Plano vindo do servidor** (C13.2) — não há tabela `assinatura`, nem RLS, nem
  plano na resposta da conta. O plano é local e some no logout.
- **Plus por contribuição** (C13.4) — ninguém conta cupons do mês.
- **Folga de 7 dias sem rede** — só faz sentido quando houver o que revalidar (C13.2).
- **Testes do lado do app** — a regra em `shared/` é testada; os gates das telas
  e o `usePlano()` não têm teste. O risco real é uma tela passar a ler o plano
  errado sem nada acusar.

### O pré-requisito que continua de pé

**C4.3.1.** Enquanto o Bearer for o próprio `usuarioId`, nada disto pode virar
cobrança de verdade. O interruptor de teste não muda isso — ele existe
justamente porque não há nada a proteger ainda.

## Armadilhas a evitar

- **Limitar consultas de preço no grátis.** Mata o hábito, que é o que gera o
  cupom da próxima semana. A consulta é o produto.
- **Piorar o dado do grátis** (estatística atrasada, faixa mais grossa,
  "atualização premium"). Viola a regra 2 e destrói a única coisa que o Barganha
  tem de diferente: honestidade.
- **Assinatura antes de retenção.** Cobrar de uma base que ainda não volta ao app
  é converter 0,5% de pouca gente e concluir errado que não há mercado.
- **Trial de 7 dias que exige cartão logo no onboarding.** No onboarding o
  usuário ainda não viu valor nenhum. O gatilho certo é o momento em que ele bate
  no limite — a segunda lista, o quarto alerta, o histórico do mês passado.
