# Política de Privacidade — Barganha

**Última atualização:** 29/06/2026 · **Versão:** 1.1

O **Barganha** ajuda você a saber, na gôndola, se um preço está bom — comparando preços de mercado por unidade (R$/kg, R$/L, R$/un) a partir de uma base **colaborativa e anônima**. Privacidade não é promessa: é como o app foi **construído**. Esta política explica, em linguagem direta, o que coletamos, o que **nunca** coletamos e quais são os seus direitos.

> Resumo em uma linha: para o **login**, guardamos só o seu **email**. O preço que entra na base coletiva é **anônimo de nascença** — não há como ligá-lo a você.

---

## 1. Quem é o responsável
O tratamento de dados é feito por **[RAZÃO SOCIAL / RESPONSÁVEL — a preencher]**, na qualidade de controlador, nos termos da **Lei nº 13.709/2018 (LGPD)**. Contato do encarregado (DPO): **[e-mail — a preencher]**.

## 2. Os dois mundos de dados
O Barganha separa estritamente dois conjuntos de dados, e eles **nunca se cruzam**:

| | **Seu histórico (privado)** | **Base de preços (compartilhada)** |
|---|---|---|
| O que é | as notas que você escaneou | observações de preço soltas |
| Identifica você? | sim (fica no escopo da sua conta) | **não** — sem usuário, sem nota, sem chave |
| Para que serve | mostrar suas compras e sua economia | calcular a faixa típica de preço da região |

## 3. O que coletamos
- **Email e senha de login** (ou sua **conta Google**, se você escolher entrar com o Google). É o **mínimo** para criar e proteger sua conta. A senha é guardada **criptografada**; nunca a vemos em texto puro. Esse dado serve **só para autenticar** — nunca entra na base de preços.
- **Conteúdo do QR Code da nota fiscal (NFC-e)** que você escaneia. Ele é processado nos nossos servidores para extrair **loja, produtos, preços e data**.
- **Dados de uso técnicos mínimos** necessários para o serviço funcionar e para evitar abuso (ex.: limites de requisição).

## 4. O que NUNCA coletamos nem guardamos
- **Seu CPF.** Mesmo quando ele aparece na nota fiscal, é **descartado no processamento** — nunca é salvo nem transmitido adiante.
- **Telefone ou outros dados de cadastro** além do email do login.
- **Seu email ou sua identidade na base de preços.** O dado de login fica isolado na sua conta; a base coletiva é anônima e não tem como ligá-la a você.
- **Sua localização por GPS de forma contínua.** O app não rastreia você.

## 5. Como a base de preços continua anônima
Quando uma nota é processada, cada item vira uma **observação de preço solta** na base coletiva. Essa observação:
- **não** tem seu identificador de usuário;
- **não** tem a chave de acesso da nota;
- **não** fica amarrada às outras compras da mesma nota.

Esse último ponto é importante: separamos os itens para que **ninguém consiga reconstruir "esta pessoa comprou estes 30 itens juntos, neste horário"** — o que poderia, em tese, identificar você. Inclusive, a data registrada é arredondada para o **dia**, não a hora.

## 6. Localização: pela loja, não por você
A região de um preço vem do **endereço da loja** (derivado do CNPJ do estabelecimento), **não** do seu celular. A "sua região" é apenas inferida das lojas onde você costuma comprar. O GPS só pode ser usado, de forma **opcional e momentânea**, para "mercados perto de mim" — sem guardar sua localização.

## 7. Por que tratamos esses dados (finalidade e base legal)
- **Finalidade:** dar o veredito de barato/na média/caro e manter seu histórico e sua conta. Nada de perfilamento ou publicidade direcionada.
- **Minimização:** coletamos apenas o necessário para isso.
- **Base legal:**
  - **Dado de login (email/senha ou Google):** execução do contrato (prover e proteger sua conta).
  - **Compartilhamento dos preços anônimos:** seu **consentimento**, coletado de forma clara no primeiro uso (onboarding).

## 8. Compartilhamento
Não vendemos seus dados. A base de preços é **coletiva e anônima** por construção — preços agregados de uma região podem ser exibidos a outros usuários, mas **nunca** de forma que identifique quem registrou. Provedores de infraestrutura (ex.: hospedagem/banco de dados) processam dados apenas para operar o serviço, sob contrato.

## 9. Retenção e apagamento
- Seu **email de login** e seu **histórico privado** ficam enquanto sua conta existir.
- A **base de preços anônima** é mantida para a comparação funcionar; como ela já não identifica ninguém, não há dado pessoal a remover nela.
- **Apagar sua conta** (no Perfil) remove sua conta de login **e** todo o seu histórico — no aparelho e no servidor. Como os dois mundos são separados, isso não quebra a base coletiva de preços.

## 10. Seus direitos (LGPD)
Você pode, a qualquer momento, solicitar: **confirmação** de tratamento, **acesso**, **correção**, **eliminação** dos seus dados, **portabilidade**, **informação** sobre compartilhamentos e **revogação do consentimento**. Para exercê-los, fale com o encarregado em **[e-mail — a preencher]**.

## 11. Segurança
Adotamos medidas técnicas para proteger os dados, incluindo a separação arquitetural entre o lado privado e o lado anônimo, descarte de identificadores no processamento e limites contra abuso.

## 12. Crianças e adolescentes
O Barganha não é direcionado a menores de idade e não coleta intencionalmente seus dados.

## 13. Alterações desta política
Podemos atualizar este texto. Mudanças relevantes serão comunicadas no app, com nova data de "última atualização".

---

> Nota interna (não publicar): este texto deriva de `docs/04-privacidade-lgpd.md` e reflete a arquitetura do produto. **Antes da publicação na loja, passar por revisão jurídica** e preencher os campos `[a preencher]` (controlador e contato do encarregado).
