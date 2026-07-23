/**
 * C10.2 — Sanitização de tudo que vai para log (e para o `motivo` de falha
 * persistido no cupom).
 *
 * A IMPLEMENTAÇÃO vive em `@barganha/shared` (`observabilidade/redacao`) porque
 * o app precisa exatamente da mesma regra: um controle de privacidade duplicado
 * em dois workspaces diverge, e o lado esquecido vira o vazamento. Este módulo
 * é só o ponto de entrada do backend — mantido para o import ficar curto e para
 * haver um lugar óbvio onde documentar a REGRA DE USO:
 *
 *   NENHUM erro vai ao log cru. Sempre `sanitizarErro(erro)`.
 *
 * Vale também para o que é PERSISTIDO como texto: `marcarFalha(cupomId, motivo)`
 * grava no banco, então o `motivo` passa por aqui antes (docs/04).
 *
 * Para inspecionar layout de portal use o esqueleto de `debug-html.ts`
 * (estrutura sem texto) — nunca a mensagem de erro.
 */

export { type ErroSanitizado, redigirTexto, sanitizarErro } from '@barganha/shared';
