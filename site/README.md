# Site do Barganha (C10.0 / C9.4)

Páginas estáticas exigidas pela Google Play — política de privacidade (C9.4) e
exclusão de conta — mais um índice que serve de "site oficial" na ficha da loja.
Sem dependências, tema claro/escuro automático.

Junto delas vive **`auth-callback.html`**, que não é página legal e sim
**funcional**: é a ponte que faz os links de e-mail de autenticação abrirem o app
(confirmação de cadastro e recuperação de senha). O navegador do celular recusa
abrir o esquema `barganha://` vindo do redirect do Supabase, então o e-mail aponta
para esta página HTTPS, que repassa o `?code=` ao app com um toque. É a única com
JS. **Sem ela publicada, ninguém confirma cadastro nem recupera senha** — ver
`docs/19-ambientes-e-endurecimento.md` §5.

## Antes de publicar (obrigatório)

1. Preencher os campos `[a preencher]` (destacados em amarelo nas páginas):
   **responsável/razão social** e **e-mail do encarregado (DPO)** — em
   `politica-de-privacidade.html` e `exclusao-de-conta.html`. Manter o texto em
   sincronia com `docs/politica-de-privacidade.md`.
2. Revisão jurídica do texto (nota em `docs/politica-de-privacidade.md`).
3. Cadastrar a URL da ponte (`.../auth-callback.html`) nas **Redirect URLs** do
   Supabase (Authentication → URL Configuration), mantendo também
   `barganha://auth-callback` — usado pelo login com Google.

## Publicar no GitHub Pages (R$ 0)

O repositório principal é **privado** e o GitHub Pages gratuito só publica de
repositório **público** — por isso estas páginas vão num repo público separado,
só com este conteúdo: **`Douglas-devjr/barganha-legal`** (já criado, Pages ligado
em `main` / raiz).

Publicar = rodar, da raiz do projeto:

```powershell
npm run publicar:site
```

O script (`scripts/publicar-site.ps1`) clona o repo público, **espelha** este
diretório (menos este `README.md`, que é interno), commita, empurra e só termina
quando a build do Pages responde 200 em todas as páginas. Se nada mudou, não
commita nada. Opções:

- `-Simular` — mostra o que mudaria, sem empurrar.
- `-Mensagem "docs: ..."` — mensagem do commit (default: `docs: atualiza as paginas legais`).
- `-SemEsperar` — não aguarda a build do Pages.

> Só é preciso `gh auth login` uma vez. Se o `gh` estiver com
> `git_protocol = ssh` e a conta não tiver chave pública, o push por SSH falha —
> o script força a URL HTTPS justamente por isso.

URLs em produção (colar na ficha da Play, ver `docs/14-conformidade-play-store.md`):

- Site: `https://douglas-devjr.github.io/barganha-legal/`
- Política: `https://douglas-devjr.github.io/barganha-legal/politica-de-privacidade.html`
- Exclusão de conta: `https://douglas-devjr.github.io/barganha-legal/exclusao-de-conta.html`
- Ponte de auth (não vai na ficha da Play):
  `https://douglas-devjr.github.io/barganha-legal/auth-callback.html`
  — é o default de `obterUrlCallbackEmail()` em `app/src/auth/config.ts`. Se a URL
  mudar (domínio próprio), ajuste lá ou via `EXPO_PUBLIC_AUTH_EMAIL_REDIRECT`.

## Atualizar depois

Editar os arquivos AQUI — esta é a fonte da verdade, versionada com o produto — e
rodar `npm run publicar:site` de novo. O repo público é derivado: nunca edite
nada por lá, porque o próximo espelhamento sobrescreve.
