# Handoff: Barganha — Redesign "2a" (Teal Refinado sobre creme)

## Visão geral
Redesenho completo do app **Barganha** (escaneia cupom NFC-e → veredito de preço na gôndola).
Mesma marca teal e mesma fonte (Plus Jakarta Sans) que você já usa; o que muda é o **acabamento**:
fundo creme, cartões com profundidade, hierarquia mais calma, uma **barra de posição de preço**
nova, **modo escuro** e os **estados** (vazio, carregando, erro, offline).

Direção escolhida: **2a** = layout "Teal Refinado" sobre o fundo creme `#FBF5EC`.

---

## Sobre os arquivos deste pacote
Os arquivos em `prototipo/` são **referências de design feitas em HTML/CSS** — protótipos que mostram
o visual e o comportamento pretendidos. **Não são código para copiar e colar.** Seu app é
**React Native (Expo) + TypeScript**, então a tarefa é **recriar estes designs no seu ambiente atual**,
reaproveitando o design system que você já tem em `src/tema/` e `src/componentes/`.

Abra `prototipo/Barganha - App (2a).dc.html` num navegador para navegar pelo app inteiro
(há um seletor Claro/Escuro e um índice lateral para pular para qualquer tela). A galeria mostra
todas as telas de uma vez, incluindo a faixa de modo escuro.

## Fidelidade
**Hi-fi (alta fidelidade).** Cores, tipografia, espaçamento e raios são finais — recrie fielmente.
Onde o HTML usa um recurso web (gradiente CSS, sombra, `gap`), use o equivalente RN (ver "Notas de RN").

---

## Stack alvo e mapeamento de arquivos
Você já tem a estrutura certa. O redesign encaixa assim nos seus arquivos:

| Seu arquivo | O que muda |
|---|---|
| `src/tema/cores.ts` | **Substituir a paleta** pelos tokens abaixo + adicionar tema escuro |
| `src/tema/tipografia.ts` | Conferir a escala (tamanhos/pesos abaixo) |
| `src/tema/espacamento.ts` | Conferir raios e sombras (abaixo) |
| `src/tema/index.ts` | Exportar `temaClaro`, `temaEscuro` e um `ThemeContext` |
| `src/componentes/Cartao.tsx` | Novo fundo/borda/sombra (cartão creme) |
| `src/componentes/Botao.tsx` | Ajuste de raio, altura, sombra do primário |
| `src/componentes/VeredictoBadge.tsx` | Vira a pílula sólida + **nova BarraPreco** ao lado |
| `src/componentes/icones.tsx` | Adicionar ícones: `store`, `receipt`, `alert`, `wifiOff`, `search`, `barras`, `down`, `up` |
| `src/navegacao/BarraAbas.tsx` | FAB central 60×60 raio 20, sombra teal; cores de aba |
| `src/telas/*` | Re-layout de cada tela (ver "Telas") |
| **novos** | `componentes/BarraPreco.tsx`, `componentes/CartaoEconomia.tsx`, `componentes/CartaoStat.tsx`, `componentes/Estado.tsx`, `componentes/Esqueleto.tsx` |

---

## Design Tokens

### Cores — tema claro (2a)
Cole em `src/tema/cores.ts` (nomes sugeridos; ajuste aos seus):

```ts
export const claro = {
  // superfícies
  fundo:        '#FBF5EC', // creme — fundo do app
  cartao:       '#FFFCF6', // quase-branco quente — cards
  cartaoBorda:  'rgba(15,23,42,0.05)',
  linha:        '#F1ECE1', // divisórias internas de card
  borda:        '#E7DECE', // bordas/inputs sobre creme

  // texto
  tinta:        '#0E1B24', // títulos e valores (ink)
  suave:        '#54636E', // texto secundário
  fraco:        '#93A4AE', // legendas/placeholder

  // marca
  teal:         '#0F766E',
  tealPressed:  '#0B5F58',
  tealWash:     '#ECFBF7', // fundo de ícone/tile teal claro
  tealWash2:    '#D3F3EC', // avatar/círculo
  menta:        '#5EEAD4', // acento sobre teal escuro
  sobreTeal:    '#052E2B', // texto sobre menta

  // veredito
  baratoBg:     '#EAFBF1', baratoBg2: '#D7F4E1', baratoBorda: '#BBEAC9',
  barato:       '#12A150', baratoTexto: '#15803D',
  medio:        '#0F766E',
  caro:         '#E5484D',
  // promoção / avisos
  ambar:        '#E8930C', ambarBg: '#FCEFD3', ambarTexto: '#B26A05',
} as const;
```

