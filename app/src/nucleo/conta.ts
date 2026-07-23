/**
 * C8.2 / C4.3.1 — Limpeza local do aparelho, chamada ao SAIR (encerra a sessão)
 * e ao APAGAR a conta. Apaga TODO o estado local: histórico privado (cupons +
 * itens), fila de upload, cache de estatísticas, preferências do usuário (lista
 * de compras, alertas de preço), o feed de notificações e o cursor de sync.
 *
 * PRESERVA o consentimento LGPD (`consentimento_em`): ele registra que ESTE
 * aparelho já aceitou a política de privacidade (gate de onboarding), não é dado
 * pessoal e não pertence à conta. Apagá-lo forçava o usuário a reconsentir a
 * cada logout — atrito sem ganho. A sessão de auth (chaves `auth:` em meta_sync)
 * NÃO é preservada: cai junto na limpeza (além do signOut do supabase-js).
 *
 * LGPD (docs/04): isto remove apenas o lado PRIVADO local. O dado de login mora
 * no Supabase Auth (encerrado pelo signOut, ou apagado pelo DELETE /conta). As
 * observações de preço já enviadas ao pool são ANÔNIMAS e soltas (sem usuário,
 * sem chave de acesso) — não são "suas" nem reidentificáveis; nada a apagar lá.
 */

import { fila, getBd, meta } from '@/dados';

import { processarFilaUpload } from './sincronizador';

/**
 * Última tentativa de subir os cupons ainda na fila, ANTES de a limpeza do
 * logout apagá-los. Devolve quantos NÃO conseguiram subir (0 = nada se perdeu).
 *
 * Existe porque `redefinirAppLocal` limpa `fila_upload` junto com o resto — o
 * que é correto para privacidade (o QR cru é do usuário que escaneou), mas
 * silenciosamente jogava fora compras registradas offline se o logout viesse
 * antes do próximo sync. Agora o app tenta enviá-las e, se não der (sem sinal),
 * a tela avisa quantas serão perdidas e deixa a decisão com o usuário.
 *
 * Best-effort: sem rede, `processarFilaUpload` só reagenda e a contagem volta
 * diferente de zero — nada aqui lança.
 */
export async function enviarPendentesAntesDeSair(): Promise<number> {
  try {
    if ((await fila.contarPendentes()) === 0) return 0;
    await processarFilaUpload();
    return await fila.contarPendentes();
  } catch {
    // Offline/erro: reporta o que ainda está lá, sem quebrar o logout.
    try {
      return await fila.contarPendentes();
    } catch {
      return 0;
    }
  }
}

export async function redefinirAppLocal(): Promise<void> {
  const db = getBd();
  await db.withExclusiveTransactionAsync(async (txn) => {
    // item_cupom_local e fila_upload sairiam em cascata com cupom_local, mas
    // limpamos explicitamente — independe do PRAGMA foreign_keys e deixa claro
    // o que é removido.
    await txn.execAsync(`
      DELETE FROM item_cupom_local;
      DELETE FROM fila_upload;
      DELETE FROM cupom_local;
      DELETE FROM cache_estatistica;
      -- Preferências e derivados do usuário: sem isto a próxima conta neste
      -- aparelho herdaria a lista, os alertas e os avisos da anterior.
      DELETE FROM lista_compras;
      DELETE FROM alerta_preco;
      DELETE FROM notificacao;
    `);
    // meta_sync: limpa tudo (cursor de sync, sessão de auth) MENOS o consentimento.
    await txn.runAsync(`DELETE FROM meta_sync WHERE chave <> ?`, [meta.CHAVE_CONSENTIMENTO]);
  });
}
