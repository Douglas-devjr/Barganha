-- C12.1 — Idade REAL do típico em `preco_estatistica`.
--
-- Problema: `atualizado_em` é o carimbo do RECÁLCULO, não do preço. Um recálculo
-- geral (deploy, mudança de calibração do decaimento) reescreve a tabela inteira
-- com a data de hoje, mesmo quando a observação mais nova daquela célula é de
-- meses atrás. Quem lê `atualizado_em` como frescor lê errado — e o ranking de
-- mercados passaria a eleger "MAIS BARATO" uma loja cujo preço é um fóssil.
--
-- `observado_em_max` guarda o `observado_em` da observação mais recente da base
-- REGULAR que sustenta a mediana (promoção segregada pelo cerco IQR não conta:
-- ela não entra no típico, então não pode rejuvenescê-lo).
--
-- Nulo nas linhas antigas até o próximo recálculo; quem consome trata a ausência
-- como "idade desconhecida" e, por precaução, não concede o selo de mais barato.
-- A tabela já é do lado COMPARTILHADO e já tem RLS — a coluna herda a política,
-- nada de novo a conceder aqui.

alter table preco_estatistica
  add column if not exists observado_em_max timestamptz;

comment on column preco_estatistica.observado_em_max is
  'observado_em da observação regular mais recente que sustenta a mediana. Idade do PREÇO — atualizado_em é a do recálculo.';