### Cores — tema escuro
```ts
export const escuro = {
  fundo:        '#0E1512',
  cartao:       '#18211D',
  cartaoBorda:  'rgba(255,255,255,0.08)',
  linha:        'rgba(255,255,255,0.07)',
  borda:        'rgba(255,255,255,0.12)',

  tinta:        '#EAF2EF',
  suave:        '#9CB2AB',
  fraco:        '#617C74',

  teal:         '#18B8A6', // teal mais claro p/ brilhar no escuro
  tealPressed:  '#0F766E',
  tealWash:     'rgba(45,212,191,0.13)',
  tealWash2:    'rgba(45,212,191,0.17)',
  menta:        '#5EEAD4',
  sobreTeal:    '#052E2B',

  baratoBg:     'rgba(45,212,191,0.09)', baratoBg2: 'rgba(45,212,191,0.09)', baratoBorda: 'rgba(45,212,191,0.30)',
  barato:       '#34D399', baratoTexto: '#8AE6BE',
  medio:        '#18B8A6',
  caro:         '#FB7185',
  ambar:        '#E8930C', ambarBg: 'rgba(232,147,12,0.15)', ambarTexto: '#F2B45A',
} as const;

export type Paleta = typeof claro;
```

> **Regra de ouro do escuro:** os verdes/âmbares "chapados" (fundo de veredito, chip de promoção)
> precisam de versões próprias no escuro — não reaproveite os claros, eles somem. Já estão acima.

### Tipografia (Plus Jakarta Sans — você já carrega via `@expo-google-fonts`)
| Uso | Peso | Tamanho | Tracking | Cor |
|---|---|---|---|---|
| Eyebrow (SEXTA · RIO) | 700 | 11 | +1.3px, UPPERCASE | fraco |
| Saudação / título tela | 800 | 22–25 | −0.5px | tinta |
| Valor do hero (economia) | 800 | 41 | −1.2px | #fff (sobre teal) |
| Preço grande (Verificar) | 800 | 52 | −2px | tinta |
| Título de seção | 800 | 17 | −0.3px | tinta |
| Número de stat | 800 | 21 | — | tinta |
| Nome de item/produto | 700–800 | 14–15 | — | tinta |
| Corpo / legenda | 500 | 12–14 | — | suave/fraco |
| Pílula de veredito | 800 | 16 | — | #fff |

### Raios
`tile 12–14 · input 14–15 · botão 15–16 · cartão 18–22 · hero/veredito 24–26 · pílula 999`

### Sombras (RN: use `shadowColor/Opacity/Radius/Offset` + `elevation`)
- **Cartão:** cor `#3C2D14`, opacity ~0.06, radius 24, offset y 12 (bem difusa e suave).
- **Botão primário / FAB:** cor teal `#0F766E`, opacity ~0.4, radius 20, offset y 12.
- No escuro, reduza a sombra e confie na borda `cartaoBorda` para separar superfícies.

### Espaçamento
Mantém sua escala de 4px. Padrões usados: padding lateral da tela **20px**; gap entre cards **12px**;
padding interno de card **14–22px**; respiro entre seções **~22px**.

---

## Componentes

### `Cartao.tsx`
Fundo `cartao`, borda `1px cartaoBorda`, raio 20–22, sombra de cartão. É a base de quase tudo.

### `CartaoEconomia.tsx` (novo — o hero do Início)
- Fundo: **gradiente** teal `#12857C → #0B5F58` (150°) → use `expo-linear-gradient`.
- Raio 26, padding 22. Um círculo radial claro no canto sup. dir. (decorativo) e uma
  mini-sparkline menta (`#5EEAD4`, opacity .5) no rodapé.
