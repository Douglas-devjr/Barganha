/**
 * C10.2 — Log estruturado do APP.
 *
 * POR QUE NÃO PINO AQUI: o React Native não tem as streams do Node em que o Pino
 * se apoia. O backend usa Pino (ver `backend/src/observabilidade/log.ts`); aqui a
 * saída é o console do Metro/logcat, então o que importa é a DISCIPLINA — mesmos
 * níveis, mesmos campos, mesma máscara — e não a biblioteca.
 *
 * A máscara é a MESMA do backend (`@barganha/shared`), não uma cópia: divergir a
 * regra de redação entre os dois lados é como o vazamento aparece.
 *
 * SILENCIOSO EM RELEASE. Em produção o log iria para o logcat do aparelho do
 * usuário, onde não serve para diagnóstico nosso e ainda é superfície de
 * exposição. O que precisa sobreviver a um release é CONTADO (ver
 * `contarFalha`), não escrito.
 *
 * NÍVEIS (iguais aos do backend):
 *  • `info`  — marco: sync concluído, sessão restaurada.
 *  • `warn`  — degradação com recuperação automática: rodada de sync falhou.
 *  • `error` — o usuário foi afetado e não há recuperação sozinha.
 */

import { sanitizarErro } from '@barganha/shared';

type Nivel = 'info' | 'warn' | 'error';

/** Campos de contexto de uma linha. `action` é obrigatório — log sem ação não se filtra. */
export interface ContextoLog {
  action: string;
  [campo: string]: unknown;
}

function emitir(nivel: Nivel, contexto: ContextoLog, mensagem: string): void {
  if (!__DEV__) return;
  // Uma linha, com os campos ao lado — mesma forma do JSON do backend, para
  // quem lê os dois não precisar trocar de cabeça.
  const saida = { nivel, ...contexto, mensagem };
  if (nivel === 'error') console.error('[barganha]', saida);
  else if (nivel === 'warn') console.warn('[barganha]', saida);
  else console.log('[barganha]', saida);
}

export const log = {
  info: (contexto: ContextoLog, mensagem: string) => emitir('info', contexto, mensagem),
  warn: (contexto: ContextoLog, mensagem: string) => emitir('warn', contexto, mensagem),
  error: (contexto: ContextoLog, mensagem: string) => emitir('error', contexto, mensagem),
  /** Atalho para o caso mais comum: logar um erro capturado, já sanitizado. */
  falha: (nivel: Nivel, contexto: ContextoLog, erro: unknown, mensagem: string) =>
    emitir(nivel, { ...contexto, erro: sanitizarErro(erro) }, mensagem),
};

// ── Contadores de falha que sobrevivem ao release ─────────────────────────

/**
 * Falhas consecutivas por operação.
 *
 * O PROBLEMA QUE ISTO RESOLVE: um `catch {}` mudo torna um bug PERMANENTE
 * (contrato quebrado, migração divergente, 400 do servidor) indistinguível de
 * "está offline" — para sempre, e sem sinal nenhum. A diferença entre os dois
 * não está numa falha isolada, está na PERSISTÊNCIA dela: offline se resolve,
 * bug não. Contar consecutivas é o que separa um do outro sem precisar de
 * telemetria remota (que o projeto não tem, e que custaria dinheiro — ver o
 * orçamento de lançamento).
 */
const falhasConsecutivas = new Map<string, number>();

/** A partir daqui não é mais "sem sinal" — é algo quebrado. */
const LIMIAR_SUSPEITA = 5;

/**
 * Conta uma falha e devolve quantas seguidas já são. Ao cruzar o limiar, sobe
 * de `warn` para `error` — o mesmo evento muda de nível quando vira padrão.
 */
export function contarFalha(operacao: string, erro: unknown): number {
  const n = (falhasConsecutivas.get(operacao) ?? 0) + 1;
  falhasConsecutivas.set(operacao, n);
  log.falha(
    n >= LIMIAR_SUSPEITA ? 'error' : 'warn',
    { action: operacao, falhasConsecutivas: n },
    erro,
    n >= LIMIAR_SUSPEITA
      ? 'Falhas seguidas demais — provavelmente não é falta de sinal'
      : 'Falhou; a próxima rodada tenta de novo',
  );
  return n;
}

/** Zera o contador de uma operação que voltou a funcionar. */
export function limparFalhas(operacao: string): void {
  if (!falhasConsecutivas.has(operacao)) return;
  const anterior = falhasConsecutivas.get(operacao) ?? 0;
  falhasConsecutivas.delete(operacao);
  if (anterior >= LIMIAR_SUSPEITA) {
    log.info({ action: operacao, apos: anterior }, 'Operação voltou a funcionar');
  }
}

/** Leitura dos contadores — para a tela de diagnóstico/suporte, se um dia houver. */
export function falhasAtuais(): Record<string, number> {
  return Object.fromEntries(falhasConsecutivas);
}
