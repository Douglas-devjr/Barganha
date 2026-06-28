-- C2 (revisão) — guarda o instante de CAPTURA do QR informado pelo app.
-- Offline-first: o app pode capturar o QR sem sinal e só enviar depois, então
-- `capturado_em` (quando o usuário leu o QR) difere de `criado_em` (quando o
-- backend recebeu). Lado PRIVADO; nunca vai ao pool. Nulo para cupons antigos.
alter table cupom add column capturado_em timestamptz;
comment on column cupom.capturado_em is 'Quando o app capturou o QR (offline-first). Difere de criado_em (recepção).';
