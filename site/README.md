# Site legal do Barganha (C10.0 / C9.4)

Páginas estáticas exigidas pela Google Play — política de privacidade (C9.4) e
exclusão de conta — mais um índice que serve de "site oficial" na ficha da loja.
Sem JS, sem dependências, tema claro/escuro automático.

## Antes de publicar (obrigatório)

1. Preencher os campos `[a preencher]` (destacados em amarelo nas páginas):
   **responsável/razão social** e **e-mail do encarregado (DPO)** — em
   `politica-de-privacidade.html` e `exclusao-de-conta.html`. Manter o texto em
   sincronia com `docs/politica-de-privacidade.md`.
2. Revisão jurídica do texto (nota em `docs/politica-de-privacidade.md`).

## Publicar no GitHub Pages (R$ 0)

O repositório principal é **privado** e o GitHub Pages gratuito só publica de
repositório **público** — por isso estas páginas vão num repo público separado,
só com este conteúdo. No PowerShell, a partir da raiz do projeto:

```powershell
$tmp = Join-Path $env:TEMP 'barganha-legal'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Copy-Item site $tmp -Recurse
Remove-Item (Join-Path $tmp 'README.md')
Set-Location $tmp
git init -b main
git add .
git commit -m "docs: publica as paginas legais do Barganha"
gh repo create barganha-legal --public --source . --push
gh api -X POST repos/Douglas-devjr/barganha-legal/pages -f "source[branch]=main" -f "source[path]=/"
```

URLs resultantes (colar na ficha da Play, ver `docs/14-conformidade-play-store.md`):

- Site: `https://douglas-devjr.github.io/barganha-legal/`
- Política: `https://douglas-devjr.github.io/barganha-legal/politica-de-privacidade.html`
- Exclusão de conta: `https://douglas-devjr.github.io/barganha-legal/exclusao-de-conta.html`

## Atualizar depois

Editar os arquivos AQUI (fonte da verdade, versionada com o produto), repetir a
cópia acima e, no diretório temporário, `git add . ; git commit ; git push`.