- Conteúdo: label "Economia em promoções" (menta clara) + pílula "Este mês"; valor `800 41px #fff`;
  chip menta com seta + delta ("R$ 32 a mais que mês passado").

### `CartaoStat.tsx` (novo)
Card pequeno: número `800 21px` (tinta) + legenda `600 11.5px` (suave). Usados em par (produtos monitorados / mercados).

### `BarraPreco.tsx` (novo — a peça-chave do veredito) ⭐
Barra horizontal que posiciona o preço visto entre o menor e o maior da região.
- Trilho: altura 10, raio 999, **gradiente 90°** `#22C55E → #0F766E (48%) → #EF4444`.
- Thumb: círculo 19px branco, borda 4px na cor do veredito (`barato`/`medio`/`caro`), sombra leve.
- Posição do thumb = `% = (preço − min) / (max − min)`. Ex.: barato ≈ 23%.
- Balão acima do thumb: preço em pílula `tinta`→ no escuro use `teal` (fica legível) com "rabinho" (caret).
- Abaixo: três legendas `600 10.5px fraco` — "Menor R$…", "Típico R$…", "Maior R$…".
- No escuro, some um leve glow no trilho (shadow teal).

### `VeredictoBadge.tsx`
Pílula **sólida** (não mais leve): fundo `barato`/`caro`/`medio`, texto `800 16px #fff`, um ponto branco à esquerda, raio 999, sombra na cor do veredito. Fica dentro de um painel `baratoBg`/`baratoBorda` com subtítulo ("12% abaixo do preço típico da sua região") + a `BarraPreco`.

### `Botao.tsx`
- **primário:** teal, altura 52–54, raio 15–16, texto `800 14–15px #fff`, sombra teal.
- **secundário:** fundo `tealWash`, borda `1.5px #B7E9E0` (claro), texto teal.
- **texto:** só o label teal (ex.: "Ver tudo", "Editar").

### `BarraAbas.tsx`
4 abas (Início, Verificar, Produtos, Perfil) + **FAB central** de scan.
- Barra: fundo `cartao`, borda-topo `linha`, altura ~84 (respeitando safe-area inferior).
- Aba ativa = `teal`; inativa = `fraco`. Ícone 24 + label `700 10.5px`.
- FAB: 60×60, raio 20, fundo teal, **borda 4px na cor do fundo** (recorte), ícone scan branco 27, sobe ~22px acima da barra, sombra teal. Toque → abre Scanner (QR).

### `icones.tsx`
Adicione (line icons, stroke 2–2.2, currentColor): `store`, `receipt`, `alert` (triângulo), `wifiOff`, `search`, `barras`, `down`, `up`, `close`, `chevron`. SVGs de referência estão no `<defs>` do topo de `Barganha - App (2a).dc.html`.

---

## Telas

### 1. Início (`InicioTela`)
Header: eyebrow (dia · cidade) + "Olá, Marina 👋" à esquerda, avatar 46px (`tealWash2`, inicial teal) à direita.
→ `CartaoEconomia` (hero) → linha com 2 `CartaoStat` → seção "Últimas compras" (título + "Ver tudo") →
`Cartao` com 3 linhas de compra (ícone `store` em tile `tealWash`, nome + "Hoje · N itens", valor + economia verde). Cada linha toca → `NotaFiscalTela`.

### 2. Verificar (`VerificarTela`)
Título + subtítulo. Botão primário grande "Escanear código de barras" (→ scanner de barras).
Divisória "ou busque no histórico". Campo de busca + chips de produtos recentes. Card central com o
**preço na prateleira** grande (`800 52px`) e o produto sendo comparado. Botão "Verificar preço" → Resultado.

### 3. Veredito / Resultado (`VerificarTela` estado resultado)
Header com voltar. Card do produto (tile inicial + nome + "1 L · você viu na prateleira" + preço).
Painel de veredito (`VeredictoBadge` + `BarraPreco`). Card de comparação com 3 linhas:
**Sua região** (típico + faixa + N obs.), **Seu histórico** (menor já pago), **Menor visto (promoção)** em faixa âmbar.
Rodapé: "Ver histórico" (→ Detalhe) + "Verificar outro".

