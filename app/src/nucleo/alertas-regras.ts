/**
 * C8.4 — Regras PURAS dos alertas de preço.
 *
 * A lógica mora em `@barganha/shared` (`dominio/alertas-regras.ts`): o job de
 * push do backend (`backend/src/jobs/alerta-preco.ts`, C8.4 passo 8) usa a
 * MESMA regra de escolha de escopo e a MESMA histerese de frescor que o app usa
 * para o alerta local — mover para `shared/` evita duas fontes de verdade para
 * a mesma decisão. Este arquivo só reexporta.
 *
 * `CacheEstatistica` (app/src/dados/tipos.ts) continua sendo o tipo usado pelos
 * chamadores locais (`alertas.ts`, `tipico-regional.ts`): ele é estruturalmente
 * idêntico a `EstatisticaRegional` (mesmos campos/nulidade, espelhando
 * `preco_estatistica`), então passa nas funções abaixo sem adaptação.
 */
export { avaliarAlerta, escolherEstatisticaRegional, type AlertaDisparado } from '@barganha/shared';
