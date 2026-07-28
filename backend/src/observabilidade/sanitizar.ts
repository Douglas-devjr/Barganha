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
 * QUAL DOS DOIS (C10.4):
 *  • `sanitizarErro` — erro PREVISTO (de domínio): tipo + mensagem bastam, e a
 *    pilha só faria o alerta inchar. É o caso da maioria absoluta das chamadas.
 *  • `sanitizarErroInesperado` — o que não devia acontecer: o 500, o `fatal` de
 *    boot, o job que explodiu. Traz a pilha (filtrada e redigida) e a cadeia de
 *    `cause`, porque aí não há mensagem nossa dizendo o que houve.
 *
 * Vale também para o que é PERSISTIDO como texto: `marcarFalha(cupomId, motivo)`
 * grava no banco, então o `motivo` passa por aqui antes (docs/04).
 *
 * Para inspecionar layout de portal use o esqueleto de `debug-html.ts`
 * (estrutura sem texto) — nunca a mensagem de erro.
 */

export {
  type ErroInesperado,
  type ErroSanitizado,
  redigirTexto,
  sanitizarErro,
  sanitizarErroInesperado,
} from '@barganha/shared';
