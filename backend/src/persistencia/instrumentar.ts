/**
 * C10.4 — Cronômetro de TODO acesso ao banco.
 *
 * POR QUE UM PROXY E NÃO `Date.now()` EM CADA MÉTODO: o `RepositorioSupabase`
 * implementa treze interfaces e passa de quarenta métodos. Instrumentar um a um
 * seria quarenta chances de esquecer — e o método esquecido é justamente o que
 * ninguém olha, ou seja, o candidato natural a ser o lento. O proxy cobre
 * todos, inclusive os que forem escritos amanhã, sem uma linha a mais.
 *
 * O nome do método vira a chave da métrica (`obterDoUsuario`, `marcarProcessado`),
 * o que dá cardinalidade fixa e estável — nada de id de cupom no nome.
 *
 * O que ele NÃO faz, deliberadamente: não engole erro, não altera resultado, não
 * loga. Ele cronometra e sai do caminho. Um instrumento que muda o comportamento
 * do que mede deixa de ser instrumento.
 */

import type { Metricas } from '../observabilidade/metricas';

/** Só o que retorna promessa é cronometrado — ver nota em `envolver`. */
const ehPromessa = (v: unknown): v is PromiseLike<unknown> =>
  typeof (v as { then?: unknown } | null)?.then === 'function';

/**
 * Devolve um proxy que cronometra cada método assíncrono de `alvo`.
 *
 * O tipo de retorno é o mesmo do alvo, então quem consome não percebe diferença
 * — é a propriedade que permite instrumentar na raiz de composição sem que uma
 * única assinatura do domínio mude.
 */
export function instrumentarRepositorio<T extends object>(alvo: T, metricas: Metricas): T {
  // Métodos já envolvidos ficam guardados: sem isto, cada acesso a `repo.metodo`
  // criaria uma função nova, e comparações por identidade (ou um `.bind` guardado
  // por alguém) passariam a se comportar de forma diferente do objeto original.
  const memo = new Map<string, unknown>();

  return new Proxy(alvo, {
    get(objeto, propriedade, receptor) {
      const valor = Reflect.get(objeto, propriedade, receptor) as unknown;
      if (typeof valor !== 'function' || typeof propriedade !== 'string') return valor;

      const guardado = memo.get(propriedade);
      if (guardado) return guardado;

      const envolvido = envolver(valor as (...args: unknown[]) => unknown, propriedade, objeto);
      memo.set(propriedade, envolvido);
      return envolvido;
    },
  });

  function envolver(metodo: (...args: unknown[]) => unknown, nome: string, dono: object) {
    return function (this: unknown, ...args: unknown[]): unknown {
      const inicio = Date.now();
      // `dono` e não `this`: o método precisa enxergar os campos privados do
      // objeto REAL. Chamado com o proxy, cada acesso interno a `this.db` voltaria
      // pelo trap acima — funcionaria, mas envolveria também o cliente Supabase.
      let resultado: unknown;
      try {
        resultado = metodo.apply(dono, args);
      } catch (erro) {
        // Método síncrono que lançou: registra e RELANÇA sem tocar no erro.
        metricas.observarBanco(nome, Date.now() - inicio, false);
        throw erro;
      }

      // Método síncrono (getters, helpers): nada a cronometrar de verdade — o
      // custo de banco está sempre atrás de uma promessa.
      if (!ehPromessa(resultado)) return resultado;

      return Promise.resolve(resultado).then(
        (valor) => {
          metricas.observarBanco(nome, Date.now() - inicio, true);
          return valor;
        },
        (erro: unknown) => {
          // Conta a falha e propaga intacta: quem chama continua vendo o mesmo
          // erro que veria sem instrumentação.
          metricas.observarBanco(nome, Date.now() - inicio, false);
          throw erro;
        },
      );
    };
  }
}
