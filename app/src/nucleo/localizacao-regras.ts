/**
 * C7 — Regras PURAS da região de comparação (testáveis sem React Native): dado o
 * histórico de compras, qual recorte geográfico representa "onde esta pessoa
 * compra". A orquestração (SQLite, região escolhida à mão) fica em
 * `localizacao.ts`, como em `alertas-regras.ts` / `alertas.ts`.
 */

import type { LocalDoCupom } from '../dados/repositorio-produtos';

/** Recorte geográfico ativo das comparações. */
export interface LocalizacaoEfetiva {
  uf: string;
  municipio?: string;
}

/**
 * Valor mais repetido da lista. Empate fica com quem aparece PRIMEIRO — a lista
 * chega da compra mais nova para a mais antiga, então empate = a mais recente.
 */
function maisFrequente(valores: readonly string[]): string | undefined {
  const contagem = new Map<string, number>();
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1);

  let melhor: string | undefined;
  let maior = 0;
  // `Map` itera na ordem de inserção: com `>` estrito, o primeiro a atingir a
  // contagem máxima permanece — é o desempate por recência.
  for (const [valor, n] of contagem) {
    if (n > maior) {
      melhor = valor;
      maior = n;
    }
  }
  return melhor;
}

/**
 * Região derivada do histórico: a UF PREDOMINANTE nas compras recentes e, dentro
 * dela, o município predominante.
 *
 * Predominante, e não "a do último cupom": no nível de MUNICÍPIO uma única
 * compra de viagem ou na cidade vizinha jogaria todo o veredito para outra praça
 * de preços. Contar as compras absorve o caso isolado — e ainda acompanha quem
 * se muda, porque a janela é das compras recentes (ver `listarLocaisRecentes`).
 *
 * O município é filtrado pela UF vencedora de propósito: um par cidade/UF
 * incoerente produziria uma chave de escopo que não existe no pool.
 *
 * `null` quando não há cupom com UF. Sem município (cupons anteriores à v8, ou
 * portal que não informou a cidade) devolve só a UF — a comparação segue no
 * degrau mais amplo do fallback, como antes.
 */
export function escolherLocalPredominante(
  locais: readonly LocalDoCupom[],
): LocalizacaoEfetiva | null {
  const ufs = locais.map((l) => l.uf.trim().toUpperCase()).filter(Boolean);
  const uf = maisFrequente(ufs);
  if (!uf) return null;

  const municipio = maisFrequente(
    locais
      .filter((l) => l.uf.trim().toUpperCase() === uf)
      .map((l) => l.municipio?.trim() ?? '')
      .filter(Boolean),
  );

  return { uf, ...(municipio ? { municipio } : {}) };
}
