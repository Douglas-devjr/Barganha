/**
 * C10.4 — As sondas concretas do health check (ver `saude.ts` para os estados).
 *
 * Cada sonda recebe a menor porta possível — uma função, um `Pick<>` — em vez do
 * serviço inteiro. Isso as deixa testáveis sem Supabase e deixa explícito, no
 * tipo, o quanto do sistema o health check realmente toca.
 */

import type { Rollout } from '../rollout/controle-rollout';
import { sanitizarErro } from './sanitizar';
import type { Sonda } from './saude';
import type { FonteMetricas } from './telemetria';

/** Erro do PostgREST/Postgres, só o que importa para classificar. */
interface ErroBanco {
  message: string;
  code?: string;
}

/**
 * Códigos que significam ESQUEMA fora de sincronia: a migração não rodou, ou
 * este código espera uma coluna/função que o banco não tem. É a falha que o
 * rollback resolve — daí ela ser `falho` e derrubar o deploy.
 *
 *  42P01 relação inexistente · 42703 coluna inexistente · 42883 função inexistente
 *  PGRST202 função ausente do cache · PGRST204/205 coluna/tabela ausentes do cache
 */
const CODIGOS_ESQUEMA = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

/**
 * Banco alcançável E com o esquema que esta versão espera.
 *
 * A consulta é de propósito a mais barata possível (uma linha, por índice
 * primário): esta sonda roda a cada janela de cache, para sempre.
 */
export function sondaBanco(
  consultar: () => PromiseLike<{ error: ErroBanco | null }>,
  nome = 'banco',
): Sonda {
  return {
    nome,
    critica: true,
    async verificar() {
      try {
        const { error } = await consultar();
        if (!error) return { estado: 'ok' };
        if (error.code && CODIGOS_ESQUEMA.has(error.code)) {
          return { estado: 'falho', detalhe: `esquema fora de sincronia (${error.code})` };
        }
        // Rede, timeout, 5xx do Supabase: transitório. Reverter o deploy não
        // levantaria o banco de volta — e ainda travaria a subida do hotfix.
        return { estado: 'degradado', detalhe: sanitizarErro(new Error(error.message)).mensagem };
      } catch (erro) {
        return { estado: 'degradado', detalhe: sanitizarErro(erro).mensagem };
      }
    },
  };
}

/**
 * A telemetria está conseguindo gravar? Sem esta sonda, `/metricas` seguiria
 * exibindo os contadores da memória — com cara de saudável — enquanto o
 * histórico durável não recebia nada (ver `telemetria-persistente.ts`).
 *
 * Não crítica: perder o histórico dói, mas o serviço atende o usuário.
 */
export function sondaTelemetria(fonte: FonteMetricas): Sonda {
  return {
    nome: 'telemetria',
    critica: false,
    verificar() {
      const saude = fonte.snapshot().saude;
      if (!saude || saude.falhasPersistencia === 0) return Promise.resolve({ estado: 'ok' });
      return Promise.resolve({
        estado: 'degradado',
        detalhe: `${saude.falhasPersistencia} gravação(ões) perdida(s); última: ${saude.ultimaFalhaMotivo ?? 'motivo não registrado'}`,
      });
    },
  };
}

export interface EstadoFila {
  /** Tarefas aguardando um consumidor. */
  pendentes: number;
  /** Tarefas sendo processadas agora (≤ concorrência). */
  emCurso: number;
}

/**
 * Fila represada. A fila é in-process (C2.1), então acúmulo aqui significa que
 * os portais da SEFAZ estão lentos ou que o worker travou — e o cupom do usuário
 * está parado em "Processando" sem que nada no log diga isso.
 *
 * Não crítica: represamento é transitório por natureza e a fila drena sozinha.
 */
export function sondaFila(fonte: () => EstadoFila, limiarPendentes = 50): Sonda {
  return {
    nome: 'fila',
    critica: false,
    verificar() {
      const { pendentes, emCurso } = fonte();
      if (pendentes <= limiarPendentes) return Promise.resolve({ estado: 'ok' });
      return Promise.resolve({
        estado: 'degradado',
        detalhe: `${pendentes} tarefas represadas (${emCurso} em curso, limiar ${limiarPendentes})`,
      });
    },
  };
}

/**
 * Toda UF habilitada tem parser?
 *
 * Esta é a checagem que justifica o gate de deploy existir. `UFS_HABILITADAS`
 * mora no ambiente e os parsers moram no código: subir uma versão que removeu um
 * parser, ou ligar uma UF sem parser, faz TODO cupom daquele estado cair em
 * `sem_parser` — silenciosamente, porque o cupom só fica represado. Aqui isso
 * vira `falho` e o deploy não passa.
 */
export function sondaParsers(rollout: Rollout, suporta: (uf: string) => boolean): Sonda {
  return {
    nome: 'parsers',
    critica: true,
    verificar() {
      const orfas = rollout.ufs().filter((uf) => !suporta(uf));
      if (orfas.length === 0) return Promise.resolve({ estado: 'ok' });
      return Promise.resolve({
        estado: 'falho',
        detalhe: `UF habilitada sem parser: ${orfas.join(', ')}`,
      });
    },
  };
}
