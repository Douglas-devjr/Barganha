/**
 * Feed de notificações LOCAL (redesign 3a). Guarda os avisos que hoje só
 * existiam em memória (alerta de preço disparado, selo desbloqueado, resumo do
 * mês) como eventos com estado de leitura.
 *
 * Privado por natureza (docs/04): o feed vive só neste aparelho, como o alerta
 * que o origina — nada viaja para o servidor, nada encosta no pool anônimo.
 *
 * A idempotência é o ponto delicado: `verificarAlertas()` roda a cada foco do
 * Início, então o MESMO disparo reaparece o tempo todo. Toda escrita passa por
 * `registrar()`, que ignora o evento se a `chaveDedupe` já existir — quem chama
 * monta a chave com o bucket de tempo certo (ver `nucleo/notificacoes.ts`).
 */

import { getBd } from './bd';

export type TipoNotificacao = 'preco_baixou' | 'conquista' | 'resumo_mes';

export interface Notificacao {
  id: string;
  tipo: TipoNotificacao;
  chaveDedupe: string;
  titulo: string;
  subtitulo?: string;
  produtoCanonicoId?: string;
  criadoEm: string;
  /** `undefined` enquanto não lida. */
  lidaEm?: string;
}

export interface NovaNotificacao {
  tipo: TipoNotificacao;
  /** Idempotência: o mesmo evento nunca vira duas linhas. */
  chaveDedupe: string;
  titulo: string;
  subtitulo?: string;
  produtoCanonicoId?: string;
  /** Padrão: agora. Explícito nos testes. */
  criadoEm?: string;
}

interface LinhaNotificacao {
  id: string;
  tipo: string;
  chave_dedupe: string;
  titulo: string;
  subtitulo: string | null;
  produto_canonico_id: string | null;
  criado_em: string;
  lida_em: string | null;
}

function mapear(l: LinhaNotificacao): Notificacao {
  return {
    id: l.id,
    tipo: l.tipo as TipoNotificacao,
    chaveDedupe: l.chave_dedupe,
    titulo: l.titulo,
    ...(l.subtitulo != null ? { subtitulo: l.subtitulo } : {}),
    ...(l.produto_canonico_id != null ? { produtoCanonicoId: l.produto_canonico_id } : {}),
    criadoEm: l.criado_em,
    ...(l.lida_em != null ? { lidaEm: l.lida_em } : {}),
  };
}

/**
 * Grava o evento se ele ainda não existe. Devolve `true` quando algo novo
 * entrou no feed — útil para decidir se vale mostrar o ponto de não-lida.
 */
export async function registrar(nova: NovaNotificacao): Promise<boolean> {
  const resultado = await getBd().runAsync(
    `INSERT INTO notificacao
       (id, tipo, chave_dedupe, titulo, subtitulo, produto_canonico_id, criado_em, lida_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (chave_dedupe) DO NOTHING`,
    [
      // id derivado da chave: o mesmo evento tem sempre a mesma linha.
      `ntf_${nova.chaveDedupe}`,
      nova.tipo,
      nova.chaveDedupe,
      nova.titulo,
      nova.subtitulo ?? null,
      nova.produtoCanonicoId ?? null,
      nova.criadoEm ?? new Date().toISOString(),
    ],
  );
  return resultado.changes > 0;
}

export async function listar(limite = 50): Promise<Notificacao[]> {
  const linhas = await getBd().getAllAsync<LinhaNotificacao>(
    `SELECT * FROM notificacao ORDER BY criado_em DESC LIMIT ?`,
    [limite],
  );
  return linhas.map(mapear);
}

/** Quantas não-lidas — alimenta o ponto no sino do header (handoff 3a). */
export async function contarNaoLidas(): Promise<number> {
  const linha = await getBd().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notificacao WHERE lida_em IS NULL`,
  );
  return linha?.n ?? 0;
}

/** "Marcar lidas" do header: zera os pontos de uma vez. */
export async function marcarTodasLidas(): Promise<void> {
  await getBd().runAsync(`UPDATE notificacao SET lida_em = ? WHERE lida_em IS NULL`, [
    new Date().toISOString(),
  ]);
}

export async function marcarLida(id: string): Promise<void> {
  await getBd().runAsync(`UPDATE notificacao SET lida_em = ? WHERE id = ? AND lida_em IS NULL`, [
    new Date().toISOString(),
    id,
  ]);
}

/**
 * Poda o feed, mantendo as `manter` mais recentes. O feed é derivado — não é
 * histórico de valor — então não faz sentido crescer sem limite no aparelho.
 */
export async function podar(manter = 200): Promise<void> {
  await getBd().runAsync(
    `DELETE FROM notificacao
      WHERE id NOT IN (SELECT id FROM notificacao ORDER BY criado_em DESC LIMIT ?)`,
    [manter],
  );
}

/** Usado ao sair da conta / apagar dados locais. */
export async function limpar(): Promise<void> {
  await getBd().runAsync(`DELETE FROM notificacao`);
}
