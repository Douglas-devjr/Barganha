/**
 * C7.6 — "que produtos eu posso pôr na lista?" com DUAS fontes, não uma.
 *
 * Até aqui a resposta vinha só do catálogo local (o que o usuário já comprou),
 * e por isso uma conta nova — zero cupom — encontrava um app vazio (docs/20). A
 * segunda fonte é o catálogo REGIONAL: o pool anônimo, no recorte de região do
 * usuário, consultado sob demanda.
 *
 * Divisão de trabalho, na ordem em que a UI precisa:
 *   • `filtrarLocais` é SÍNCRONO e responde no teclado (offline, sempre);
 *   • `buscarNaRegiao` é online e best-effort — sem sinal devolve vazio, nunca
 *     erro: o que existe offline continua na tela;
 *   • `mesclar` junta os dois com o histórico na frente.
 *
 * Este arquivo é só o I/O; as conversões e a mesclagem são puras e vivem em
 * `busca-produtos-regras.ts` (mesmo par de `alertas`/`alertas-regras`).
 */

import { clienteApi, ErroApi } from '@/api';

import { comNome, doPool, type ProdutoBuscavel } from './busca-produtos-regras';
import { resolverLocalizacao } from './localizacao';

export {
  comparaveis,
  deLocal,
  filtrarLocais,
  filtrarPorNome,
  mesclar,
} from './busca-produtos-regras';
export type { OrigemProduto, ProdutoBuscavel } from './busca-produtos-regras';

/** Mínimo de caracteres para consultar a rede (evita bater a cada tecla). */
export const MIN_CARACTERES_BUSCA = 2;

/** Teto de resultados do pool por busca — a UI não rola cem itens. */
const LIMITE_REGIAO = 20;

/**
 * Catálogo da região (C4.4). Sem termo, traz os populares — é o que preenche a
 * tela de quem nunca comprou nada. Devolve `[]` quando não há região escolhida,
 * quando não há sinal ou quando a região ainda não tem preço: nenhum desses
 * casos é erro para a UI.
 */
export async function buscarNaRegiao(termo = ''): Promise<ProdutoBuscavel[]> {
  const limpo = termo.trim();
  if (limpo.length > 0 && limpo.length < MIN_CARACTERES_BUSCA) return [];

  const local = await resolverLocalizacao();
  if (!local) return [];

  try {
    const r = await clienteApi.buscarProdutos({
      ...(limpo ? { termo: limpo } : {}),
      ...(local.municipio ? { municipio: local.municipio } : {}),
      uf: local.uf,
      limite: LIMITE_REGIAO,
    });
    return comNome(r.produtos.map(doPool));
  } catch (e) {
    if (e instanceof ErroApi) return []; // offline ou sem dado — a UI segue local.
    throw e;
  }
}
