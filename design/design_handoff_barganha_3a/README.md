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
| `splash` | Splash de abertura | abertura do app (auto → onboarding em ~1.9s) |
| `onboarding` | Onboarding (3 slides) | após o splash |
| `login` | Login | fim do onboarding / "Pular" |
| `criar` | Criar conta | Login → "Criar conta grátis" |
| `bemvindo` | Boas-vindas pós-cadastro (configura alertas) | após criar conta |
| `recuperar` | Recuperar senha | Login → "Esqueci a senha" |
| `permcam` | Permissão de câmera (priming + negada) | após entrar / concluir boas-vindas |
| `permloc` | Permissão de localização (priming + negada) | após permitir câmera |
| `inicio` | Início (home) | após permissões |
| `notificacoes` | Notificações | sino no header do Início / Perfil |
| `conquistas` | Conquistas e prêmios | card no Início / Perfil |
| `conquistadet` | Detalhe da conquista | tap num badge em Conquistas |
| `verificar` | Verificar preço ⭐ | aba inferior |
| `escanear` | Escanear cupom (câmera) | FAB central |
| `chave` | Digitar chave de acesso (NFC-e) | Escanear → "Digitar chave" |
| `processando` | Lendo cupom… (loading) | após "Simular leitura" / validar chave |
| `sucesso` | Cupom lido com sucesso | após leitura/validação OK |
| `erro` | Erro de leitura | após "Simular cupom inválido" |
| `produtos` | Produtos (lista) | atalho na Lista / fluxos internos |
| `editar` | Editar produto | kebab → Editar |
| `detalhe` | Detalhe do produto | item "Leite" em Produtos / Verificar |
| `lista` | Lista de compras | **aba inferior** ("Lista") |
| `mercados` | Comparar mercados (região) | card no Início / atalho |
| `compras` | Histórico de compras ("Ver tudo") | Início → "Ver tudo" |
| `compra` | Detalhe da compra (cupom) | item de compra no Início / histórico |
| `dashboard` | Resumo de economia | card de economia no Início |
| `perfil` | Perfil / ajustes | aba inferior / avatar |
| `alertas` | Alertas de preço (configuração) | Perfil → Alertas de preço |
| `conta` | Configurações da conta | Perfil → Configurações da conta |
| `regiao` | Editar região (GPS + busca) | Perfil → card de região |
| `ajuda` | Ajuda e suporte (FAQ) | Perfil → Ajuda e suporte |
| `offline` | Sem conexão | erro de rede / demo em Perfil |

**Estados vazios (primeiro uso, "dia 1"):** a flag `primeiroUso` troca **Início, Produtos, Lista e Dashboard** por suas versões sem dados (mesma `route`, conteúdo vazio + CTA de escanear). Alternável em Perfil → Estados (demo).

Sobrepostos (não são `route`, são flags de estado): **bottom-sheets** (`sheet` = `acoes` \| `filtros` \| `denunciar` \| `addItem`), **diálogo de confirmação** (`dialog` = `produto` \| `conta`) e **toast**.

**Permissões:** `permcam`/`permloc` têm sub-estado de **negada** (`camNeg`/`locNeg`) — muda ícone, textos e ações (priming → "Permitir"; negada → "Abrir ajustes" / alternativa manual).

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
- Avatar "D" + nome/email. Card de região (Rio · Tijuca → `regiao`). Lista de ajustes: Conquistas (4/6 → `conquistas`), Notificações (→ `notificacoes`), **Alertas de preço** (→ `alertas`, resumo "N ativos"), **Tema** (segmentado Claro/Escuro — controla o tema do app inteiro), **Configurações da conta** (→ `conta`), **Ajuda e suporte** (→ `ajuda`). Seção **Estados (demo)**: primeiro uso, rever permissões, sem conexão (atalhos só-protótipo). Rodapé "BARGANHA V2.0.1 · BASE COLABORATIVA".

### Splash de abertura (`splash`)
- Overlay `ink` full-screen com logo "B" (quadrado `bg`, animação `popIn`) + wordmark `bg` + tagline. Auto-avança para `onboarding` em ~1.9s (ou ao tocar). No app: tela nativa de splash / primeiro frame.

