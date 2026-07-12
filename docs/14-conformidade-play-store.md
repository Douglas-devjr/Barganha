# 14 — Conformidade Google Play (C10.0)

Checklist e respostas prontas para a ficha da Play Store. Complementa
`13-lancamento-operacao.md` (C10.1) e `04-privacidade-lgpd.md`. *Responsáveis:*
privacy-lgpd-specialist, devops-engineer, product-manager.

> **Gate de pagamento:** o único custo desta camada é a conta de desenvolvedor
> (US$ 25, único) — pagar apenas ao iniciar o beta (Fase 3). Todo o resto é R$ 0.

---

## C10.0.1 — Política de privacidade publicada (C9.4)

- Fonte: `docs/politica-de-privacidade.md` → página em `site/politica-de-privacidade.html`.
- Publicação: repo público `barganha-legal` + GitHub Pages (passo a passo em `site/README.md`).
- **Antes de publicar:** preencher responsável/razão social e e-mail do DPO
  (campos `[a preencher]`) e fazer a revisão jurídica.
- Onde colar a URL: Play Console → *Política do app* → *Política de Privacidade*.

## C10.0.2 — Exclusão de conta (exigência para apps com criação de conta)

- **No app:** Perfil → “Apagar conta” (`DELETE /conta`, cascata no servidor) — já implementado (C4.3.1).
- **Na web:** `site/exclusao-de-conta.html` (mesmo repo público).
- Onde colar a URL: Play Console → *Política do app* → *Exclusão de conta* →
  “URL para solicitar a exclusão da conta”.

## C10.0.3 — Formulário Data Safety (respostas propostas)

> Racional completo em `04-privacidade-lgpd.md`. Revisar a cada feature nova que
> toque dados (gate do privacy-lgpd-specialist).

**O app coleta ou compartilha dados do usuário?** Coleta: **sim**. Compartilha: **não**
(estatísticas exibidas a outros usuários são agregadas e anonimizadas — fora do
escopo do formulário; provedores de infraestrutura são "service providers", não sharing).

| Categoria | Item | Coletado? | Compartilhado? | Observações |
|---|---|---|---|---|
| Informações pessoais | Endereço de e-mail | **Sim** | Não | Login (obrigatório). Finalidade: *gerenciamento da conta*. Efêmero: não. Exclusão: sim (in-app + web). |
| Informações financeiras | Histórico de compras | **Sim** | Não | Cupons escaneados (histórico privado). Finalidade: *funcionalidade do app*. Opcional: sim (só se escanear). Exclusão: sim. |
| Localização | Precisa/Aproximada | **Não** | — | A região vem da **loja** (CNPJ) e de **escolha manual** de município — nunca do dispositivo. |
| Fotos e vídeos | Fotos | **Não** | — | A câmera lê o QR/código de barras **no aparelho**; nenhuma imagem é armazenada ou enviada. |
| Identificadores | ID do dispositivo | **Não** | — | Não coletamos device ID/advertising ID. |

**Práticas de segurança:** dados criptografados em trânsito (HTTPS) — **sim**;
o usuário pode solicitar exclusão — **sim**.

Pontos de atenção (julgamentos documentados):
- **IP no rate-limit:** processado em memória, janela curta, nunca persistido →
  tratado como processamento efêmero, não declarado como coleta. Se um dia o IP
  for logado/persistido, redeclarar.
- **QR da nota:** contém a chave de acesso do cupom (dado do usuário); vira
  "histórico de compras" na tabela acima. O CPF, quando presente na nota, é
  **descartado no parsing** e nunca persistido (decisão travada nº 3).

## C10.0.4 — Target API 36 (Android 16) ✅ código pronto (validar no device)

- Exigência: a partir de **31/08/2026**, apps novos devem mirar **API 36**.
- Feito em 11/07/2026: upgrade **Expo SDK 52 → 54** (React 19.1, RN 0.81,
  target API 36), typecheck e `expo-doctor` verdes.
- **Pendente no device físico** (exige novo **dev build** EAS — o binário antigo
  não abre o JS novo): câmera (`expo-camera` 17 — hook `useCameraAtiva`, tela
  preta no Android) e WebView do coletor (C2.6).

## C10.0.5 — Classificação de conteúdo e ficha

- **Questionário de classificação:** app utilitário/compras; sem violência,
  apostas, conteúdo sexual, drogas ou interação social entre usuários → tende a
  **Livre (L)**. Sem loot boxes/compras no app no MVP.
- **Categoria da ficha:** Compras (ou Ferramentas). Site: usar a URL do
  GitHub Pages. E-mail de contato: o mesmo do DPO.
- **Anúncios:** o app não exibe anúncios → declarar "não contém anúncios".

## Checklist de saída da Fase 2

- [ ] Campos `[a preencher]` preenchidos (responsável + e-mail DPO) nas páginas e no MD.
- [ ] Revisão jurídica da política.
- [ ] Repo público `barganha-legal` criado e Pages ativo (URLs no ar).
- [ ] Upgrade Expo SDK 54+ (target API 36) planejado/feito antes do build de produção.
- [ ] (Na Fase 3) Conta de desenvolvedor criada → colar URLs + Data Safety + classificação.
