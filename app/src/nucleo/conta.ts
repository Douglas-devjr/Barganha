/**
 * C8.2 — "Sair" do Perfil: apaga TODO o estado local deste aparelho — histórico
 * privado (cupons + itens), fila de upload, cache de estatísticas e os metadados
 * (inclui a conta anônima e o consentimento LGPD).
 *
 * LGPD (docs/04): isto remove apenas o lado PRIVADO local. As observações de
 * preço já enviadas ao pool são ANÔNIMAS e soltas (sem usuário, sem chave de
 * acesso), então não são "suas" nem reidentificáveis — não há o que apagar lá.
 *
 * Após o reset, o app volta ao Onboarding; o próximo boot recria a conta anônima.
 */

import { getBd } from '@/dados';

export async function redefinirAppLocal(): Promise<void> {
  const db = getBd();
  await db.withTransactionAsync(async () => {
    // item_cupom_local e fila_upload sairiam em cascata com cupom_local, mas
    // limpamos explicitamente — independe do PRAGMA foreign_keys e deixa claro
    // o que é removido.
    await db.execAsync(`
      DELETE FROM item_cupom_local;
      DELETE FROM fila_upload;
      DELETE FROM cupom_local;
      DELETE FROM cache_estatistica;
      DELETE FROM meta_sync;
    `);
  });
}