### 4. Meus produtos (`ProdutosTela`)
Título + busca. Lista de cards de produto: tile inicial, nome, "típico R$ X/base", e um **chip de tendência**
(verde `−4%` com seta baixo / vermelho `+7%` com seta cima / neutro `0%`). Toca → Detalhe.

### 5. Detalhe do produto (`ProdutoDetalheTela`)
Header voltar + nome + "Evolução de preço /L". Card com **gráfico de linha/área** (seu `GraficoLinha`, cor teal,
área com 7% de opacidade, ponto final destacado). Linha de 3 stats (Menor verde / Típico / Maior vermelho).
Lista "Compras" (loja + data, preço; promoções em âmbar).

### 6. Perfil (`PerfilTela`)
Avatar 60px + nome + email. Card: Região (com "Editar") + Cupons escaneados. Seção "Seus mercados" (lista).
Botão "Sair" (secundário). Nota de privacidade LGPD no rodapé.

### 7. Escanear cupom (`ScannerTela`) e 9. Código de barras (`EscanearBarrasTela`)
Fundo **escuro** sempre (câmera): overlay radial, moldura com cantos menta `#5EEAD4`, linha de scan com glow.
Botão fechar (X) no topo. Texto de instrução. (No protótipo há um botão "simular leitura" só para navegar.)

### 8. Nota fiscal (`NotaFiscalTela`)
Header voltar + loja + data. Card da loja. Lista de itens (nome, qtd × preço, desconto; total à direita).
Card de totais (Subtotal / Desconto verde / Valor pago). Ações "Descartar" / "Salvar no histórico".

### + Onboarding (`OnboardingTela`)
3 passos (ícone em círculo `tealWash2` 132px, título `800 26px`, texto). Dots de progresso (o ativo é uma
barra 22×8). Botão avança; no 3º passo "Concordar e começar" (consentimento LGPD) → Login.

### + Login (`auth/LoginTela`)
Logo teal 60px, "Entrar", campos Email/Senha (cards), "Esqueci a senha", botão Entrar, divisória "ou",
botão "Entrar com Google" (secundário), link "Criar conta".

---

## Estados (novos — funcionam em claro e escuro)
Componentize como `Estado.tsx` (ícone em círculo + título + texto + ação) e `Esqueleto.tsx` (shimmer).

- **Vazio (primeiro uso):** ícone `receipt` em círculo `tealWash2`, "Nenhuma compra ainda",
  texto de apoio, botão primário "Escanear primeiro cupom".
- **Carregando (nota processando):** card com **spinner** (anel teal girando) + "Processando a nota…" +
  3 linhas de **esqueleto shimmer** (gradiente `linha→borda→linha` animado). Aviso "roda em segundo plano".
- **Erro no cupom:** ícone `alert` em círculo âmbar (`ambarBg`, `ambar`), "Não foi possível ler este cupom",
  explicação, ações "Descartar" / "Tentar de novo".
- **Sem conexão:** faixa âmbar fina no topo ("Você está offline") + ícone `wifiOff` em círculo `tealWash2`,
  "Sem conexão", texto tranquilizador (cupons salvos, sincroniza depois), botão "Ver meu histórico".

---

## Modo escuro
Implemente um **ThemeContext** que troca o objeto de paleta (`claro`/`escuro`) e faça os componentes lerem
as cores do contexto (nada de hex fixo nos componentes).

```tsx
// tema/ThemeContext.tsx
import React, { createContext, useContext, useState } from 'react';
import { claro, escuro, Paleta } from './cores';

const Ctx = createContext<{ c: Paleta; escuro: boolean; toggle: () => void }>({
  c: claro, escuro: false, toggle: () => {},
});
export const useTema = () => useContext(Ctx);

export function ProvedorTema({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false); // opcional: iniciar de Appearance.getColorScheme()
  return (
    <Ctx.Provider value={{ c: dark ? escuro : claro, escuro: dark, toggle: () => setDark(v => !v) }}>
      {children}
    </Ctx.Provider>
  );
}
```

