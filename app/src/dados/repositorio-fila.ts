/**
 * C5.3 — Fila de upload de QRs pendentes (docs/05; lógica de retry em C6.2).
 * Aqui ficam as operações de estado da fila; a política de backoff e o worker
 * que consome são da Camada 6.
 */

import { agoraIso } from '@/nucleo/id';

import { getBd } from './bd';
import type { ItemFilaUpload } from './tipos';

interface LinhaFila {
  cupom_local_id: string;
  tentativas: number;
  ultima_tentativa_em: string | null;
  proxima_tentativa_em: string | null;
  ultimo_erro: string | null;
  criado_em: string;
}

function mapear(l: LinhaFila): ItemFilaUpload {
  return {
    cupomLocalId: l.cupom_local_id,
    tentativas: l.tentativas,
    ultimaTentativaEm: l.ultima_tentativa_em,
    proximaTentativaEm: l.proxima_tentativa_em,
    ultimoErro: l.ultimo_erro,
    criadoEm: l.criado_em,
  };
}

/** Itens prontos para tentar (sem agendamento futuro), mais antigos primeiro. */
export async function listarPendentes(): Promise<ItemFilaUpload[]> {
  const agora = agoraIso();
  const linhas = await getBd().getAllAsync<LinhaFila>(
    `SELECT * FROM fila_upload
      WHERE proxima_tentativa_em IS NULL OR proxima_tentativa_em <= ?
      ORDER BY criado_em ASC`,
    [agora],
  );
  return linhas.map(mapear);
}

/** Registra uma tentativa falha: incrementa o contador e agenda o próximo retry. */
export async function registrarFalha(
  cupomLocalId: string,
  erro: string,
  proximaTentativaEm: string,
): Promise<void> {
  await getBd().runAsync(
    `UPDATE fila_upload
        SET tentativas = tentativas + 1, ultima_tentativa_em = ?,
            proxima_tentativa_em = ?, ultimo_erro = ?
      WHERE cupom_local_id = ?`,
    [agoraIso(), proximaTentativaEm, erro, cupomLocalId],
  );
}

/** Remove o item da fila após upload bem-sucedido. */
export async function removerDaFila(cupomLocalId: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM fila_upload WHERE cupom_local_id = ?`, [cupomLocalId]);
}

export async function contarPendentes(): Promise<number> {
  const linha = await getBd().getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM fila_upload`,
  );
  return linha?.total ?? 0;
}
