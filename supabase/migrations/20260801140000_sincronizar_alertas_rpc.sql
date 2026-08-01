-- C8.4 — Sincronização TOTAL dos alertas de preço (RPC atômica).
--
-- `PUT /alertas` substitui o conjunto INTEIRO do usuário: o que não vier no
-- envio é removido do espelho no servidor (evita drift com o SQLite do
-- aparelho, que é a fonte da verdade local). Isso são DUAS operações — apagar o
-- que saiu + upsert do que ficou — e fazê-las em duas chamadas REST separadas
-- deixaria uma janela onde uma falha parcial perde alertas. Mesmo racional de
-- `processar_cupom`/`aprovar_lancamento_manual` (C9.3.1): uma função plpgsql
-- roda as duas escritas na MESMA transação implícita.
--
-- Redefinir um alvo é tratado como ALERTA NOVO: o upsert zera `disparado_em`/
-- `rearmado_em`. Sem isto, baixar o preço-alvo de um alerta que já tinha
-- disparado para o valor antigo (mais alto) ficaria mudo — o job veria
-- `disparado_em` não-nulo e nunca reavaliaria o novo alvo, mais exigente.
--
-- Depende de: 20260801130000_alerta_preco (tabela alerta_preco).

create or replace function sincronizar_alertas(
  p_usuario_id uuid,
  p_itens      jsonb
) returns void
language plpgsql
as $$
begin
  -- Remove os alvos do usuário que NÃO vieram neste envio (substituição total).
  -- `<> all (...)` com array vazio é vacuously true — zera o conjunto quando
  -- `p_itens` é `[]` (equivalente a apagar todos).
  delete from alerta_preco
  where usuario_id = p_usuario_id
    and produto_canonico_id <> all (
      coalesce(
        (
          select array_agg((item->>'produtoCanonicoId')::uuid)
          from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) as item
        ),
        array[]::uuid[]
      )
    );

  -- Upsert de cada alvo enviado. Ver cabeçalho: redefinir zera o dedupe.
  insert into alerta_preco (usuario_id, produto_canonico_id, preco_alvo, escopo_geo)
  select
    p_usuario_id,
    (item->>'produtoCanonicoId')::uuid,
    (item->>'precoAlvo')::numeric,
    item->>'escopoGeo'
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) as item
  on conflict (usuario_id, produto_canonico_id) do update set
    preco_alvo   = excluded.preco_alvo,
    escopo_geo   = excluded.escopo_geo,
    disparado_em = null,
    rearmado_em  = null;
end;
$$;

comment on function sincronizar_alertas is
  'C8.4 — Substitui o conjunto de alertas do usuário numa transação única (delete do removido + upsert do enviado). Redefinir um alvo zera o dedupe (disparado_em/rearmado_em).';
