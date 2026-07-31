/**
 * C12.1 — Frescor do típico: "este preço ainda descreve a loja de hoje?".
 *
 * Nasceu do problema prático da comparação de mercados: o ranking soma medianas
 * por loja e elege a mais barata. Se a mediana de uma loja foi construída sobre
 * cupons de três meses atrás, ela pode ganhar o selo por um preço que não existe
 * mais — o usuário vai até lá e a conta não bate. Esse é o jeito mais fácil de o
 * app perder a confiança de quem usa, então a regra é explícita e compartilhada.
 *
 * A idade se mede pela observação MAIS RECENTE que sustenta o típico
 * (`observadoEmMaisRecente`), NUNCA por `atualizadoEm` — aquele é o carimbo do
 * recálculo e um `recalcularTodos` no deploy zera a idade de tudo.
 *
 * Ausência de data = idade DESCONHECIDA = não recente. É a leitura conservadora:
 * linhas gravadas antes da coluna existir não podem herdar um selo de confiança
 * que ninguém verificou.
 *
 * O limiar acompanha a MEIA-VIDA do decaimento temporal (30 dias, docs/06): a
 * partir dela o peso da evidência já caiu pela metade, e chamar isso de "o preço
 * daquela loja" é mais chute do que medida. A calibrar com dados reais.
 */

const DIA_MS = 86_400_000;
/** Dias por mês para converter idade em "meses" de deriva. Média do ano gregoriano. */
const DIAS_POR_MES = 30.44;

/** Idade máxima (dias) do típico para ele valer como retrato atual da loja. */
export const MAX_IDADE_TIPICO_DIAS = 30;

/**
 * Janela da agregação: observação mais velha que isto é DESCARTADA pelo motor
 * estatístico (`DECAIMENTO.maxIdadeDias`, docs/06).
 *
 * Vive aqui, e não só no backend, porque o app precisa do mesmo número: além
 * desta idade o servidor não considera a observação um dado válido, então o app
 * não pode seguir opinando sobre ela — seria estar mais confiante que o motor que
 * produziu o número. Enquanto a constante era só do backend, o app não tinha como
 * saber onde ficava essa fronteira.
 */
export const MAX_IDADE_OBSERVACAO_DIAS = 180;

/**
 * Idade em dias (fracionária) de uma observação. `undefined` quando não há data
 * ou ela é inválida — o chamador decide o que fazer, mas nunca pode tratar isso
 * como zero.
 */
export function idadeEmDias(observadoEm: string | undefined, referencia: Date): number | undefined {
  if (!observadoEm) return undefined;
  const ms = Date.parse(observadoEm);
  if (Number.isNaN(ms)) return undefined;
  return Math.max(0, (referencia.getTime() - ms) / DIA_MS);
}

/**
 * `true` só quando existe data E ela cabe na janela. Data ausente/inválida →
 * `false` (ver cabeçalho: desconhecido não é recente).
 */
export function dadoRecente(
  observadoEm: string | undefined,
  referencia: Date,
  maxIdadeDias: number = MAX_IDADE_TIPICO_DIAS,
): boolean {
  const idade = idadeEmDias(observadoEm, referencia);
  return idade != null && idade <= maxIdadeDias;
}

/** Idade em meses (fracionária). `undefined` quando a data é ausente/inválida. */
export function idadeEmMeses(
  observadoEm: string | undefined,
  referencia: Date,
): number | undefined {
  const dias = idadeEmDias(observadoEm, referencia);
  return dias == null ? undefined : dias / DIAS_POR_MES;
}

/**
 * `true` quando o dado passou da JANELA DA AGREGAÇÃO — não é "velho", é dado que
 * o próprio motor já teria descartado. Ausência de data não conta como fora da
 * janela: desconhecido não é o mesmo que expirado (para isso existe `dadoRecente`).
 */
export function foraDaJanela(observadoEm: string | undefined, referencia: Date): boolean {
  const idade = idadeEmDias(observadoEm, referencia);
  return idade != null && idade > MAX_IDADE_OBSERVACAO_DIAS;
}
