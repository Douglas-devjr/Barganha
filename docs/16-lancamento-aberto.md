# 16 — Lançamento Aberto (C10.3 / Fase 4)

Runbook da promoção do beta fechado para **produção com rollout faseado**, a
ficha da loja pronta para colar e o monitoramento das métricas do roadmap.
Depende de: beta fechado concluído (`15-beta-fechado.md`) com critérios de
saída verdes. *Responsáveis:* devops-engineer, product-manager.

> **Custos:** a fase em si é R$ 0. Com usuários reais, ficar de olho nos
> gatilhos de upgrade do free tier (`13-lancamento-operacao.md`) — o primeiro a
> apertar costuma ser o cold start do Render (~US$ 7/mês para resolver).

---

## Go / No-Go (conferir ANTES de promover)

- [ ] 12+ testadores contínuos por 14 dias — Play Console liberou o acesso à produção.
- [ ] Taxa de parsing > 90% por UF ativa (consulta 1 abaixo).
- [ ] Crash-free > 99% (Play Console → Vitals).
- [ ] Veredito validado na gôndola nos municípios semeados.
- [ ] Gate LGPD (C9.2) revalidado com dados do beta.
- [ ] Ficha completa: textos desta página, screenshots, Data Safety (docs/14).

## Promoção com rollout faseado

No Play Console: *Testes fechados → Promover versão → Produção*, com
**implantação gradual**. Alternativa por CLI: mudar `track` para `production`
no perfil `submit` do `app/eas.json` e usar `eas submit`.

| Dia | Rollout | Gate para avançar |
|---|---|---|
| D0 | **10%** | 48 h com crash-free > 99%, parsing > 90%, sem alerta novo |
| D2 | **25%** | 48 h estáveis; latência do backend aceitável (cold start!) |
| D4 | **50%** | 72 h estáveis; consultas 2–4 sem queda anômala |
| D7 | **100%** | — |

**Se algo quebrar:** *Interromper implantação* (halt) no console segura a
distribuição no % atual. Correção só de JS/regras → OTA (`eas update --branch
production`) sem nova revisão; correção nativa → novo build + retomar rollout.
Problema de parsing é backend: corrigir + reprocessar (C2.5), sem tocar na loja.

## Ficha da loja (colar no Play Console)

**Título (27/30):**

> Barganha: preços de mercado

**Descrição curta (74/80):**

> Escaneie o cupom fiscal e saiba se o preço está barato, na média ou caro.

**Descrição longa:**

> Está caro ou está normal? O Barganha responde na hora, na gôndola.
>
> Escaneie o QR code do cupom fiscal depois da compra e pronto: seu histórico
> de preços se monta sozinho, sem digitar nada. Na próxima ida ao mercado,
> aponte a câmera para o código de barras e veja se o preço está BARATO, NA
> MÉDIA ou CARO para a sua região — sempre por unidade que dá para comparar:
> R$/kg, R$/L, R$/un.
>
> ✓ Veredito honesto: comparamos com a faixa típica da região (mediana), não
> com médias infladas. Promoção aparece separada, como "menor preço visto".
> ✓ Histórico automático: suas compras e sua economia, sem planilha.
> ✓ Funciona sem internet no mercado: consulte preços offline; o cupom sobe
> quando a conexão voltar.
> ✓ Base colaborativa: cada cupom escaneado melhora os preços da sua região
> para todo mundo.
>
> PRIVACIDADE DE VERDADE
> O Barganha foi construído para não saber quem você é. O CPF da nota é
> descartado no processamento e nunca armazenado. Os preços entram na base
> coletiva anônimos e soltos — sem ligação com você nem com o resto da sua
> compra. Sua localização não é rastreada: a região vem do endereço da loja.
>
> Disponível para notas de RJ e SP — novos estados em breve. Guardamos o QR de
> qualquer estado desde já: quando o seu estado entrar, seu histórico aparece
> retroativamente.

**Roteiro de screenshots (capturar no device com dados semeados, tema claro; 1 no escuro):**

1. **Verificar (herói):** veredito "Barato" num produto real com faixa típica visível — legenda "Saiba na gôndola se o preço vale".
2. **Início:** card de economia preenchido — "Sua economia, sem digitar nada".
3. **Scanner:** câmera lendo QR de cupom — "Escaneou, registrou".
4. **Nota processada:** itens + desconto/valor pago — "Sua compra, organizada".
5. **Detalhe do produto:** gráfico de 6 meses — "O preço no tempo, na sua região".
6. **Produtos** no modo escuro — "Modo escuro incluído".

## Monitoramento pós-lançamento (Supabase Studio / SQL)

Cadência: diária em D0–D7, depois 2×/semana. Complementa `GET /metricas`
(processo) e o Vitals (crashes).

```sql
-- 1) Taxa de parsing por UF (7 dias) — alvo: processado > 90% do total
select uf, evento, sum(contagem) as total
from telemetria_parsing
where dia >= current_date - 7
group by uf, evento
order by uf, total desc;

-- 2) Cupons por usuário ativo (7 dias) — métrica-norte do roadmap
select round(count(*)::numeric / nullif(count(distinct usuario_id), 0), 2)
  as cupons_por_usuario_7d
from cupom
where capturado_em >= now() - interval '7 days';

-- 3) Atividade por dia (14 dias)
select capturado_em::date as dia,
       count(distinct usuario_id) as usuarios_ativos,
       count(*) as cupons
from cupom
where capturado_em >= now() - interval '14 days'
group by 1
order by 1;

-- 4) Retenção D7 (coorte: primeiro cupom há 7–14 dias que voltou depois de 7)
with primeiro as (
  select usuario_id, min(capturado_em) as inicio
  from cupom
  group by 1
)
select round(100.0 * count(*) filter (where voltou) / nullif(count(*), 0), 1)
  as retencao_d7_pct
from (
  select p.usuario_id,
         exists (
           select 1 from cupom c
           where c.usuario_id = p.usuario_id
             and c.capturado_em >= p.inicio + interval '7 days'
         ) as voltou
  from primeiro p
  where p.inicio between now() - interval '14 days' and now() - interval '7 days'
) t;

-- 5) Cobertura: produtos com estatística confiável (n≥5) por município
select escopo_id as municipio, count(*) as produtos_confiaveis
from preco_estatistica
where escopo = 'municipio' and n_observacoes >= 5
group by 1
order by 2 desc
limit 20;

-- 6) Crescimento do pool anônimo por dia (14 dias)
select criado_em::date as dia, count(*) as observacoes
from observacao_preco
where criado_em >= now() - interval '14 days'
group by 1
order by 1;
```

Limiares de alerta (agir se): parsing `processado` < 90% numa UF; `erro_portal`
> 30% no RJ sustentado por 2+ dias; cupons/usuário < 1/semana; retenção D7 <
20%; cobertura estagnada com usuários crescendo (problema de casamento sem EAN
→ rodar `job:republicar` e revisar curadoria).

## Depois do 100%

1. Marcar o MVP como lançado no roadmap; abrir a Fase 5 (`C12` — lista
   comparada, gamificação; `C8.3`/`C8.4`).
2. Expansão de estado (`C11.1`): playbook em `13-lancamento-operacao.md` —
   parser pronto + `UFS_HABILITADAS` + reprocessamento retroativo.
3. Revisitar os gatilhos de upgrade do free tier com números reais.
