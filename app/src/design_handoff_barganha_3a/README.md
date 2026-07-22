# Handoff: Barganha — Redesign "3a Neutra"

## Visão geral
Redesenho completo do app **Barganha** (escaneia cupons NFC-e, monta base colaborativa de preços e diz se o preço "vale a barganha"). Esta é a direção visual **3a — Neutra/minimalista**: canvas neutro, tinta quase-preta, **zero cor de marca na navegação**; a cor entra apenas no **semáforo do veredito** (verde = barato, âmbar = na média, vermelho = caro) e nos indicadores de variação de preço. Persona de exemplo: **Douglas Santana**, Rio de Janeiro (Tijuca).

## Sobre os arquivos de design
O arquivo `Barganha - Protótipo (referência).dc.html` neste bundle é uma **referência de design feita em HTML** — um protótipo interativo que mostra aparência e comportamento pretendidos. **Não é código de produção para copiar.** A tarefa é **recriar estas telas no ambiente já existente do app** (Expo / React Native + TypeScript, em `Comparai/app`), usando os padrões, a navegação e os componentes que já existem no repositório. O HTML usa `<div>`/`<svg>` e variáveis CSS só porque é um protótipo web; no app equivalem a `View`/`Text`/`Pressable`/`react-native-svg` e aos tokens de `src/tema/`.

Como abrir a referência: abra o `.dc.html` em qualquer navegador. Alterne claro/escuro pelo **Perfil → Tema**, ou pelo controle de "tweaks" (prop `theme`).

## Fidelidade
**Hi-fi (alta fidelidade).** Cores, tipografia, espaçamentos e interações são finais. Recrie pixel-a-pixel usando as libs do app. Onde o app já tiver um componente equivalente (botão, input, switch, bottom-sheet), **use o do app** com estes valores visuais.

---

## Mapa de telas (rotas do protótipo)
O protótipo é uma máquina de estados com uma variável `route`. Ordem natural de fluxo:

| route | Tela | Entra a partir de |
|---|---|---|
| `onboarding` | Onboarding (3 slides) | abertura do app (primeira vez) |
| `login` | Login | fim do onboarding / "Pular" |
| `recuperar` | Recuperar senha | Login → "Esqueci a senha" |
| `inicio` | Início (home) | após entrar |
| `notificacoes` | Notificações | sino no header do Início / Perfil |
| `conquistas` | Conquistas e prêmios | card no Início / Perfil |
| `verificar` | Verificar preço ⭐ | aba inferior |
| `escanear` | Escanear cupom (câmera) | FAB central |
| `processando` | Lendo cupom… (loading) | após "Simular leitura" |
| `erro` | Erro de leitura | após "Simular cupom inválido" |
| `produtos` | Produtos (lista) | aba inferior |
| `editar` | Editar produto | kebab → Editar |
| `detalhe` | Detalhe do produto | item "Leite" em Produtos / Verificar |
| `compra` | Detalhe da compra (cupom) | item de compra no Início |
| `dashboard` | Resumo de economia | card de economia no Início |
| `perfil` | Perfil / ajustes | aba inferior / avatar |

Sobrepostos (não são `route`, são flags de estado): **bottom-sheets** (`sheet` = `acoes` \| `filtros` \| `denunciar`), **diálogo de confirmação** (`dialog` = `produto` \| `conta`) e **toast**.

⭐ = tela-assinatura (o veredito de preço).

---

## Design tokens

### Cores — tema CLARO (`claro`)
| Token | Hex | Uso |
|---|---|---|
| `bg` | `#F7F7F5` | fundo do app |
| `card` | `#FFFFFF` | cards, barras, campos |
| `ink` | `#1B1B19` | texto principal, botão primário, ícones ativos |
| `sub` | `#6B6B66` | texto secundário |
| `faint` | `#A3A39D` | legendas, placeholders, ícones inativos |
| `line` | `#E7E7E3` | bordas |
| `line2` | `#F0F0EC` | divisórias internas, trilhos |
| `chip` | `#1B1B19` | fundo de botão/pill primário |
| `chipink` | `#FFFFFF` | texto sobre `chip` |
| `fld` | `#FFFFFF` | fundo de input |
| `up` | `#DC2626` | preço **subiu** / caro / destrutivo |
| `down` | `#16A34A` | preço **caiu** / barato |
| `mid` | `#D97706` | na média |