```tsx
// uso em qualquer tela/componente
const { c } = useTema();
<View style={{ backgroundColor: c.fundo }}>
  <Text style={{ color: c.tinta }}>Olá, Marina</Text>
</View>
```

Dica: você pode ler a preferência do sistema com `Appearance.getColorScheme()` e/ou deixar um toggle no Perfil.

> **Bug que já corrigimos e você deve evitar:** em RN, `Text` **não herda cor** de qualquer `View`/`Pressable`.
> Todo `Text` precisa de `color` explícito vindo do tema (`c.tinta`, `c.suave`, …). No protótipo web
> isso apareceu como "texto preto no escuro" justamente onde a cor era herdada. Em RN é obrigatório
> setar a cor em cada `Text`.

---

## Interações & navegação
- **Tabs + FAB:** as 4 abas trocam a tela; o FAB abre o Scanner (QR).
- **Fluxo cupom:** FAB → Scanner (QR) → (sucesso) Nota fiscal → Salvar → Início · (falha) Erro no cupom.
- **Fluxo gôndola:** Verificar → Código de barras → Resultado (veredito). "Ver histórico" → Detalhe.
- **Drill-ins:** linha de compra → Nota fiscal; card de produto → Detalhe; ambos com voltar (header).
- **Transições:** o protótipo usa um fade-up leve (opacity 0→1, translateY 8→0, ~300ms) ao entrar na tela.
  Em RN use o padrão do seu navegador (React Navigation) ou `Animated`/`react-native-reanimated`.

---

## Notas de React Native (web → RN)
- **Gradientes** (hero, barra de preço): `expo-linear-gradient` (`<LinearGradient colors={[...]}>`). Não há `linear-gradient` em `style`.
- **Sombras:** iOS via `shadow*`, Android via `elevation`. Veja valores em "Sombras".
- **`gap`:** suportado em RN recente; se seu RN for antigo, use margens.
- **Shimmer:** `Animated.loop` movendo um `LinearGradient` sobre a barra (ou `react-native-reanimated`).
- **Spinner:** `ActivityIndicator` (cor teal) ou um anel com `Animated` girando 360°.
- **Ícones:** `react-native-svg` (você já usa em `icones.tsx`); mantenha `stroke="currentColor"` → passe `color`.
- **Safe area:** mantenha seu `Tela.tsx`/`SafeAreaView`; a barra de abas deve respeitar o inset inferior.
- **Fontes:** já OK via `@expo-google-fonts/plus-jakarta-sans`.

---

## Ordem de implementação sugerida
1. **Tokens** (`cores.ts` claro+escuro) + `ThemeContext` + fazer componentes lerem `useTema()`.
2. **Base visual:** `Cartao`, `Botao`, `BarraAbas` (FAB) — isso já muda a cara do app inteiro.
3. **Início:** `CartaoEconomia` + `CartaoStat` + lista de compras.
4. **Veredito:** `BarraPreco` + `VeredictoBadge` + tela de Resultado (o momento de maior valor).
5. **Produtos / Detalhe / Perfil / Nota.**
6. **Estados:** `Estado` + `Esqueleto` (vazio, carregando, erro, offline).
7. **Modo escuro:** revisar cada `Text` (cor explícita) e os verdes/âmbares.

---

## Arquivos deste pacote
- `prototipo/Barganha - App (2a).dc.html` — **protótipo navegável** (todas as telas + toggle claro/escuro + estados). Abra no navegador; use o índice lateral.
- `prototipo/Barganha - Galeria (2a).dc.html` — todas as telas lado a lado + faixa de modo escuro.
- `prototipo/Barganha - Direções.dc.html` — as explorações (1a/1b/1c/2a) e o comparativo antes→depois, caso queira o contexto das decisões.
- `prototipo/support.js` — runtime dos protótipos (necessário para abrir os HTML acima).

Os valores exatos (hex, tamanhos, raios) de qualquer detalhe estão inline no HTML do protótipo — basta inspecionar o elemento correspondente.
