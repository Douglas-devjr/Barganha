# 04 — Privacidade & LGPD

> Princípio inegociável: **o app nunca persiste dados pessoais.** A privacidade é garantida pela **arquitetura**, não por promessa.

## Os dois mundos de dados
| | **Privado** | **Compartilhado (anônimo)** |
|---|---|---|
| Conteúdo | histórico do usuário | observações de preço |
| Entidades | `cupom`, `item_cupom` | `observacao_preco`, `preco_estatistica` |
| Identificadores | `usuario_id`, `chave_acesso` | **nenhum** |
| Onde mora | aparelho / escopo da conta | base colaborativa |
| Quem escreve | o próprio app/usuário | só a camada de anonimização |

## Regras de anonimização (aplicadas no backend, sempre)
1. **CPF é descartado no parsing.** Nunca é salvo nem transmitido. Some na fronteira de entrada.
2. **Itens entram "soltos" no pool.** Cada `observacao_preco` é independente — **não** ficam amarrados como "fulano comprou estes 30 itens juntos, neste horário". Isso quebra a *impressão digital da cesta*, que poderia re-identificar a pessoa.
3. **Chave de acesso não vai ao pool compartilhado.** Ela permite vincular a nota a um CPF via SEFAZ; fica só no lado privado.
4. **Sem vínculo usuário↔observação.** `observacao_preco` não tem `usuario_id` nem `cupom_id`.

## Princípios LGPD adotados
- **Minimização:** coletar e guardar apenas o necessário para o veredito de preço.
- **Finalidade:** dados de preço servem exclusivamente à comparação; nada de perfilamento.
- **Consentimento e transparência:** onboarding explica o que é coletado (preços anônimos) e o que nunca é (dados pessoais).
- **Direito ao apagamento:** como o lado privado é isolado e o compartilhado é anônimo, apagar a conta remove tudo que é identificável sem quebrar a base de preços.

## Autenticação e dado de login (C4.3.1)
Decisão de produto: **login obrigatório** (Supabase Auth — email/senha ou Google),
substituindo a conta anônima de C4.3. Isso introduz **um** dado pessoal — a
**credencial de login** — tratado sob regras estritas para não contaminar o resto:

- **O que é:** email (e, no login com Google, a identidade OAuth) + senha
  **criptografada**. É o **mínimo** para autenticar e proteger a conta.
- **Onde mora:** apenas no esquema gerido `auth.users` do Supabase. As tabelas de
  domínio não guardam email/senha; `usuario.id` é só o `auth.users.id` (chave).
- **Base legal:** **execução de contrato** (prover a conta e o histórico que o
  usuário pede) e **legítimo interesse** de segurança da conta — distinta do
  **consentimento** que cobre o compartilhamento dos preços anônimos.
- **Fronteira inviolável:** o dado de login **NUNCA** cruza para o pool. O `sub`
  do JWT identifica só o lado PRIVADO (ingestão). O gate de anonimização
  (`extrairObservacoesAnonimas`) continua sendo o único caminho para
  `observacao_preco`, e ele não recebe usuário, cupom nem chave.
- **Apagamento real:** `DELETE /conta` chama `auth.admin.deleteUser`, que
  cascateia (FK `usuario.id → auth.users`) para `cupom`/`item_cupom`. O pool
  anônimo não é tocado — não há dado pessoal a remover lá.
- **RLS:** as tabelas privadas (`usuario`/`cupom`/`item_cupom`) têm RLS por
  `auth.uid()` (defesa em profundidade); o backend usa service role e a ingestão
  segue funcionando.

## Geolocalização sem rastrear pessoas
- A localização vem do **endereço da loja (via CNPJ)**, não do GPS do usuário.
- A "região do usuário" é **inferida do histórico de lojas** onde ele compra — não há rastreamento contínuo.
- GPS só é usado, **opcional e transitoriamente**, para "mercados perto de mim", sem persistência.

## Checklist para qualquer feature nova (gate de revisão)
- [ ] Não introduz CPF/nome/contato em nenhuma tabela compartilhada.
- [ ] Nenhum caminho liga `observacao_preco` a um usuário ou a uma cesta.
- [ ] `chave_acesso` não cruzou para o lado compartilhado.
- [ ] O dado de **login** (email/identidade Google) não saiu de `auth.users`/lado privado.
- [ ] Coleta o mínimo necessário; há base legal/consentimento para o que coleta.
- [ ] O usuário consegue apagar seus dados (inclui apagar a conta de auth).

> Toda PR que toca dados deve passar por este checklist e pela revisão do agente **privacy-lgpd-specialist**.
