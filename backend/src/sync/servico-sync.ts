/**
 * C4.2 — Serviço de delta sync.
 *
 * Traduz o `DeltaSyncRequest` (cursor + escopo do usuário) num filtro de leitura
 * e devolve o que mudou + o novo cursor.
 *
 * O cursor é OPACO para o cliente: por dentro é a posição keyset
 * `"<atualizado_em>|<seq>"` da última linha entregue. Ordenar só por
 * `atualizado_em` (como na v1) tinha um buraco real: `upsertEstatisticas`
 * carimba o mesmo instante em todo o lote, então um corte no limite de linhas
 * caía no meio de um grupo de timestamp idêntico e o resto do grupo era pulado
 * PARA SEMPRE — cache incompleto, sem erro nenhum. Com o desempate `seq` a
 * paginação é determinística.
 *
 * `temMais` diz ao cliente que a página encheu e ele deve voltar já — antes,
 * uma janela maior que o limite ficava para a próxima rodada sem ninguém saber.
 */

import type { DeltaSyncRequest, DeltaSyncResponse } from '@barganha/shared';
import { podeExporEstatistica } from '@barganha/shared';

import type { CursorDelta } from './tipos';
import type { FonteDeltaSync } from './tipos';

/** Teto de linhas por chamada. Estourou → `temMais`, e o cliente repagina. */
export const LIMITE_DELTA_SYNC = 1000;

/** Separador da posição keyset dentro do cursor opaco. */
const SEP = '|';

/**
 * Lê o cursor do cliente. Aceita o formato ANTIGO (só o ISO, sem `seq`) para
 * não invalidar o cache de quem já está instalado: sem desempate, retomamos do
 * começo daquele instante (`seq > -1`). O reenvio é inofensivo — o cliente faz
 * upsert por chave primária, então re-receber linha já vista não duplica nada.
 */
export function lerCursor(bruto: string | undefined): CursorDelta | undefined {
  if (!bruto) return undefined;
  const corte = bruto.lastIndexOf(SEP);
  if (corte < 0) return { atualizadoEm: bruto, seq: -1 };
  const seq = Number(bruto.slice(corte + 1));
  return {
    atualizadoEm: bruto.slice(0, corte),
    seq: Number.isFinite(seq) ? seq : -1,
  };
}

/** Serializa a posição keyset no cursor opaco devolvido ao cliente. */
export function escreverCursor(cursor: CursorDelta): string {
  return `${cursor.atualizadoEm}${SEP}${cursor.seq}`;
}

export class ServicoSync {
  constructor(
    private readonly fonte: FonteDeltaSync,
    private readonly limite: number = LIMITE_DELTA_SYNC,
  ) {}

  async delta(req: DeltaSyncRequest): Promise<DeltaSyncResponse> {
    const desde = lerCursor(req.cursor);
    const linhas = await this.fonte.deltaEstatisticas({
      ...(desde ? { desde } : {}),
      ...(req.municipios && req.municipios.length > 0 ? { escopoIds: req.municipios } : {}),
      ...(req.produtoCanonicoIds && req.produtoCanonicoIds.length > 0
        ? { produtoCanonicoIds: req.produtoCanonicoIds }
        : {}),
      limite: this.limite,
    });

    // Ordem garantida pela fonte → a ÚLTIMA linha é a nova posição. Página
    // vazia mantém o cursor anterior (nada mudou).
    const ultima = linhas[linhas.length - 1];
    const cursor = ultima
      ? escreverCursor({ atualizadoEm: ultima.estatistica.atualizadoEm, seq: ultima.seq })
      : (req.cursor ?? '');

    return {
      // Supressão de célula pequena (docs/04): linha de escopo LOJA abaixo do
      // piso não desce para o cache do aparelho. Filtrar DEPOIS do cursor é
      // essencial — derivar a posição da página já filtrada rebobinaria o
      // cursor para antes das linhas suprimidas e o sync repetiria a mesma
      // página para sempre. `temMais` também segue a página crua.
      estatisticas: linhas
        .map((l) => l.estatistica)
        .filter((e) => podeExporEstatistica(e.escopo, e.nObservacoes)),
      cursor,
      // Página cheia = provavelmente há mais. Um falso positivo custa uma
      // chamada vazia; um falso negativo custaria dado faltando no cache.
      ...(linhas.length >= this.limite ? { temMais: true } : {}),
    };
  }
}
