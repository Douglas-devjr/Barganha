/**
 * Piso de exposição do escopo LOJA — supressão de célula pequena (docs/04).
 *
 * O pool nasce anônimo (`gate.ts`), mas anonimato não é só a ausência de
 * `usuario_id`. Uma estatística no escopo LOJA com UMA observação publica, na
 * prática, "alguém comprou este item nesta loja por este preço nesta data" — a
 * mediana de n=1 É o preço daquela compra. Loja + produto + preço + dia é um
 * contexto identificável por quem estava lá, e reabriria pela AGREGAÇÃO o que o
 * gate fecha na ESCRITA.
 *
 * A regra: no escopo LOJA nada sai do servidor (nem aparece na UI) abaixo de
 * `MIN_OBSERVACOES_EXPOR_LOJA` observações. Município e acima agregam muitas
 * lojas — ali um `n` baixo significa "poucos dados", não "a compra de fulano" —
 * então não são suprimidos, só exibidos com a ressalva de baixa confiança
 * (`MIN_OBSERVACOES_CONFIAVEL`).
 *
 * Por que uma constante SEPARADA do mínimo de confiança: aquela é de qualidade
 * estatística e vai ser calibrada com dados reais (docs/06) — pode cair. Esta é
 * de privacidade e é um PISO: baixá-la é decisão de LGPD, não de calibração.
 *
 * Só a exposição é gatilhada — a agregação continua calculando o nível loja
 * normalmente (é ele que alimenta a comparação de cesta quando amadurece).
 */

import type { EscopoGeo } from '../dominio/enums';

/** `k` mínimo de observações para uma célula de escopo LOJA poder ser exposta. */
export const MIN_OBSERVACOES_EXPOR_LOJA = 3;

/** `true` quando uma estatística de LOJA com este `n` pode sair do servidor/UI. */
export function podeExporLoja(nObservacoes: number): boolean {
  return nObservacoes >= MIN_OBSERVACOES_EXPOR_LOJA;
}

/** Idem, para linhas que carregam o escopo: só LOJA é suprimida. */
export function podeExporEstatistica(escopo: EscopoGeo, nObservacoes: number): boolean {
  return escopo !== 'loja' || podeExporLoja(nObservacoes);
}
