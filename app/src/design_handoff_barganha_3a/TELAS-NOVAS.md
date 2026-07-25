# Telas novas — como funcionam

Complemento ao `README.md` (que tem a spec visual de cada tela). Aqui o foco é **o que a tela faz, o que o usuário consegue fazer nela e para onde ela leva** — em linguagem de produto.

## Abertura e cadastro

### Splash (`splash`)
Primeira coisa ao abrir o app. Só marca. Some sozinha em ~1,9s e cai no onboarding (ou toque para pular a espera). No app real, é a splash nativa.

### Criar conta (`criar`)
Alcançada pelo "Criar conta grátis" do Login. Usuário informa nome, e-mail e senha (ou Google). Ao criar, **não vai direto pro app** — segue para as Boas-vindas. Tem link "Já tem conta? Entrar" de volta ao Login.

### Boas-vindas pós-cadastro (`bemvindo`)
Confirma que a conta foi criada e já **configura os alertas** na hora: três chaves (avisar quando um produto baixar, ofertas perto de você, resumo mensal) e a **sensibilidade** (avisar a partir de 3%, 5% ou 10% abaixo do típico). Essa configuração é a mesma da tela Alertas do Perfil — mexeu aqui, reflete lá. "Tudo pronto" ou "Configurar depois" seguem para as permissões.

## Permissões

### Permissão de câmera (`permcam`)
Explica **por que** o app precisa da câmera (ler o QR Code do cupom; nada é gravado) antes de pedir. "Permitir câmera" segue para a permissão de localização. Se o usuário recusar, a tela vira o **estado negado**: explica o impacto e oferece "Abrir ajustes" ou a saída alternativa "Digitar chave manualmente".

### Permissão de localização (`permloc`)
Mesmo padrão: explica o uso (comparar preços com mercados da região e achar ofertas por perto). "Usar minha localização" entra no app. Recusando, o **estado negado** oferece escolher a região manualmente.

## Cupom

### Digitar chave de acesso (`chave`)
Saída para quando o QR Code não lê. Campo para os **44 dígitos** da NFC-e, com formatação em blocos de 4 e contador ao vivo (ex.: 32/44). O botão "Validar chave" só habilita com os 44 dígitos completos; incompleto, avisa. Validando, entra no mesmo fluxo de leitura do scanner. "Voltar para a câmera" retorna ao scanner.

### Cupom lido com sucesso (`sucesso`)
Fecha o fluxo de escaneamento com uma confirmação: check animado + resumo do cupom (loja, total, economia e quantos itens ficaram baratos/na média/caros, além da conquista ganha). Leva a "Ver detalhes do cupom" ou de volta ao início.

## Listas e comparação

### Lista de compras (`lista`) — aba inferior
Substitui a antiga aba "Produtos". Serve para montar a compra: mostra a **estimativa** do total pelos preços típicos (e quanto sairia no mercado mais barato). Cada item tem uma **caixa de seleção** (marca como "no carrinho") e um **campo para digitar o preço da gôndola** — ao digitar, aparece o veredito do item (abaixo/na média/acima) e o topo passa a somar o que já foi conferido. "+ Adicionar item" abre a busca.

### Adicionar item à lista (pop-up)
Bottom-sheet com **busca ao vivo**: digita parte do nome ("sabão") e aparecem os produtos que batem ("Sabão Omo", "Sabão líquido Ypê…") com o preço típico e um botão de adicionar. Mesma lógica de busca do Comparar mercados.

### Comparar mercados (`mercados`)
Responde "onde minha cesta sai mais barato?". O usuário **busca e adiciona produtos** (viram chips removíveis) e o app **ranqueia os mercados da região** pela soma dessa cesta: posição, distância, selo "Mais barato" no 1º, total e a diferença para o líder. Recalcula a cada item adicionado/removido.

### Histórico de compras (`compras`)
O "Ver tudo" do início. Lista todos os cupons agrupados por mês, com total do mês e, por linha, mercado/data/itens/economia. Tocar abre o detalhe daquele cupom.

## Perfil e ajustes

### Alertas de preço (`alertas`)
Versão editável a qualquer momento da configuração feita nas Boas-vindas (mesmos três switches + sensibilidade). "Salvar preferências" confirma.

### Configurações da conta (`conta`)
Dados pessoais (nome, e-mail, telefone mascarado), atalhos para editar dados/senha/privacidade e as ações de **sair** e **excluir conta** (com confirmação).

### Editar região (`regiao`)
Define a região usada nas comparações. Duas formas: **"Usar minha localização"** (detecta por GPS) ou **busca manual** de bairro/cidade (a lista só aparece ao digitar). Também define o **raio** das comparações (1/3/5 km).

### Ajuda e suporte (`ajuda`)
Busca na central + **FAQ em acordeão** (perguntas que expandem) + canais de contato (falar com suporte, enviar sugestão, reportar problema).

### Detalhe da conquista (`conquistadet`)
Abre ao tocar num selo em Conquistas. Mostra o ícone grande, se está desbloqueada ou bloqueada, a descrição, a **barra de progresso** (ex.: "faltam R$ 368") e a recompensa.

## Estados de sistema

### Primeiro uso / estados vazios (`primeiroUso`)
Como o app se parece no "dia 1", sem nenhum cupom ainda. Início, Produtos, Lista e Dashboard mostram uma versão sem dados, cada uma convidando a escanear o primeiro cupom (o Início traz também um "como funciona" em 3 passos). Assim que há dados, viram as telas cheias.

### Sem conexão (`offline`)
Aparece quando falta internet. Explica que a base de preços é colaborativa e precisa de rede, oferece "Tentar de novo" e tranquiliza: os cupons já escaneados ficam salvos e sincronizam quando a conexão voltar.

---

**Para navegar qualquer uma no protótipo:** abra o `.dc.html` e, no console, use `window.__go('rota', {…estado})` — ex.: `window.__go('permcam', {camNeg:true})`, `window.__go('inicio', {primeiroUso:true})`, `window.__go('mercados')`.