### Cores — tema ESCURO (`escuro`)
| Token | Valor | Uso |
|---|---|---|
| `bg` | `#111110` | fundo |
| `card` | `#191918` | cards |
| `ink` | `#F0F0EE` | texto principal / botão primário |
| `sub` | `#8F8F8A` | secundário |
| `faint` | `#8F8F8A` | legendas / inativos |
| `line` | `rgba(255,255,255,.12)` | bordas |
| `line2` | `rgba(255,255,255,.08)` | divisórias |
| `chip` | `#F0F0EE` | botão primário (claro sobre escuro) |
| `chipink` | `#111110` | texto sobre `chip` |
| `fld` | `#191918` | input |
| `up` | `#F87171` | subiu / caro |
| `down` | `#4ADE80` | caiu / barato |
| `mid` | `#E8A33C` | na média |

> **Nota de acessibilidade:** os pares foram checados para AA nos dois temas. Mantenha `ink`/`bg` e `chipink`/`chip` ao trocar cores.

### Tipografia
- **Família única:** **Instrument Sans** (Google Fonts, pesos 400/500/600/700). Substitui a Plus Jakarta Sans atual.
- **Números:** sempre `font-variant-numeric: tabular-nums` em preços/estatísticas (RN: `fontVariant:['tabular-nums']`).
- Escala usada:

| Papel | Tamanho / peso / tracking |
|---|---|
| Número gigante (economia, preço destaque) | 40px / 700 / -2px |
| Preço médio (veredito, total) | 34–36px / 700 / -1.8px |
| Título de tela | 26px / 700 / -0.8px |
| Título de seção / card | 15–20px / 700 / -0.3 a -0.5px |
| Corpo | 13–14px / 400–500 |
| Rótulo forte de item | 13–13.5px / 600 |
| Legenda MAIÚSCULA | 10.5–11px / 600 / tracking 1.3px |
| Caption | 11px / 400 |
| Preço em linha | 13–15px / 700 tabular |

### Raios, sombra, espaçamento
- Raios: **cards 16px**, **botões/inputs 12px**, **pills/switch/avatar 999px**, **chips de filtro 999px**, **ícone-quadrado 10px**, **bottom-sheet 22px (topo)**, **moldura do device 38px** (só no protótipo).
- Grade base **8pt**; padding horizontal padrão das telas **20px**; padding interno de card **14–18px**.
- Alvos de toque ≥ **44px** (abas, botões, switches).
- **Sem sombras** nas superfícies (o design é flat, definido por `line`); a única sombra é a do device no protótipo — ignore no app. Bottom-sheet pode ter leve sombra superior.
- Ícones: stroke **2** (2.2 em ícones de nav), `stroke-linecap:round`. Estilo Lucide/Feather. No app: `lucide-react-native` ou os ícones já existentes.

---

## Especificação por tela

### Onboarding (`onboarding`)
- Fundo `chip` (tinta) no topo com bolha radial sutil; folha `bg` arredondada (28px) na base.
- 3 slides, cada um com ícone (48–96px) em quadrado `chip` raio 28px, título 25/700 e texto 14/1.55 `sub`.
- Textos: **1)** "Escaneie seus cupons" — "Cada cupom fiscal (NFC-e) vira dado de preço da sua região, de forma anônima." **2)** "Veja se vale a barganha" — "Compare o preço da gôndola com o típico da região antes de pôr no carrinho." **3)** "Economize todo mês" — "Receba alertas quando um produto baixa e ganhe conquistas pela sua economia."
- Dots (8px) com o ativo em `ink` opacidade 1, inativos 0.25. Botão primário "Próximo" / no último "Começar". Link "Pular" no topo.
- Estado: `onb` (0..2). "Começar"/"Pular" → `login`.

### Login (`login`)
- Painel superior `ink` com logo (quadrado `bg` raio 16, "B") e headline `bg` 36/700 "-1.4px": **"Saiba se o preço vale a barganha."**
- Folha inferior `bg` raio 28 no topo: campos **E-mail** (`douglas.santana@gmail.com`) e **Senha** (`••••••••`, com ícone de olho), input focado tem borda `ink` 1.5px. Link "Esqueci a senha" (→ `recuperar`).
- Botão primário **Entrar** (`chip`/`chipink`), divisor "OU", botão **Continuar com Google** (contorno). Rodapé "Primeira vez aqui? **Criar conta grátis**".
- Qualquer ação de entrar/criar → `inicio`.

