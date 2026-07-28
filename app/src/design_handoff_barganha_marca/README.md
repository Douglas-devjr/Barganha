# Handoff: Barganha — marca e tela de abertura

Material de **referência** (não é código de produção). Complementa o
`design_handoff_barganha_3a`, que cobre o resto do app: aqui está só a **marca**
(ícone "3b Degrau") e a **tela de abertura** (loading "3k Construção").

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `HANDOFF-LOADING.md` | Especificação da tela de abertura: layout, cores, geometria da marca e a tabela de animação. |
| `Barganha - Protótipo (referência).dc.html` | Protótipo interativo. Abra no navegador — a abertura roda na carga; para revê-la, `window.__go('splash')` no console. Precisa do `support.js` ao lado. |
| `screens/01-splash.png` | Captura estática da abertura. |
| `icones/` | 31 PNGs da marca, prontos para as lojas (`android/`, `ios/`, `web/`, `marca/`, `splash/`). |

> Este protótipo é uma versão **mais nova** que a do `design_handoff_barganha_3a`
> — é ele que traz a abertura "3k Construção". Para as demais telas, a referência
> continua sendo a do bundle 3a.

## Onde isto virou código

| Referência | Implementação |
|---|---|
| `HANDOFF-LOADING.md` §2–§5 | [`src/telas/SplashTela.tsx`](../telas/SplashTela.tsx) — a construção da marca, com os tempos e curvas do §5. |
| `HANDOFF-LOADING.md` §6 (splash nativo) | [`app.json`](../../app.json) → `expo.splash` |
| `icones/` | [`app/assets/`](../../assets/) — só os arquivos que o build consome. |

### Ícones que entraram no build

O Expo gera os tamanhos derivados a partir de um mestre; `app/assets/` fica com o
mínimo, e o resto do set vive aqui, para as fichas das lojas.

| `app/assets/` | Origem | Usado por |
|---|---|---|
| `icon.png` | `icones/ios/icon-1024.png` | `expo.icon` |
| `adaptive-icon.png` | `icones/android/adaptive-foreground-432.png` | `expo.android.adaptiveIcon.foregroundImage` |
| `splash-mark.png` | `icones/splash/splash-mark-1024.png` | `expo.splash.image` |
| `favicon.png` | `icones/web/favicon-48.png` | `expo.web.favicon` |

O fundo do ícone adaptativo e do splash é o `backgroundColor` `#1B1B19` do
`app.json` — por isso os PNGs de primeiro plano são transparentes e a marca vem
em `#F0F0EE`.
