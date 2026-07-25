<#
.SYNOPSIS
  Publica o conteúdo de `site/` no repositório público do GitHub Pages.

.DESCRIPTION
  O repositório do produto é privado e o GitHub Pages gratuito só publica de
  repositório público — por isso as páginas vivem num repo público separado
  (`barganha-legal`), que este script mantém como espelho de `site/`.

  A fonte da verdade continua sendo `site/` aqui. O script clona o repo de
  publicação num diretório de trabalho, espelha os arquivos (apagando o que foi
  removido na origem), commita e empurra. Se nada mudou, não commita nada.

  `site/README.md` é interno (instruções de publicação) e nunca é publicado.

.PARAMETER Mensagem
  Mensagem do commit de publicação. Default: "docs: atualiza as paginas legais".

.PARAMETER Repo
  Repositório de publicação no formato dono/nome.

.PARAMETER SemEsperar
  Não aguarda a build do Pages nem verifica as URLs — só empurra e sai.

.PARAMETER Simular
  Espelha e mostra o que mudaria, sem commitar nem empurrar nada.

.EXAMPLE
  npm run publicar:site
.EXAMPLE
  pwsh ./scripts/publicar-site.ps1 -Mensagem "docs: corrige o e-mail do DPO"
#>
[CmdletBinding()]
param(
  [string]$Mensagem = 'docs: atualiza as paginas legais',
  [string]$Repo = 'Douglas-devjr/barganha-legal',
  [switch]$SemEsperar,
  [switch]$Simular
)

$ErrorActionPreference = 'Stop'

# Arquivos de `site/` que NÃO vão para o ar (documentação interna).
$IGNORADOS = @('README.md')

$RAIZ = Split-Path -Parent $PSScriptRoot
$ORIGEM = Join-Path $RAIZ 'site'
$TRABALHO = Join-Path $env:TEMP 'barganha-legal-publicacao'

# `gh repo clone` respeitaria `git_protocol = ssh` e quebraria em quem não tem
# chave publica cadastrada; a URL HTTPS usa o token do gh via credential helper.
$URL_CLONE = "https://github.com/$Repo.git"
$dono, $nome = $Repo.Split('/')
$BASE_PUBLICA = "https://$($dono.ToLower()).github.io/$nome/"

# Função simples de propósito: `$args` recebe tudo, inclusive tokens como `-C`
# (um param block avançado tentaria interpretá-los como parâmetros do PowerShell).
function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($args -join ' ') falhou (codigo $LASTEXITCODE)"
  }
}

# --- 1. Pré-requisitos -------------------------------------------------------

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) nao encontrado no PATH — instale ou publique manualmente.'
}
$login = & gh api user --jq '.login'
if ($LASTEXITCODE -ne 0) {
  throw 'gh sem autenticacao valida — rode: gh auth login'
}
Write-Host "Autenticado como $login"
if (-not (Test-Path $ORIGEM)) {
  throw "Diretorio de origem nao encontrado: $ORIGEM"
}

# --- 2. Repo de publicação em estado limpo -----------------------------------

if (Test-Path (Join-Path $TRABALHO '.git')) {
  Write-Host "Atualizando o clone em $TRABALHO"
  Invoke-Git -C $TRABALHO remote set-url origin $URL_CLONE
  Invoke-Git -C $TRABALHO fetch --quiet origin main
  # Descarta qualquer resíduo local: o estado publicado é sempre derivado de `site/`.
  Invoke-Git -C $TRABALHO checkout --quiet -B main origin/main
  Invoke-Git -C $TRABALHO reset --quiet --hard origin/main
} else {
  if (Test-Path $TRABALHO) { Remove-Item $TRABALHO -Recurse -Force }
  Write-Host "Clonando $Repo em $TRABALHO"
  Invoke-Git clone --quiet $URL_CLONE $TRABALHO
}

# As páginas são LF na origem; sem isto o autocrlf global do Windows avisa a cada
# arquivo e pode empurrar CRLF para o repo publicado.
Invoke-Git -C $TRABALHO config core.autocrlf false

# --- 3. Espelha `site/` ------------------------------------------------------

Get-ChildItem -LiteralPath $TRABALHO -Force |
  Where-Object { $_.Name -ne '.git' } |
  Remove-Item -Recurse -Force

Get-ChildItem -LiteralPath $ORIGEM -Force |
  Where-Object { $IGNORADOS -notcontains $_.Name } |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $TRABALHO -Recurse -Force }

$publicados = Get-ChildItem -LiteralPath $TRABALHO -Force -Recurse -File |
  Where-Object { $_.FullName -notlike "*\.git\*" }
if (-not $publicados) {
  throw 'Nada para publicar — `site/` ficou vazio depois dos ignorados.'
}
Write-Host "Arquivos a publicar: $(($publicados | ForEach-Object { $_.Name }) -join ', ')"

# --- 4. Commit e push --------------------------------------------------------

Invoke-Git -C $TRABALHO add -A
$pendente = & git -C $TRABALHO status --porcelain
if (-not $pendente) {
  Write-Host ''
  Write-Host 'Nada mudou desde a ultima publicacao — nenhum commit criado.'
  Write-Host "Site: $BASE_PUBLICA"
  exit 0
}

Write-Host ''
Write-Host 'Mudancas a publicar:'
$pendente | ForEach-Object { Write-Host "  $_" }

if ($Simular) {
  Write-Host ''
  Write-Host 'Simulacao — nada foi commitado nem empurrado.'
  exit 0
}

Invoke-Git -C $TRABALHO commit --quiet -m $Mensagem
Invoke-Git -C $TRABALHO push --quiet origin main
Write-Host 'Push concluido.'

if ($SemEsperar) {
  Write-Host "Site: $BASE_PUBLICA (build do Pages roda em segundo plano)"
  exit 0
}

# --- 5. Aguarda a build e confere as URLs ------------------------------------

Write-Host 'Aguardando a build do GitHub Pages...'
$status = 'building'
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Seconds 10
  $status = & gh api "repos/$Repo/pages/builds/latest" --jq '.status'
  if ($status -ne 'building') { break }
}
if ($status -ne 'built') {
  $erro = & gh api "repos/$Repo/pages/builds/latest" --jq '.error.message'
  throw "Build do Pages nao concluiu (status: $status). $erro"
}

Write-Host ''
$falhou = $false
foreach ($arquivo in ($publicados | Sort-Object Name)) {
  $url = $BASE_PUBLICA + $arquivo.Name
  try {
    $resposta = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop
    Write-Host "  $($resposta.StatusCode)  $url"
  } catch {
    $falhou = $true
    Write-Host "  ERRO $($_.Exception.Response.StatusCode.value__)  $url"
  }
}

if ($falhou) { throw 'Alguma pagina nao respondeu 200 — verifique o Pages.' }
Write-Host ''
Write-Host "Publicado: $BASE_PUBLICA"