### Recuperar senha (`recuperar`)
- Botão voltar (círculo). Título 27/700, texto explicativo, um campo **E-mail** (borda `ink`), botão **Enviar link de redefinição** (→ toast "Link de redefinição enviado" → volta ao `login`), link "Voltar para o login".

### Início (`inicio`)
- Header: eyebrow "SEG · 21 JUL · RIO DE JANEIRO" + "Olá, Douglas" (26/700). À direita: **sino** (com ponto `up` de não-lidas) e **avatar "D"** (44px círculo).
- **Card de economia** (tap → `dashboard`): "ECONOMIA · JULHO", **R$ 132,40** (40/700), subtítulo, linha inferior com 3 stats (23 produtos · 4 mercados · 31 cupons).
- **Card de conquista** (tap → `conquistas`): ícone troféu, "Nova conquista: Caçador de Café".
- **Últimas compras**: card com 3 linhas (Guanabara/Assaí/Zona Sul), cada uma com ícone loja, nome, data·itens e à direita preço + economia. Tap em qualquer linha → `compra`.

### Notificações (`notificacoes`)
- Header com voltar, título e "Marcar lidas" (zera os pontos). Seções "HOJE" e "ESTA SEMANA", cada item com ícone quadrado, título, subtítulo e ponto `up` se não-lido. Conteúdos de exemplo: baixa de preço, conquista desbloqueada, produto perto de você, resumo do mês.

### Conquistas e prêmios (`conquistas`)
- Card de nível: "NÍVEL 3 · CAÇADOR DE OFERTAS", progresso 4/6 (barra `ink`), texto de meta.
- Grid 2 colunas de badges: 4 conquistados (círculo `chip` com ícone) + 2 bloqueados (tracejado, opacidade .55, cadeado). Nomes/descrições no arquivo.

### Verificar preço ⭐ (`verificar`) — tela-assinatura
- Título + subtítulo. **Campo de busca** (input real, digitável) com ícone de scanner à direita (→ `escanear`). Chips rápidos: Leite Italac / Café Pilão / Arroz 5 kg.
- **Card do veredito** recalculado ao vivo pelo texto buscado:
  - loja (eyebrow) + link "Denunciar"; nome; **preço grande** (36/700 tabular) + **pill do veredito** (borda `ink` 1.5px; quando "Barato", fundo `ink`/texto `card`; senão fundo transparente/texto `ink`); mensagem `%` acima/abaixo.
  - **Régua horizontal**: trilho `line` 3px com marcador (14px, `ink`, anel `card`) posicionado por `pct = (valor-menor)/(maior-menor)`, e um tick do "típico" em 46%. Transição do `left` 0.5s.
  - rótulos menor/típico/maior (tabular) e rodapé "N cupons na sua região · últimos 30 dias".
- Links "Ver histórico e onde comprar →" (→ `detalhe`) e botão **Avisar quando baixar** (toggle de alerta + toast).
- **Dados** (usados no cálculo do veredito): ver seção "Modelo de dados".

### Escanear cupom (`escanear`) — overlay câmera
- Overlay `#111110` full-screen (z acima da tab bar). Header com fechar/flash. Moldura 250px com 4 cantos brancos e **linha de leitura animada** (varre verticalmente, ~1.8s alternando). Textos de instrução. Botões: **Simular leitura do cupom** (→ `processando` → sucesso) e **Simular cupom inválido** (→ `processando` → `erro`).

### Lendo cupom… (`processando`) — loading
- Overlay escuro, spinner circular (borda com topo branco girando), "Lendo cupom…" + "Anonimizando e comparando com a região". Após ~1.7s vai para Produtos (com skeleton) ou Erro.

### Erro de leitura (`erro`)
- Centralizado: círculo `line2` com ícone de alerta `up`, "Não deu pra ler o cupom", texto de causa/ação, botão **Tentar de novo** (→ `escanear`) e link "Voltar ao início".

### Produtos (`produtos`)
- Header "Produtos" + "23 monitorados". Linha com **busca** (input) + botão **Filtrar/Ordenar** (ícone, com badge do nº de filtros ativos).
- **Loading:** enquanto `loading`, mostra **skeleton shimmer** (5 linhas) no lugar da lista.
- **Lista:** cada item = nome + subtítulo ("típico R$ x · N cupons"), à direita preço (tabular) e **indicador de variação**: seta pra baixo `down` + "13%", seta pra cima `up` + "19%", ou "na média" `mid`. Kebab (⋮) abre sheet de ações. Tap no item "Leite" → `detalhe`; demais → sheet de ações.
- **Vazio:** se busca/filtro não retorna nada → "Nada encontrado" + "Limpar busca".

