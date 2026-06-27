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
- **Conta anônima como opção** (a avaliar com produto): reduzir ao máximo o dado de cadastro.

## Geolocalização sem rastrear pessoas
- A localização vem do **endereço da loja (via CNPJ)**, não do GPS do usuário.
- A "região do usuário" é **inferida do histórico de lojas** onde ele compra — não há rastreamento contínuo.
- GPS só é usado, **opcional e transitoriamente**, para "mercados perto de mim", sem persistência.

## Checklist para qualquer feature nova (gate de revisão)
- [ ] Não introduz CPF/nome/contato em nenhuma tabela compartilhada.
- [ ] Nenhum caminho liga `observacao_preco` a um usuário ou a uma cesta.
- [ ] `chave_acesso` não cruzou para o lado compartilhado.
- [ ] Coleta o mínimo necessário; há base legal/consentimento para o que coleta.
- [ ] O usuário consegue apagar seus dados.

> Toda PR que toca dados deve passar por este checklist e pela revisão do agente **privacy-lgpd-specialist**.
