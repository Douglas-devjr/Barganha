# Handoff — Tela de loading (abertura) · Barganha

Documento único e auto-suficiente da **tela de abertura** do app. Direção fechada: **3k "Construção"** com o ícone **3b "Degrau"**, sobre o sistema 3a Neutra.

---

## 1. O que é

Tela cheia mostrada na abertura do app, por **1,9 s**, antes do onboarding (primeiro uso) ou da Home. Não é um spinner: a marca **se constrói** — a haste cresce e os dois bojos brotam dela em sequência, terminando no monograma inteiro. O movimento é a própria hierarquia do B, e serve como assinatura da marca.

Fluxo: `splash` → (1,9 s ou toque) → `onboarding` na primeira vez, `inicio` nas seguintes.

---

## 2. Layout

Centralizado vertical e horizontalmente, em coluna, com **20 px** entre os blocos:

| Elemento | Especificação |
|---|---|
| Marca (B) | caixa de **96 × 96 px**, centralizada |
| Wordmark | "Barganha" · Instrument Sans **700** · **30 px** · `letter-spacing: -1px` |
| Tagline | "Saiba se o preço vale a barganha" · Instrument Sans **500** · **12 px** · `rgba(255,255,255,.5)` · fixada a **40 px** do rodapé |
| Brilhos | dois círculos de **260 px** com `radial-gradient`, decorativos (canto superior direito e inferior esquerdo, deslocados para fora da tela) |

Brilhos, valores exatos:

```
topo-direita:   top:-80px; right:-70px;  radial-gradient(circle, rgba(255,255,255,.10), rgba(255,255,255,0) 70%)
baixo-esquerda: bottom:-90px; left:-70px; radial-gradient(circle, rgba(255,255,255,.07), rgba(255,255,255,0) 70%)
```

---

## 3. Cores — a tela **não** acompanha o tema

Sempre escura, em light e dark mode:

| Item | Valor |
|---|---|
| Fundo | `#111110` |
| Marca, wordmark | `#F0F0EE` |
| Tagline | `rgba(255,255,255,.5)` |

Motivo: evita um flash branco de tela cheia no boot e mantém continuidade com o splash **nativo** do Expo, cujo `backgroundColor` é `#1B1B19`. Não use os tokens `--bg` / `--ink` nesta tela — eles invertem no dark mode. Use os literais acima.

---

## 4. A marca (3b Degrau) — grid 100 × 100

```
<path d="M24 16h15v68H24z"/>                  <!-- haste -->
<path d="M39 16h6.5a16 16 0 0 1 0 32H39z"/>   <!-- bojo superior -->
<path d="M39 50h17a17 17 0 0 1 0 34H39z"/>    <!-- bojo inferior -->
```

| Elemento | Medida |
|---|---|
| Haste | x 24 → 39 (15 de largura) · y 16 → 84 |
| Bojo superior | y 16 → 48 (h 32) · avanço 6,5 · arco r 16 · borda direita 61,5 |
| Bojo inferior | y 50 → 84 (h 34) · recuo 17 · arco r 17 · borda direita 73 |
| Vinco | **2** (48 → 50) |

Avanço 6,5 · recuo 17 · vinco 2 são a assinatura — não redesenhe.

---

## 5. Animação

Total **1,9 s**. Cada parte é posicionada em % dentro da caixa de 96 px, e animada de forma independente.

| Início | Duração | Elemento | De → para | Curva |
|---|---|---|---|---|
| 0 ms | 420 ms | Haste (`left:24% top:16% width:15%`) | `height: 0 → 68%` | `cubic-bezier(.3,.9,.3,1)` |
| 340 ms | 380 ms | Bojo superior (`left:39% top:16% w:22.5% h:32%`) | `scale(0) → scale(1)`, `opacity 0 → 1` | `cubic-bezier(.25,1.5,.4,1)` |
| 520 ms | 380 ms | Bojo inferior (`left:39% top:50% w:34% h:34%`) | `scale(0) → scale(1)`, `opacity 0 → 1` | `cubic-bezier(.25,1.5,.4,1)` |
| 740 ms | 500 ms | Wordmark | `opacity 0 → 1`, `scale(.92) → 1` | `ease` |
| 1900 ms | — | Saída | dissolve para a próxima tela | — |

Os bojos têm `transform-origin: left center` — brotam **da haste**, não do próprio centro. A tela como um todo entra com um fade de 300 ms.

Keyframes:

```css
@keyframes bStem { from { height: 0 }    to { height: 68% } }
@keyframes bBowl { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes popIn { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
```

**Acessibilidade:** com `prefers-reduced-motion: reduce`, desligue todas as animações — a marca aparece pronta e completa, sem construção. Já previsto no protótipo.

---

## 6. Implementação em React Native / Expo

Duas camadas, mesma cor de fundo, sem salto entre elas:

1. **Splash nativo** (cobre o boot do JS) — `app.json`:

```json
"splash": {
  "image": "./assets/splash-mark.png",
  "resizeMode": "contain",
  "backgroundColor": "#1B1B19"
}
```

Asset: `icones/splash/splash-mark-1024.png` (marca em `#F0F0EE`, fundo transparente) → `app/assets/splash-mark.png`.

2. **Tela animada** (a construção) — primeira rota do app, reproduzindo a tabela da seção 5 com `Animated` ou `reanimated`. Use `react-native-svg` para os dois bojos e uma `View` simples para a haste. Ao terminar, navegue para `onboarding` (primeiro uso) ou `inicio`.

Toque na tela deve pular a espera e avançar imediatamente.

---

## 7. Referência viva

- `Barganha - Protótipo (referência).dc.html` — abra no navegador; a abertura roda na carga. Para revê-la: `window.__go('splash')` no console.
- `screens/01-splash.png` — captura estática.
- `MARCA.md` — o pacote completo da marca (ícone, todos os tamanhos, regras de uso).
- `icones/` — 31 PNGs prontos para as lojas.