### Editar produto (`editar`)
- Header modal: **Cancelar** / "Editar produto" / **Salvar** (→ toast "Alterações salvas", volta à origem).
- Campos: Nome (preenchido com o produto selecionado), Categoria (chips, "Laticínios" ativo), "Avisar abaixo de" (R$ 4,70), toggle "Monitorar este produto", e botão **Excluir da lista** (→ diálogo de confirmação).

### Detalhe do produto (`detalhe`)
- Header com voltar + categoria/nome + kebab (→ sheet de ações). Card com "TÍPICO NA SUA REGIÃO R$ 5,49", badge "em queda", **mini-gráfico de linha** (sparkline SVG, fev→jul) com área preenchida, rótulos dos meses, rodapé menor/-8%/maior. Lista "Onde comprar hoje" (Assaí MENOR, Guanabara, Zona Sul). Card "Alerta de preço" com switch (toggle + toast).

### Detalhe da compra (`compra`)
- Header com voltar + "COMPRA · HOJE 10:42" / "Guanabara · Tijuca". Card total: "TOTAL DA COMPRA", economia `down`, **R$ 187,32** (34/700), "12 itens · pago no crédito · NFC-e validada". Lista "Itens do cupom" (4 exemplos com un×preço, subtotal e veredito barato/na média/caro) + "+ 8 outros itens neste cupom".