### Criar conta (`criar`)
- Mesma linguagem do Login (painel `ink` + folha `bg`). Campos Nome/E-mail/Senha (placeholders), botão **Criar conta** + **Continuar com Google**, nota de Termos/Privacidade, rodapé "Já tem conta? Entrar" (→ `login`). Criar → `bemvindo`.

### Boas-vindas pós-cadastro (`bemvindo`)
- Selo de check (`chip`), "Bem-vindo, Douglas!", e **configuração de alertas** já no onboarding: 3 switches (quando baixar / ofertas perto / resumo mensal) + **sensibilidade** segmentada (3% / 5% / 10% abaixo do típico). Compartilha estado (`bvAlertas`, `bvSens`) com a tela `alertas`. "Tudo pronto, começar" / "Configurar depois" → `permcam`.

### Permissão de câmera (`permcam`)
- Priming full-screen: ícone câmera em quadrado `chip`, título "Precisamos da câmera", explicação de uso (só no escaneamento, nada gravado). Primária **Permitir câmera** (→ `permloc`); secundária "Agora não" (→ estado **negada**).
- **Negada** (`camNeg`): ícone `line2`/`faint`, "Câmera bloqueada", primária **Abrir ajustes** (toast), secundária **Digitar chave manualmente** (→ `chave`).

### Permissão de localização (`permloc`)
- Priming: ícone pin, "Ative sua localização", uso (comparar mercados da região / ofertas por perto). Primária **Usar minha localização** (→ `inicio` + toast); secundária "Escolher manualmente" (→ **negada**).
- **Negada** (`locNeg`): "Localização desativada", primária **Escolher região manual** (→ `regiao`), secundária "Agora não" (→ `inicio`).

### Digitar chave de acesso (`chave`)
- Alternativa ao QR: textarea para os **44 dígitos** da NFC-e com formatação em blocos de 4 e **contador ao vivo** (N/44). Dica de onde achar a chave. **Validar chave** só habilita com 44 dígitos (incompleto → toast); válido → `processando` → Produtos. "Voltar para a câmera" → `escanear`.

### Cupom lido com sucesso (`sucesso`)
- Selo de check animado (`popIn`), "Cupom lido com sucesso!", card-resumo do cupom (loja/data, total, economia `down`, contagem baratos/na média/caros + conquista). "Ver detalhes do cupom" (→ `compra`) / "Voltar ao início".

### Lista de compras (`lista`) — aba
- Card de **estimativa** da lista (total pelos típicos + "no Assaí sai por R$ …"). Itens com **checkbox** (marca "no carrinho", line-through) e **campo de preço da gôndola** por item (placeholder = típico) → veredito ao vivo por item; ao preencher, o topo mostra "NA GÔNDOLA ATÉ AGORA" somando qtd×preço. "+ Adicionar item" abre o sheet `addItem`.
- **Vazia** (`primeiroUso`): estado vazio com ícone checklist + "Adicionar item".

### Adicionar item à lista (`sheet:addItem`)
- Bottom-sheet com **busca ao vivo** no catálogo (digita "sabão" → "Sabão Omo 1,6 kg", "Sabão líquido Ypê 5 L" com típico e botão +). Sem texto → catálogo; sem match → vazio. Mesma lógica de busca do Comparar mercados. "Concluir" fecha.

### Comparar mercados (`mercados`)
- **Busca** de produto com sugestões ao vivo; selecionados viram **chips removíveis** (×). Ranking dos mercados da região pela cesta selecionada: posição, distância, badge **MAIS BARATO** no 1º, total (tabular), diferença vs. o 1º e barra proporcional de custo. Estado vazio orienta a buscar. Recalcula por seleção.

### Histórico de compras (`compras`)
- "Ver tudo" do Início: cupons agrupados por mês (JULHO/JUNHO) com total mensal; cada linha = mercado, data·itens, total e economia. Tap → `compra`.

### Alertas de preço (`alertas`)
- Mesma UI da `bemvindo` (3 switches + sensibilidade), compartilhando `bvAlertas`/`bvSens`. "Salvar preferências" → volta + toast.

### Configurações da conta (`conta`)
- Dados pessoais (nome, e-mail, telefone mascarado) + editar dados/senha/privacidade; **Sair da conta** (→ `login`) e **Excluir conta** (→ diálogo `conta`).

### Editar região (`regiao`)
- **Usar minha localização** (GPS → toast "Tijuca") e **busca manual** que só revela resultados ao digitar (com estado vazio). Seleção por rádio + **raio das comparações** (1/3/5 km). "Salvar região".

