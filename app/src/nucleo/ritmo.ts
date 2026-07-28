/**
 * Ritmo de carregamento das telas.
 *
 * Quase tudo que as telas leem vem do SQLite local, então a promessa resolve em
 * poucos milissegundos e o esqueleto aparece por um frame só. O usuário não lê
 * isso como "carregou rápido", lê como um piscar — a tela treme e o conteúdo
 * salta. Segurando o estado de carregando por um tempo mínimo, a transição vira
 * um passo deliberado: esqueleto → conteúdo.
 *
 * Vale só para leitura local. Onde já existe latência real (SEFAZ, auth, sync)
 * não se usa piso — a espera já é a espera de verdade.
 */

/** Piso padrão de um esqueleto/spinner na tela, em ms. */
export const PISO_CARREGAMENTO = 450;

/** Piso curto, para troca de conteúdo dentro de uma tela já montada. */
export const PISO_CURTO = 260;

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve o que a tarefa devolver, mas nunca antes de `ms`. Erro da tarefa
 * continua propagando na hora — piso é para sucesso, não para segurar falha.
 */
export async function comPiso<T>(tarefa: Promise<T>, ms: number = PISO_CARREGAMENTO): Promise<T> {
  const [valor] = await Promise.all([tarefa, esperar(ms)]);
  return valor;
}

/**
 * Para efeitos com vários awaits em sequência: marque `const inicio = agora()`
 * no começo e `await completarPiso(inicio)` antes de desligar o carregando.
 * Se a sequência já demorou mais que o piso, não espera nada.
 */
export function agora(): number {
  return Date.now();
}

export async function completarPiso(inicio: number, ms: number = PISO_CARREGAMENTO): Promise<void> {
  const resta = ms - (agora() - inicio);
  if (resta > 0) await esperar(resta);
}