### Resumo de economia / Dashboard (`dashboard`)
- Header com voltar. Segmentado Maio/Junho/**Julho** (ativo `chip`). Card "VOCÊ ECONOMIZOU R$ 132,40" com **gráfico de barras** (fev→jul, jul em `ink`, meses anteriores em `line`/`faint`). Seção "Onde você mais economizou" com 3 barras de progresso (Laticínios 76% / Café 58% / Grãos 42%).

### Perfil (`perfil`)
- Avatar "D" + nome/email. Card de região (Rio · Tijuca). Lista de ajustes: Conquistas (4/6), Notificações, **Alertas de preço** (switch), **Tema** (segmentado Claro/Escuro — controla o tema do app inteiro), Privacidade dos dados. Botão **Excluir conta** (texto `up`, → diálogo `conta`). Rodapé "BARGANHA V2.0.1 · BASE COLABORATIVA".

### Padrões sobrepostos
- **Bottom-sheet de ações** (`sheet=acoes`): título do item + Editar / Denunciar preço incorreto / Excluir da lista (`up`) + **Cancelar**. Entra com slide-up (`sheetUp` .28s) sobre backdrop.
- **Bottom-sheet de filtros** (`sheet=filtros`): "Filtrar e ordenar" + "Limpar"; chips de **Categoria** (Todos/Laticínios/Café/Grãos/Mercearia/Limpeza); **Ordenar por** (Padrão/Menor preço/Maior preço/A–Z, com check); botão "Ver resultados".
- **Bottom-sheet de denúncia** (`sheet=denunciar`): "Denunciar preço" + 4 motivos com rádio; "Enviar denúncia" (→ toast) + Cancelar.
- **Diálogo de confirmação** (`dialog`): pop central (`popIn` .22s) com ícone, título, mensagem, **Cancelar** (contorno) / ação destrutiva `up`. Dois usos: excluir produto e excluir conta (textos diferentes).
- **Toast**: pílula `ink`/`bg` no rodapé (acima da tab bar), some sozinha (~2.4s). Usado em: alerta on/off, salvar edição, denúncia enviada, item/conta removido, cupom lido, notificações lidas, link enviado.

### Tab bar (persistente em inicio/verificar/produtos/perfil)
- 4 abas (Início, Verificar, Produtos, Perfil) + **FAB central** circular `ink` (ícone de scanner `bg`) sobreposto (−30px), borda `bg` 4px, abre `escanear`. Aba ativa em `ink`, inativa em `faint`. Não aparece nos overlays (onboarding/login/escanear/etc.).

---

## Interações & comportamento
- **Navegação:** estado `route`. Telas "empilháveis" (`detalhe`, `dashboard`, `escanear`, `notificacoes`, `conquistas`, `erro`, `processando`, `editar`, `compra`) guardam a origem em `prev`; o botão **Voltar** retorna a `prev`. No app, prefira a **navegação real** (React Navigation / Expo Router) com uma stack por aba, em vez de um único `route`.
- **Veredito ao vivo:** ao digitar em Verificar, faz match por palavra-chave no dataset; calcula `v=(valor-tipico)/tipico`; ≤ -5% → Barato/`down`, ≥ +5% → Caro/`up`, senão Na média/`mid`. Marcador da régua anima até `pct`.
- **Fluxo do scanner:** Escanear → `processando` (~1.7s) → sucesso: vai a Produtos com `loading=true` por ~1.2s (skeleton) + toast; ou falha: `erro`.
- **Animações (durações/easing):** entrada de tela `scrIn` 0.28s ease (fade+translateY 10px); overlay `ovIn` 0.2–0.25s; sheet `sheetUp` 0.28s cubic-bezier(.2,.9,.3,1); diálogo `popIn` 0.22s cubic-bezier(.2,1.2,.4,1); toast `toastIn` 0.25s; linha do scanner `scan` 1.8s alternate; skeleton `shimmer` 1.2s linear infinite; spinner `spin` 0.8s linear. **Respeite `prefers-reduced-motion`** (desliga animações) → no RN, `AccessibilityInfo.isReduceMotionEnabled`.
- **Toggles/toasts:** switches de alerta atualizam estado + toast; segmentado de tema troca o tema global na hora.

## Gestão de estado
Variáveis do protótipo (mapeie para navegação real + estado local/store no app):
`route`, `prev`, `theme` (`claro`|`escuro`), `query` (busca do Verificar), `prodQuery` (busca de Produtos), `cat`, `sort`, `sheet`, `dialog`, `loading`, `toast`, `sel` (item selecionado), `motivo` (índice do motivo de denúncia), `notifLidas`, `onb` (índice do slide), `alerta` (switch).

## Modelo de dados (exemplos usados)
Produtos com faixa de preço regional (para o veredito e a lista):
- Leite integral Italac 1 L — atual **4,79** · típico 5,49 · menor 4,59 · maior 6,29 · 214 cupons → **Barato -13%**
- Café Pilão 500 g — **24,90** · típico 20,90 · menor 18,90 · maior 25,50 · 187 cupons → **Caro +19%**
- Arroz Tio João 5 kg — **27,90** · típico 27,50 · menor 24,90 · maior 31,90 · 96 cupons → **Na média**
- Azeite Gallo 500 ml — **39,90** · típico 33,50 · 54 cupons → **Caro +19%**
- Sabão Omo 1,6 kg — **19,90** · típico 22,90 · 71 cupons → **Barato -13%**

Estes são dados de exemplo; no app vêm da API/base colaborativa. Moeda em pt-BR (`R$ 0,00`, vírgula decimal).

---

## Mapeamento para o repositório (`Comparai/app`)
O app já tem `ThemeContext` + `useTema().c` com **duas paletas de chaves idênticas** (`claro`/`escuro`) em `src/tema/cores.ts`, e nenhum componente deve ter hex fixo. A migração para 3a é **só trocar os valores das chaves existentes** — a estrutura e a maioria dos nomes servem. O 3a é **neutro**: a marca deixa de ser teal e passa a ser a própria tinta (`tinta`), então as chaves `teal*`/`marca*` recebem tons neutros.

### `src/tema/cores.ts` — novos valores por chave existente

| chave | claro (3a) | escuro (3a) | equivale a |
|---|---|---|---|
| `fundo` | `#F7F7F5` | `#111110` | bg |
| `cartao` | `#FFFFFF` | `#191918` | card |
| `cartaoBorda` | `#E7E7E3` | `rgba(255,255,255,.12)` | line |
| `linha` | `#F0F0EC` | `rgba(255,255,255,.08)` | line2 (divisória interna) |
| `borda` | `#E7E7E3` | `rgba(255,255,255,.12)` | line (bordas/inputs) |
| `tinta` | `#1B1B19` | `#F0F0EE` | ink |
| `suave` | `#6B6B66` | `#8F8F8A` | sub |
| `fraco` | `#A3A39D` | `#8F8F8A` | faint |
| `teal` / `marca` | `#1B1B19` | `#F0F0EE` | **vira a tinta** (botão primário) |
| `tealPressed` / `marcaForte` | `#000000` | `#FFFFFF` | pressed do primário |
| `tealWash` / `marcaBgClaro` | `#F0F0EC` | `rgba(255,255,255,.08)` | tile/ícone (line2) |
| `tealWash2` / `marcaBgMedio` | `#EDEDE8` | `rgba(255,255,255,.12)` | avatar/círculo |
| `tealBorda` / `marcaBorda` | `#E7E7E3` | `rgba(255,255,255,.12)` | line |
| `menta` | `#1B1B19` | `#F0F0EE` | acento → tinta (sem verde) |
| `sobreTeal` | `#FFFFFF` | `#111110` | texto sobre primário (= chipink) |
| `heroDe` / `heroPara` | `#1B1B19` / `#000000` | `#F0F0EE` / `#D8D8D4` | hero vira monocromático |
| `barato` / `baratoTexto` | `#16A34A` | `#4ADE80` | down |
| `baratoBg` | `#EAF6EE` | `rgba(74,222,128,.10)` | wash do "barato" |
| `baratoBorda` | `#C9EBD4` | `rgba(74,222,128,.28)` | — |
| `medio` / `naMedia` | `#D97706` | `#E8A33C` | **mid — âmbar (não é mais teal!)** |
| `naMediaBg` | `#FBF1DC` | `rgba(232,163,60,.12)` | wash da média |
| `caro` | `#DC2626` | `#F87171` | up |
| `caroBg` | `#FBEAE9` | `rgba(248,113,113,.12)` | wash do "caro" |
| `ambar`/`ambarBg`/`ambarTexto` | manter | manter | promoção (já é âmbar) |
| `tinta`→campo (`superficie`) | `#FFFFFF` | `#191918` | fld |
| `fraco`→placeholder | `#A3A39D` | `#8F8F8A` | faint |

> Aliases de compat (`texto`, `textoSuave`, `superficie`, `semDados`, etc.) devem apontar para os mesmos valores das chaves-mãe acima. **Ação-chave do 3a:** `naMedia`/`medio` sai do teal e passa a **âmbar** (`#D97706`), separando de vez o semáforo da cor de marca.

### `src/tema/tipografia.ts`
Trocar **Plus Jakarta Sans → Instrument Sans** (`@expo-google-fonts/instrument-sans`), mantendo as chaves de `fontes`:
```
regular:  'InstrumentSans_400Regular'
medium:   'InstrumentSans_500Medium'
semibold: 'InstrumentSans_600SemiBold'
bold:     'InstrumentSans_700Bold'
extrabold:'InstrumentSans_700Bold'  // Instrument Sans não tem 800; usar 700
```
Atualizar o carregamento em `App.tsx` (`useFonts`). A escala `tamanhos` do 3a é mais alta no topo — sugestão: `xs:11, sm:13, md:15, lg:17, xl:20, titulo:26, display:40`. Aplicar `fontVariant:['tabular-nums']` em todo texto de preço/estatística.

### Componentes
Reutilize os componentes já existentes em `src/` (botão, input, switch, bottom-sheet, tab bar) — **só troque os valores visuais** via `useTema().c`. Não introduza hex fixo. **Não** copie o HTML; use-o como referência de layout e medidas.

## Assets
Nenhum bitmap. Todos os ícones são SVG stroke (equivalentes Lucide/Feather). Logo = letra "B" tipográfica em quadrado. Fonte via Google Fonts (Instrument Sans).

## Screenshots (`screens/`)
Referência visual de cada tela/estado, capturada do protótipo. **Use junto com a spec da tela correspondente acima** — a imagem mostra o layout final; a tabela diz o que cada elemento faz e para onde leva.

| Arquivo | Tela (`route`) | O que mostra / interações-chave |
|---|---|---|
| `01-onboarding.png` | `onboarding` | Slide 1 de 3. Ícone em quadrado `chip`, dots, "Pular" (topo) e botão "Próximo"/"Começar" → `login`. |
| `02-login.png` | `login` | Painel `ink` + folha com E-mail/Senha. "Esqueci a senha" → `recuperar`; "Entrar"/Google/"Criar conta" → `inicio`. |
| `03-recuperar-senha.png` | `recuperar` | Campo e-mail + "Enviar link de redefinição" → toast + volta ao `login`. |
| `04-inicio.png` | `inicio` | Header (sino c/ badge → `notificacoes`; avatar → `perfil`). Card economia → `dashboard`. Card conquista → `conquistas`. Linhas de compras → `compra`. Tab bar + FAB → `escanear`. |
| `05-dashboard-economia.png` | `dashboard` | Segmentado de mês, gráfico de barras (jul em `ink`), barras por categoria. Voltar → origem. |
| `06-conquistas.png` | `conquistas` | Card de nível com progresso 4/6 + grid de badges (2 bloqueados tracejados). |
| `07-detalhe-compra.png` | `compra` | Cupom: total, economia (`down`), itens com veredito por item (barato/na média/caro). |
| `08-verificar-preco.png` | `verificar` ⭐ | Busca digitável (recalcula veredito ao vivo), chips rápidos, card do veredito com régua animada, "Denunciar" → sheet, "Ver histórico" → `detalhe`, "Avisar quando baixar" → toggle+toast. Ícone scanner no campo → `escanear`. |
| `09-produtos.png` | `produtos` | Busca + botão filtro (badge de ativos → sheet filtros). Linhas: preço tabular + variação (↓`down` / ↑`up` / "na média" `mid`). Kebab ⋮ → sheet ações. Item Leite → `detalhe`. |
| `10-sheet-acoes.png` | `produtos` + `sheet:acoes` | Bottom-sheet sobre backdrop: Editar → `editar`; Denunciar → sheet denúncia; Excluir → diálogo; Cancelar fecha. |
| `11-editar-produto.png` | `editar` | Header modal Cancelar/Salvar (toast), nome, chips de categoria, valor do alerta, switch monitorar, Excluir da lista → diálogo. |
| `12-sheet-filtros.png` | `produtos` + `sheet:filtros` | Chips de categoria, ordenação com check, "Limpar" e "Ver resultados" (aplica na lista). |
| `13-detalhe-produto.png` | `detalhe` | Típico da região, sparkline fev→jul, badge "em queda", "Onde comprar hoje" (badge MENOR/preços), switch de alerta. Kebab no header → sheet ações. |
| `14-dialogo-excluir.png` | `detalhe` + `dialog` | Diálogo de confirmação destrutivo: ícone, título, msg, **Cancelar** / **Excluir** (`up`). Mesmo padrão para excluir conta. |
| `15-perfil.png` | `perfil` | Avatar, região, lista: Conquistas (4/6), Notificações, switch Alertas, segmentado **Tema Claro/Escuro** (troca global), Privacidade, **Excluir conta** → diálogo. |
| `16-notificacoes.png` | `notificacoes` | Seções HOJE/ESTA SEMANA, itens com ícone + ponto de não-lida, "Marcar lidas" zera pontos. |
| `17-escanear.png` | `escanear` (overlay) | Câmera full-screen escura: moldura com cantos, linha de leitura animada, fechar (X), digitar chave. Sucesso → `processando` → Produtos; inválido → `processando` → `erro`. |
| `18-erro-leitura.png` | `erro` | Estado de erro: ícone alerta `up`, causa, "Tentar de novo" → `escanear`, "Voltar ao início". |
| `19-carregando-cupom.png` | `processando` | Loading overlay: spinner + "Lendo cupom…" (~1.7 s). |
| `20-produtos-skeleton.png` | `produtos` + `loading` | Skeleton shimmer (5 linhas) enquanto a lista carrega (~1.2 s pós-scan). |
| `21-produtos-toast.png` | `produtos` + toast | Toast pílula `ink` acima da tab bar ("Cupom lido · 12 itens adicionados"), some em ~2.4 s. |
| `22-perfil-dark.png` | `perfil` (escuro) | Tema escuro aplicado; segmentado com "Escuro" ativo. |
| `23-inicio-dark.png` | `inicio` (escuro) | Home no tema escuro — mesmos tokens, valores da paleta `escuro`. |
| `24-verificar-dark.png` | `verificar` (escuro) | Veredito no escuro: semáforo vira `#4ADE80`/`#F87171`/`#E8A33C`. |

> As capturas mostram o topo do frame 390×844; sheets/diálogos aparecem sobre a tela dimmed. Para ver qualquer estado completo e interativo, abra o `.dc.html`.

## Arquivos deste bundle
- `README.md` — este documento (auto-suficiente).
- `Barganha - Protótipo (referência).dc.html` — protótipo interativo hi-fi (abra no navegador; alterne tema no Perfil).
- `screens/` — 24 screenshots nomeados (tabela acima), claro + escuro, incluindo estados de loading, erro, sheets, diálogo e toast.