### Ajuda e suporte (`ajuda`)
- Busca + **FAQ em acordeão** (expande/recolhe) + "Fale com a gente" (suporte, sugestão, reportar). Rodapé com e-mail de suporte.

### Detalhe da conquista (`conquistadet`)
- Ícone grande, nome, status (Desbloqueada/Bloqueada), descrição, **barra de progresso** com nota (ex.: "Faltam R$ 368") e recompensa. Vale para as 6 conquistas (incl. bloqueadas).

### Sem conexão (`offline`)
- Estado full-screen: ícone wi-fi cortado, "Você está sem conexão", explicação (base colaborativa precisa de internet), **Tentar de novo** + nota de que cupons já escaneados ficam salvos e sincronizam depois.

### Estados vazios / primeiro uso (`primeiroUso`)
- **Início vazio:** hero `ink` "Escaneie seu primeiro cupom" + CTA + passos "COMO FUNCIONA" (1-2-3). **Produtos vazio / Lista vazia / Dashboard vazio:** ícone `line2`, título, texto e CTA de escanear/adicionar. Mesma `route`, sem dados.

### Padrões sobrepostos
- **Bottom-sheet de ações** (`sheet=acoes`): título do item + Editar / Denunciar preço incorreto / Excluir da lista (`up`) + **Cancelar**. Entra com slide-up (`sheetUp` .28s) sobre backdrop.
- **Bottom-sheet de filtros** (`sheet=filtros`): "Filtrar e ordenar" + "Limpar"; chips de **Categoria** (Todos/Laticínios/Café/Grãos/Mercearia/Limpeza); **Ordenar por** (Padrão/Menor preço/Maior preço/A–Z, com check); botão "Ver resultados".
- **Bottom-sheet de denúncia** (`sheet=denunciar`): "Denunciar preço" + 4 motivos com rádio; "Enviar denúncia" (→ toast) + Cancelar.
- **Diálogo de confirmação** (`dialog`): pop central (`popIn` .22s) com ícone, título, mensagem, **Cancelar** (contorno) / ação destrutiva `up`. Dois usos: excluir produto e excluir conta (textos diferentes).
- **Toast**: pílula `ink`/`bg` no rodapé (acima da tab bar), some sozinha (~2.4s). Usado em: alerta on/off, salvar edição, denúncia enviada, item/conta removido, cupom lido, notificações lidas, link enviado.

### Tab bar (persistente em inicio/verificar/lista/perfil)
- 4 abas (**Início, Verificar, Lista, Perfil**) + **FAB central** circular `ink` (ícone de scanner `bg`) sobreposto (−30px), borda `bg` 4px, abre `escanear`. Aba ativa em `ink`, inativa em `faint`. Não aparece nos overlays (splash/onboarding/login/criar/bemvindo/permissões/escanear/chave/etc.).
- **Nota:** a aba antiga "Produtos" foi substituída por **"Lista"** (ícone de checklist). A tela `produtos` continua existindo e é alcançada por atalho dentro da Lista e pelos fluxos de scan/verificação — só não tem mais item próprio na tab bar.

---

## Interações & comportamento
- **Navegação:** estado `route`. Telas "empilháveis" (`detalhe`, `dashboard`, `escanear`, `notificacoes`, `conquistas`, `erro`, `processando`, `editar`, `compra`) guardam a origem em `prev`; o botão **Voltar** retorna a `prev`. No app, prefira a **navegação real** (React Navigation / Expo Router) com uma stack por aba, em vez de um único `route`.
- **Veredito ao vivo:** ao digitar em Verificar, faz match por palavra-chave no dataset; calcula `v=(valor-tipico)/tipico`; ≤ -5% → Barato/`down`, ≥ +5% → Caro/`up`, senão Na média/`mid`. Marcador da régua anima até `pct`.
- **Fluxo do scanner:** Escanear → `processando` (~1.7s) → sucesso: vai a Produtos com `loading=true` por ~1.2s (skeleton) + toast; ou falha: `erro`.
- **Animações (durações/easing):** entrada de tela `scrIn` 0.28s ease (fade+translateY 10px); overlay `ovIn` 0.2–0.25s; sheet `sheetUp` 0.28s cubic-bezier(.2,.9,.3,1); diálogo `popIn` 0.22s cubic-bezier(.2,1.2,.4,1); toast `toastIn` 0.25s; linha do scanner `scan` 1.8s alternate; skeleton `shimmer` 1.2s linear infinite; spinner `spin` 0.8s linear. **Respeite `prefers-reduced-motion`** (desliga animações) → no RN, `AccessibilityInfo.isReduceMotionEnabled`.
- **Toggles/toasts:** switches de alerta atualizam estado + toast; segmentado de tema troca o tema global na hora.

