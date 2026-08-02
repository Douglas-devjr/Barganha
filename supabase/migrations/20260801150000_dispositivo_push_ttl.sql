-- C8.4 (gate de privacidade) — semântica REAL do TTL do token de push.
--
-- A migração 20260801130000 documentou `visto_em` como "último push entregue
-- com sucesso" e prometeu a purga de >90 dias. Duas correções, agora que o job
-- (`backend/src/jobs/alerta-preco.ts`) implementa a retenção de fato:
--
--  1. `visto_em` é SINAL DE VIDA DO APARELHO, não só de entrega: o registro do
--     token (`POST /dispositivos/push`, que o app chama toda vez que confere a
--     permissão já concedida) também o carimba. Sem isso, quem tem o app
--     instalado mas nunca recebeu um push seria purgado como se tivesse sumido,
--     e o push pararia em silêncio.
--  2. A purga existe em código, não em promessa: o job apaga, a cada rodada,
--     todo token com `visto_em` (ou, na linha antiga sem ele, `criado_em`) mais
--     velho que 90 dias. É comentário de catálogo alinhado ao comportamento —
--     token é identificador de DISPOSITIVO e não tem finalidade que justifique
--     retenção indefinida (docs/04, "Retenção e apagamento").
--
-- Só comentários: nenhuma mudança de dado ou de estrutura.

comment on table public.dispositivo_push is
  'C8.4 — Token de push Expo por aparelho (PRIVADO, identificador de '
  'dispositivo). Retenção: o job de alerta apaga token sem sinal de vida há '
  'mais de 90 dias (visto_em/criado_em) e em ticket DeviceNotRegistered.';

comment on column public.dispositivo_push.visto_em is
  'Último SINAL DE VIDA do aparelho: push entregue com sucesso OU registro/'
  're-registro do token pelo app. Base do TTL de 90 dias — não é histórico de '
  'uso nem de recebimento, só marca token vivo/morto.';