## Gestão de estado
Variáveis do protótipo (mapeie para navegação real + estado local/store no app):
`route`, `prev`, `theme` (`claro`|`escuro`), `query` (busca do Verificar), `prodQuery` (busca de Produtos), `cat`, `sort`, `sheet` (inclui `addItem`), `dialog`, `loading`, `toast`, `sel`, `motivo`, `notifLidas`, `onb`, `alerta`, `primeiroUso` (estados vazios dia-1), `camNeg`/`locNeg` (permissão negada), `chave` (dígitos da NFC-e), `bvAlertas`/`bvSens` (config de alertas, compartilhada Boas-vindas↔Alertas), `regQuery`/`regiaoSel`/`regRaio` (região), `mercQuery`/`mercSelNames` (comparar mercados), `addQuery` (busca do sheet adicionar), `listaMarcados`/`listaPrecos` (checkbox + preço da gôndola por item), `faqOpen`, `conquistaSel`.

> Atalho de inspeção no protótipo: `window.__go('rota', {…estado})` força qualquer tela/estado (usado para gerar os screenshots).

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

| Arquivo | Tela (`route`/estado) | O que mostra / interações-chave |
|---|---|---|
| `01-splash.png` | `splash` | Abertura: logo "B" + wordmark. Auto → `onboarding` (~1.9s). |
| `02-onboarding.png` | `onboarding` | Slide 1 de 3, dots, "Pular" → `login`, "Próximo"/"Começar". |
| `03-login.png` | `login` | Painel `ink` + folha E-mail/Senha. "Esqueci a senha" → `recuperar`; "Criar conta" → `criar`; entrar → `permcam`. |
| `04-criar-conta.png` | `criar` | Nome/E-mail/Senha + Google + termos. Criar → `bemvindo`. |
| `05-bem-vindo.png` | `bemvindo` | Configura alertas (3 switches + sensibilidade 3/5/10%). → `permcam`. |
| `06-permissao-camera.png` | `permcam` | Priming da câmera. "Permitir" → `permloc`; "Agora não" → negada. |
| `07-permissao-camera-negada.png` | `permcam` + `camNeg` | Bloqueada: "Abrir ajustes" / "Digitar chave manualmente" → `chave`. |
| `08-permissao-localizacao.png` | `permloc` | Priming da localização. "Usar minha localização" → `inicio`. |
| `09-permissao-localizacao-negada.png` | `permloc` + `locNeg` | Desativada: "Escolher região manual" → `regiao`. |
| `10-inicio.png` | `inicio` | Card economia → `dashboard`; conquista → `conquistas`; "Ver tudo" → `compras`; compras → `compra`; Comparar mercados → `mercados`. |
| `11-inicio-primeiro-uso.png` | `inicio` + `primeiroUso` | Estado dia-1: hero "Escaneie seu primeiro cupom" + "COMO FUNCIONA". |
| `12-verificar-preco.png` | `verificar` ⭐ | Busca digitável recalcula veredito ao vivo, régua animada, chips, "Denunciar", "Avisar quando baixar". |
| `13-escanear.png` | `escanear` (overlay) | Câmera: moldura + linha animada; "Digitar chave" → `chave`; simular leitura/erro. |
| `14-digitar-chave.png` | `chave` | 44 dígitos, contador ao vivo, "Validar chave" (habilita em 44). |
| `15-cupom-sucesso.png` | `sucesso` | Check + resumo do cupom (total, economia, contagem). → `compra` / início. |
| `16-erro-leitura.png` | `erro` | Erro: "Tentar de novo" → `escanear`. |
| `17-produtos.png` | `produtos` | Atalho Lista + busca/filtro; linhas com variação (↓`down`/↑`up`/"na média"). Kebab → sheet; Leite → `detalhe`. |
| `18-produtos-vazio.png` | `produtos` + `primeiroUso` | Vazio: "Nenhum produto ainda" + escanear. |
| `19-detalhe-produto.png` | `detalhe` | Típico da região, sparkline fev→jul, "Onde comprar hoje", switch de alerta. |
| `20-editar-produto.png` | `editar` | Cancelar/Salvar, categoria, valor do alerta, monitorar, Excluir → diálogo. |
| `21-lista-compras.png` | `lista` (aba) | Estimativa + itens com checkbox e **preço da gôndola** (veredito por item). "+ Adicionar item" → sheet. |
| `22-lista-vazia.png` | `lista` + `primeiroUso` | Vazio: "Sua lista está vazia" + "Adicionar item". |
| `23-adicionar-item.png` | `lista` + `sheet:addItem` | Sheet de busca ao vivo ("sabão" → sugestões + botão +). |
| `24-comparar-mercados.png` | `mercados` | Busca de produto, chips removíveis, ranking por cesta com "MAIS BARATO" e barras. |
| `25-historico-compras.png` | `compras` | "Ver tudo": cupons por mês (JUL/JUN), tap → `compra`. |
| `26-detalhe-compra.png` | `compra` | Cupom: total, economia, itens com veredito por item. |
| `27-dashboard.png` | `dashboard` | Segmentado de mês, gráfico de barras, barras por categoria. |
| `28-dashboard-vazio.png` | `dashboard` + `primeiroUso` | Vazio: "Ainda sem dados" + escanear. |
| `29-perfil.png` | `perfil` | Região → `regiao`; Alertas → `alertas`; Conta → `conta`; Ajuda → `ajuda`; Tema; Estados (demo). |
| `30-alertas.png` | `alertas` | 3 switches + sensibilidade (compartilha estado com boas-vindas). |
| `31-config-conta.png` | `conta` | Dados pessoais + sair/excluir conta (→ diálogo). |
| `32-editar-regiao.png` | `regiao` | "Usar minha localização" (GPS) + busca manual + raio (1/3/5 km). |
| `33-ajuda-suporte.png` | `ajuda` | Busca + FAQ acordeão (aberto) + "Fale com a gente". |
| `34-notificacoes.png` | `notificacoes` | HOJE/ESTA SEMANA, pontos de não-lida, "Marcar lidas". |
| `35-conquistas.png` | `conquistas` | Nível + grid de badges (2 bloqueados). Tap → `conquistadet`. |
| `36-conquista-detalhe.png` | `conquistadet` | Ícone, status, progresso + recompensa. |
| `37-sheet-acoes.png` | `produtos` + `sheet:acoes` | Editar / Denunciar / Excluir / Cancelar. |
| `38-sheet-filtros.png` | `produtos` + `sheet:filtros` | Categoria + ordenação (check) + "Ver resultados". |
| `39-sheet-denunciar.png` | `produtos` + `sheet:denunciar` | 4 motivos (rádio) + "Enviar denúncia". |
| `40-dialogo-excluir.png` | `conta` + `dialog:conta` | Confirmação destrutiva: Cancelar / Excluir (`up`). |
| `41-sem-conexao.png` | `offline` | Wi-fi cortado, "Tentar de novo". |
| `42-inicio-dark.png` | `inicio` (escuro) | Home no tema escuro. |
| `43-verificar-dark.png` | `verificar` (escuro) | Veredito no escuro (`#4ADE80`/`#F87171`/`#E8A33C`). |
| `44-perfil-dark.png` | `perfil` (escuro) | Perfil no tema escuro. |
| `45-dashboard-dark.png` | `dashboard` (escuro) | Dashboard no tema escuro. |

> As capturas mostram o topo do frame; sheets/diálogos aparecem sobre a tela dimmed. Para ver qualquer estado completo e interativo, abra o `.dc.html` (todas as rotas podem ser forçadas via `window.__go('rota', {…estado})` no console).

## Arquivos deste bundle
- `README.md` — este documento (auto-suficiente).
- `Barganha - Protótipo (referência).dc.html` — protótipo interativo hi-fi (abra no navegador; alterne tema no Perfil).
- `support.js` — runtime do protótipo (necessário ao lado do `.dc.html`).
- `screens/` — 45 screenshots nomeados (tabela acima), claro + escuro, incluindo onboarding, permissões, estados vazios (dia 1), loading, erro, sucesso, sheets, diálogo e offline.
