/**
 * Painel do Barganha — o MAPA (fonte da verdade curada).
 *
 * Este arquivo é a única coisa que se escreve à mão. O gerador (`gerar.mjs`) lê
 * daqui, CONFERE cada evidência contra o repositório e emite `painel/index.html`.
 *
 * Por que existe: status ("pronto / parcial / falta") e regra de negócio não são
 * deriváveis do código — nenhum grep sabe que a UI da economia real está de
 * propósito esperando cobertura de dados. O que É derivável (rota existe? arquivo
 * existe? tela nova apareceu?) o gerador confere sozinho e denuncia a divergência.
 *
 * COMO MANTER (a regra é uma só):
 *   ao mexer no código, mexa no item correspondente aqui e rode `npm run painel`.
 *   Se você esquecer, o gerador acusa: evidência que sumiu vira ⚠ no painel, e
 *   rota/tela nova que ninguém mapeou aparece na lista "novo no código".
 *
 * Campos de cada item:
 *   status    'pronto' | 'parcial' | 'falta' | 'planejado'
 *   falta     o que ainda falta (obrigatório quando status é 'parcial')
 *   arquivos  caminhos reais — o gerador confere se existem
 *   rotas     'POST /consulta/preco' — o gerador confere se está registrada
 */

export const meta = {
  nome: 'Barganha',
  subtitulo: 'app de comparação colaborativa e anônima de preços de mercado (NFC-e)',
  pasta: 'Comparai',
  objetivo: 'Dizer na gôndola se o preço está barato, na média ou caro — por unidade comparável.',
};

/* ────────────────────────────────────────────────────────────────────────────
   1. BLOQUEADORES — o que impede publicar HOJE. Ordem = ordem de ataque.
   ──────────────────────────────────────────────────────────────────────────── */

export const bloqueadores = [
  // b1 (o `production` do EAS apontava para o placeholder `api.barganha.app`)
  // foi resolvido em 12/08/2026: os dois perfis de build agora apontam para
  // `https://barganha-api.onrender.com`, a URL real do Render. O domínio
  // próprio continua não existindo — quando existir, é trocar nos DOIS perfis
  // (docs/13 §C10.1, passo 4) e não em um só, que era exatamente o descuido
  // que criou este bloqueador. O passo da fase 0 virou `feito`.
  // b2 (a versão do app era 0.0.0) foi resolvido em 11/08/2026: `version:
  // "1.0.0"` em app/app.json. O `runtimeVersion` continua na policy
  // `appVersion`, então o runtime do EAS Update passa a ser 1.0.0 — e como o
  // `autoIncrement` do perfil `production` mexe só no versionCode/buildNumber
  // (que o `appVersionSource: remote` administra), o runtime só muda quando
  // alguém subir a versão de propósito. O passo da fase 0 virou `feito`.
  {
    id: 'b4',
    titulo: 'A conta de desenvolvedor da Google Play não existe',
    gravidade: 'alta',
    porque:
      'É o único gasto pré-lançamento (US$ 25, uma vez) e o relógio dos 14 dias de teste fechado só começa a contar depois de a faixa estar criada e os testadores entrarem. Sem isso, nada mais na fila de publicação anda.',
    resolver:
      'Criar a conta, criar o app "Barganha", preencher política/Data Safety/classificação (respostas prontas em docs/14) e abrir a faixa de teste fechado.',
    arquivos: ['docs/14-conformidade-play-store.md', 'docs/15-beta-fechado.md'],
    esforco: '1 dia',
    prompt:
      'Preciso criar a conta de desenvolvedor da Google Play (US$ 25, ação manual no console — você não consegue fazer isso sozinho). Me guia passo a passo: o que preencher na conta, como criar o app "Barganha", e cola as respostas prontas de docs/14-conformidade-play-store.md e docs/15-beta-fechado.md conforme eu for preenchendo o console. No final, atualiza o bloqueador b4 em painel/mapa.mjs e roda `npm run painel`.',
  },
  {
    id: 'b5',
    titulo: 'A captura do RJ nunca foi validada num aparelho de verdade',
    gravidade: 'alta',
    porque:
      'O portal do RJ é protegido por reCAPTCHA e a captura passa por WebView. A recusa do captcha já é tratada (vira 422 `erro_portal` + recarga automática), mas isso foi validado em teste, não no device. Se o RJ falhar no beta, os testadores não conseguem escanear nada — e o beta é também a semeadura da base.',
    resolver:
      'Rodar o dev build no aparelho e escanear cupons reais do RJ até ver a recuperação do captcha acontecendo sozinha. É o pré-requisito nº 1 do gate do beta.',
    arquivos: ['app/src/componentes/ColetorNotaWeb.tsx', 'backend/src/parsers/rj.ts'],
    esforco: '1 sessão de teste',
    prompt:
      'Preciso validar a captura do RJ num aparelho físico (ação manual — você não consegue escanear um cupom por mim). Me ajuda a preparar: sobe o dev build (`cd app && npx expo start --dev-client` ou o comando certo do EAS dev build), abre o log do backend pra eu escanear cupons reais do RJ e a gente acompanhar junto se a recuperação automática do captcha (422 erro_portal + recarga) funciona igual no teste automatizado. No final, atualiza o bloqueador b5 em painel/mapa.mjs (e a jornada j-escanear se algo mudou) e roda `npm run painel`.',
  },
  {
    id: 'b6',
    titulo: 'Ativar em produção a cifra das colunas privadas do Postgres (gate da Fase 3)',
    gravidade: 'media',
    porque:
      'O envelope está implementado (AES-256-GCM em Node, chave fora do banco), a migração e os testes estão prontos, e o procedimento de rotação foi escrito e auditado pelo gate de privacidade (docs/19 §8) — mas nada disso está LIGADO. A produção segue com `chave_acesso`/descrição em claro até a migração ser aplicada e `CIFRA_CHAVE_ATUAL` ser configurada no Render. É proposital: os dois passos têm que acontecer juntos (aplicar sem a variável derruba a ingestão; configurar a variável sem a migração não tem coluna pra escrever), e ativar antes do beta fechado não compra nada com a base ainda vazia.',
    resolver:
      'Quando o gate da Fase 3 (beta fechado, docs/15) chegar: gerar a chave-mestra (`gerarChaveEnv`), aplicar `supabase db push` em produção e configurar `CIFRA_CHAVE_ATUAL` no Render na MESMA janela — procedimento completo (passos 1 e 2) em docs/19-ambientes-e-endurecimento.md §8.',
    arquivos: [
      'backend/src/seguranca/cifra.ts',
      'supabase/migrations/20260808090000_cifra_dados_privados.sql',
      'docs/19-ambientes-e-endurecimento.md',
    ],
    esforco: '15 min de execução (design e implementação já prontos)',
    prompt:
      'Preciso ativar em produção a cifra das colunas privadas (b6) — ação manual de infraestrutura, só rode isto quando o gate da Fase 3 (docs/15-beta-fechado.md) for alcançado. Me guia: gerar a chave-mestra com `gerarChaveEnv` (backend/src/seguranca/cifra.ts), aplicar a migração `20260808090000_cifra_dados_privados.sql` em produção (projeto Supabase de produção, ver docs/19 §0) e configurar `CIFRA_CHAVE_ATUAL` no Render NA MESMA janela de deploy — passo a passo em docs/19-ambientes-e-endurecimento.md §8. Depois atualiza o bloqueador b6 em painel/mapa.mjs (agora sim removendo-o) e roda `npm run painel`.',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   2. O FLUXO — dois diagramas: a jornada do dado e o momento da gôndola.
   ──────────────────────────────────────────────────────────────────────────── */

export const trilha = {
  titulo: 'Do cupom ao veredito',
  legenda:
    'O caminho completo do dado. A faixa do meio é onde nada mais sabe quem você é — o anonimizador é o portão, e ele não tem porta dos fundos.',
  zonas: [
    {
      id: 'aparelho',
      nome: 'No seu aparelho',
      nota: 'Funciona sem internet.',
      passos: [
        { nome: 'Escanear o QR', sub: 'O conteúdo cru é gravado antes de tudo', funcao: 'scanner' },
        { nome: 'Fila local', sub: 'Espera o sinal voltar, sem duplicar', funcao: 'fila-upload' },
      ],
    },
    {
      id: 'servidor',
      nome: 'No servidor',
      nota: 'Parsing nunca roda no app.',
      passos: [
        {
          nome: 'Guardar o QR',
          sub: 'De qualquer estado, desde o dia 1',
          funcao: 'ingestao-qr',
          rota: 'POST /ingestao/qr',
        },
        {
          nome: 'Parser do estado',
          sub: 'RJ · SP · MG · ENCAT, consultando a SEFAZ',
          funcao: 'parsers',
        },
      ],
    },
    {
      id: 'fronteira',
      nome: 'A fronteira',
      nota: 'Decisão travada nº 3.',
      fronteira: true,
      passos: [
        {
          nome: 'Anonimizador',
          sub: 'Descarta o CPF e solta os itens da cesta',
          funcao: 'anonimizador',
          saidas: [
            { rotulo: 'Privado', texto: 'Suas notas, com a chave de acesso, ligadas a você' },
            { rotulo: 'Compartilhado', texto: 'Preços soltos, sem usuário, sem chave' },
          ],
        },
      ],
    },
    {
      id: 'estatistica',
      nome: 'A base coletiva',
      nota: 'Mediana, nunca média.',
      passos: [
        {
          nome: 'Agregação',
          sub: 'Mediana, p25/p75, peso por idade, promoção à parte',
          funcao: 'agregacao',
        },
        { nome: 'Escopos geo', sub: 'Loja → município → região → UF', funcao: 'escopos' },
      ],
    },
    {
      id: 'volta',
      nome: 'De volta ao aparelho',
      nota: 'Só o que mudou.',
      passos: [
        {
          nome: 'Delta sync',
          sub: 'Recorte do seu histórico + sua lista',
          funcao: 'delta-sync',
          rota: 'POST /sync/estatisticas',
        },
        {
          nome: 'Cache local',
          sub: 'É o que faz o veredito funcionar offline',
          funcao: 'cache-local',
        },
        {
          nome: 'Veredito na gôndola',
          sub: 'Barato · na média · caro',
          funcao: 'verificar',
          destaque: true,
        },
      ],
    },
  ],
};

export const funil = {
  titulo: 'Como sai o veredito',
  legenda:
    'Duas perguntas, nesta ordem. O veredito só sai quando as duas concordam — e o preço da prateleira nunca é comparado contra a melhor promoção histórica.',
  entradas: [
    { rotulo: 'Faixa da região', sub: 'do pool anônimo, no recorte mais específico com dados' },
    { rotulo: 'Faixa pessoal', sub: 'do seu histórico no aparelho, quando existe' },
  ],
  portas: [
    {
      n: 1,
      pergunta: 'A diferença importa?',
      regra:
        '|preço − mediana| ÷ mediana tem de passar de 5% — mais 0,8% por mês de idade do dado.',
      naoPassou: { rotulo: 'NA MÉDIA', tom: 'warn', nota: 'Perto do típico, é típico.' },
    },
    {
      n: 2,
      pergunta: 'Para que lado?',
      regra:
        'Agora sim os percentis decidem — eles respeitam a dispersão real do produto, que um % fixo não saberia.',
      saidas: [
        { rotulo: 'BARATO', tom: 'ok', nota: 'abaixo do p25' },
        { rotulo: 'NA MÉDIA', tom: 'warn', nota: 'entre p25 e p75' },
        { rotulo: 'CARO', tom: 'bad', nota: 'acima do p75' },
      ],
    },
  ],
  cortes: [
    {
      rotulo: 'Sem dados',
      quando:
        'menos de 1 observação, ou dado além da janela de 180 dias — o app cala em vez de errar.',
    },
    { rotulo: 'Poucos dados', quando: 'menos de 3 observações: aparece com ressalva.' },
    {
      rotulo: 'Dado velho',
      quando: 'típico com mais de 30 dias, ou idade desconhecida: ressalva de desatualizado.',
    },
    {
      rotulo: 'Menor visto',
      quando: 'a promoção vai numa linha separada, nunca dentro do típico.',
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────────
   2b. JORNADAS — cada função do início ao fim, passo a passo.

   Para conferir se o app faz o que se quer que ele faça. Cada passo é uma
   AFIRMAÇÃO sobre o comportamento real, verificável no arquivo citado: dá para
   ler e responder "é isso" ou "não é isso que eu quero".

   `onde` diz em que máquina o passo roda — é o campo que revela coisas como
   "aqui abre um navegador dentro do celular":
     aparelho  · o app, no celular
     navegador · WebView em tela cheia dentro do app
     servidor  · o backend
     sefaz     · o portal público do estado
     banco     · Postgres/Supabase
   ──────────────────────────────────────────────────────────────────────────── */

export const jornadas = [
  {
    id: 'j-escanear',
    titulo: 'Escanear um cupom fiscal',
    resumo:
      'A função principal. O caminho completo do toque no botão até o preço estar na base coletiva e os itens no seu histórico.',
    comeca: 'Você toca no botão de escanear, no centro da barra de abas.',
    termina: 'Os itens aparecem no seu histórico e os preços entram na base coletiva da região.',
    duracao: '5 s (SP/MG) a ~40 s (RJ, com o captcha)',
    status: 'parcial',
    observacao:
      'O caminho do RJ (passos 7 a 9) é o único que passa pelo navegador embutido. SP e MG pulam direto do passo 6 para o 10 — o servidor consulta a SEFAZ sozinho.',
    passos: [
      {
        onde: 'aparelho',
        titulo: 'Abre a câmera',
        oque: 'O app pede a permissão da câmera na hora, se ainda não tiver. A tela é sempre escura, nos dois temas, com a moldura de leitura.',
        seFalhar:
          'Permissão negada → botão que abre os Ajustes do sistema. Câmera não abriu (outro app segurando) → mostra o erro real, não uma mensagem genérica, e oferece tentar de novo.',
        funcao: 'scanner',
        arquivo: 'app/src/telas/ScannerTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Lê o QR e grava o conteúdo cru NA HORA',
        oque: 'Assim que o QR é reconhecido, o conteúdo é gravado no banco do próprio celular — antes de qualquer acesso à internet. Duas travas contra repetição: a câmera não lê o mesmo QR duas vezes na mesma leitura, e a chave de acesso lida do QR reconhece um cupom que já está no aparelho.',
        seFalhar:
          'Não conseguiu gravar → avisa e libera a câmera para escanear de novo. Cupom já escaneado → abre a nota que já existe, avisando, sem criar um cartão novo nem chamar a rede.',
        porque:
          'Gravar cru primeiro é decisão travada: o cupom de QUALQUER estado fica guardado desde o dia 1, mesmo sem parser, para ser processado retroativamente quando o estado entrar.',
        funcao: 'scanner',
        arquivo: 'app/src/telas/ScannerTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Vai direto para a tela da Nota fiscal',
        oque: 'A tela abre já dizendo "aguardando processamento" e passa a perguntar o estado do cupom de tempos em tempos. O envio começa em segundo plano.',
        porque:
          'O usuário não fica preso numa tela de espera: a captura já terminou do ponto de vista dele. O resto é assíncrono.',
        funcao: 'compras',
        arquivo: 'app/src/telas/NotaFiscalTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'A fila de upload envia o QR',
        oque: 'O conteúdo do QR sobe para o servidor. Sem sinal, ele fica na fila e sobe sozinho quando a internet voltar, com espera crescente entre as tentativas.',
        seFalhar:
          'QR inválido (400) é permanente: sai da fila e o cupom é marcado como falha. Qualquer outro erro é transitório e volta a tentar.',
        funcao: 'fila-upload',
        arquivo: 'app/src/nucleo/sincronizador.ts',
        rota: 'POST /ingestao/qr',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Registra o cupom, sem esperar o parsing',
        oque: 'Lê a chave de acesso de 44 dígitos de dentro do QR, extrai a UF e grava o cupom como "aguardando". Responde na hora — não espera a SEFAZ.',
        porque:
          'A gravação é idempotente pela chave: o mesmo cupom enviado duas vezes não vira duas notas. A chave volta na resposta para a mesma trava valer no aparelho.',
        funcao: 'ingestao-qr',
        arquivo: 'backend/src/ingestao/servico-ingestao.ts',
        rota: 'POST /ingestao/qr',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'A fila escolhe o parser do estado',
        oque: 'Um trabalhador em segundo plano pega o cupom e procura o leitor daquela UF: RJ, SP, MG ou o genérico ENCAT.',
        seFalhar:
          'Estado sem parser, ou estado ainda fora do lançamento faseado, NÃO é falha: o cupom fica represado, esperando o reprocessamento retroativo. O usuário não perde nada.',
        funcao: 'fila-processamento',
        arquivo: 'backend/src/processamento/processador-cupom.ts',
        status: 'parcial',
      },
      {
        onde: 'navegador',
        titulo: 'Abre o portal da SEFAZ dentro do app — só no RJ',
        oque: 'A página da SEFAZ é aberta EM TELA CHEIA dentro do app e quem interage é você: tocar "Consultar", resolver o desafio se aparecer. Não é escondido de propósito.',
        porque:
          'O portal do RJ só entrega a nota a um navegador de verdade (reCAPTCHA v3) e barra IP de servidor. Um WebView escondido continua sendo pontuado como robô e trava. Deixar a pessoa no comando é o caminho que funciona.',
        seFalhar:
          'Só carrega endereço de portal público conhecido. Um QR falso colado na gôndola não abre nada — sem essa trava, isto seria uma janela de phishing em tela cheia, sem barra de endereço, sob o título "Confirme sua nota".',
        funcao: 'coletor-web',
        arquivo: 'app/src/componentes/ColetorNotaWeb.tsx',
        status: 'parcial',
      },
      {
        onde: 'navegador',
        titulo: 'Colhe o HTML da página a cada 3 segundos e manda ao servidor',
        oque: 'O app só COPIA o que está na tela e envia — nunca interpreta a nota (parsing no app é proibido por decisão travada).',
        seFalhar:
          'Ainda é a página de desafio → o servidor responde "ainda não" e o app segue esperando, sem desistir. A SEFAZ recusou o captcha → recarrega a consulta com um token novo, até 4 vezes. Queda de rede → recarrega até 4 vezes.',
        funcao: 'ingestao-html',
        arquivo: 'app/src/componentes/ColetorNotaWeb.tsx',
        rota: 'POST /ingestao/cupom/:id/html',
        status: 'parcial',
      },
      {
        onde: 'servidor',
        titulo: 'Lê a nota e confere que ela é a nota certa',
        oque: 'O parser extrai loja, data, itens, quantidades, unidades, valores e desconto. Depois compara o CNPJ da loja com o CNPJ que está dentro da chave de acesso.',
        porque:
          'A chave carrega o CNPJ do emitente. Nota com CNPJ diferente é outra nota — página errada no navegador, ou conteúdo forjado tentando envenenar a base. Vira falha permanente, não tentativa nova.',
        funcao: 'parsers',
        arquivo: 'backend/src/parsers/rj.ts',
        status: 'pronto',
      },
      {
        onde: 'sefaz',
        titulo: 'Consulta direta ao portal — SP, MG e demais',
        oque: 'Fora do RJ, o servidor busca a nota no portal público por conta própria, sempre por https, sem passar pelo celular.',
        porque: 'É o caminho normal. Só quem tem captcha exige o desvio pelo navegador do usuário.',
        funcao: 'cliente-sefaz',
        arquivo: 'backend/src/sefaz/cliente-sefaz-http.ts',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'O anonimizador parte o dado em dois',
        oque: 'De um lado a sua nota privada, com a chave de acesso, ligada a você. Do outro, os preços: soltos item a item, sem o seu id, sem a chave, sem ligação com o resto da compra.',
        porque:
          'É a fronteira. Itens soltos e sem dono impedem reconstruir a cesta de alguém — é o que permite a base coletiva existir sem virar rastro de consumo identificável.',
        funcao: 'anonimizador',
        arquivo: 'backend/src/anonimizacao/anonimizador.ts',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Congela o típico da região em cada item — ANTES de publicar',
        oque: 'Grava em cada item quanto era a mediana da região naquele instante, para um dia poder dizer quanto você economizou de verdade.',
        porque:
          'A ordem é travada por teste: depois de o cupom entrar na base, a mediana já teria o seu próprio preço dentro e você estaria se comparando consigo mesmo. E essa mediana não existe mais amanhã — é a única chance de guardá-la.',
        seFalhar:
          'Se a leitura falhar, o item é gravado sem o snapshot e o cupom conclui normalmente. Perder o baseline de um cupom é ruim; perder o cupom é pior.',
        funcao: 'tipico-na-compra',
        arquivo: 'backend/src/estatistica/tipico-na-compra.ts',
        status: 'pronto',
      },
      {
        onde: 'banco',
        titulo: 'Grava tudo numa transação só',
        oque: 'Loja, itens privados, preços na base coletiva, status "processado" e a remoção do CPF de dentro do QR guardado — tudo junto, ou nada.',
        porque:
          'Antes eram escritas em sequência, e uma falha depois de inserir na base coletiva duplicava os preços na tentativa seguinte. O CPF sai na MESMA transação: se fosse depois, uma falha entre as duas deixaria o CPF no banco sem ninguém saber.',
        seFalhar:
          'Cupom com a mesma chave já publicado por outra conta: o seu histórico privado é criado normalmente, mas os preços não entram na base duas vezes.',
        funcao: 'processador',
        arquivo: 'supabase/migrations/20260629090000_processar_cupom_rpc.sql',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Recalcula a mediana dos produtos afetados',
        oque: 'Os produtos que ganharam preço novo têm a faixa típica recalculada, para o veredito na gôndola já contar com eles.',
        seFalhar:
          'Se o recálculo falhar, o preço já está salvo — só registra o ocorrido para o job em lote recuperar depois. Nunca desfaz a ingestão.',
        funcao: 'pipeline',
        arquivo: 'backend/src/estatistica/pipeline.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'A tela percebe que ficou pronto e mostra o resultado',
        oque: 'A Nota fiscal, que estava perguntando o estado de tempos em tempos, vê "processado", baixa os itens para o banco local e abre a tela de confirmação com o que foi lido.',
        seFalhar:
          'Sem sinal, a tela mostra "salvo, aguardando" e continua tentando mais devagar. O cupom nunca é perdido.',
        funcao: 'compras',
        arquivo: 'app/src/telas/NotaFiscalTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Os itens passam a valer em todo o resto do app',
        oque: 'Entram no seu catálogo de produtos, na sua faixa pessoal de preços, no card de descontos do mês e nas conquistas. Na próxima sincronização, as estatísticas novas descem para o cache offline.',
        funcao: 'catalogo-local',
        arquivo: 'app/src/nucleo/catalogo.ts',
        status: 'pronto',
      },
    ],
    ramos: [
      {
        titulo: 'Sem internet no mercado',
        oque: 'Tudo até o passo 3 acontece igual. O cupom espera na fila e sobe sozinho quando o sinal voltar.',
        status: 'pronto',
      },
      {
        titulo: 'O QR não lê (rasgado, borrado)',
        oque: 'Botão "Digitar chave de acesso" na própria tela do scanner: os 44 números da nota levam ao mesmo caminho, a partir do passo 4.',
        status: 'pronto',
      },
      {
        titulo: 'Cupom de um estado que ainda não tem parser',
        oque: 'Fica guardado, sem virar falha. No dia em que o estado entrar, o reprocessamento retroativo o transforma em histórico — sem o usuário fazer nada.',
        status: 'pronto',
      },
      {
        titulo: 'O mesmo cupom escaneado duas vezes',
        oque: 'A trava por chave de acesso vale no aparelho e no servidor: vira uma nota só, e a base coletiva recebe os preços uma vez só.',
        status: 'pronto',
      },
      {
        titulo: 'Nota antiga sem o total/desconto',
        oque: 'Cupons processados antes do recurso de totais ficaram sem esses valores. Existe um botão que reabre o navegador só para preencher isso, sem republicar preço nenhum.',
        status: 'pronto',
      },
    ],
  },

  {
    id: 'j-verificar',
    titulo: 'Verificar um preço na gôndola',
    resumo:
      'O momento de valor do app. Precisa funcionar sem internet, porque é exatamente onde o sinal cai.',
    comeca: 'Você está no corredor do mercado, com o produto na mão.',
    termina: 'A tela diz BARATO, NA MÉDIA ou CARO, com a base em que se apoiou.',
    duracao: 'menos de 1 segundo (offline)',
    status: 'pronto',
    passos: [
      {
        onde: 'aparelho',
        titulo: 'Abre a aba Verificar e escaneia o código de barras',
        oque: 'A leitura do código de barras é o caminho principal; buscar pelo nome é a alternativa.',
        seFalhar:
          'Produtos do RJ costumam nascer SEM código de barras na nota. Nesses casos o casamento é por texto e a busca por nome é o caminho que funciona.',
        funcao: 'escanear-barras',
        arquivo: 'app/src/telas/EscanearBarrasTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'O código volta para a tela por uma caixa de correio em memória',
        oque: 'O código lido não viaja como parâmetro de navegação aninhado — é depositado num ponto único que a tela Verificar consulta.',
        porque: 'Parâmetro aninhado se perdia entre telas; a caixa de correio é mais confiável.',
        funcao: 'escanear-barras',
        arquivo: 'app/src/nucleo/scan-pendente.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Você digita o preço da etiqueta',
        oque: 'Trocar de produto zera o preço digitado, para não comparar o preço de um com a faixa de outro.',
        funcao: 'verificar',
        arquivo: 'app/src/telas/VerificarTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Converte o preço para a unidade comparável',
        oque: 'O valor vira R$/kg, R$/L ou R$/un antes de qualquer comparação. Nunca se compara valor cru.',
        porque:
          'R$ 8 de leite não diz nada sem saber se é 1 L ou 200 ml. A mesma função roda no app e no servidor — se divergissem, o mesmo produto teria preço diferente offline e online.',
        funcao: 'normalizacao',
        arquivo: 'shared/src/estatistica/normalizacao.ts',
        status: 'parcial',
      },
      {
        onde: 'aparelho',
        titulo: 'Busca a melhor faixa no cache do celular',
        oque: 'Procura entre as linhas guardadas a do recorte mais específico que tenha dados suficientes: loja, senão município, senão região, senão o estado.',
        porque: 'É o passo que faz o veredito existir sem internet.',
        funcao: 'veredito-local',
        arquivo: 'app/src/nucleo/veredito-local.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Monta a sua faixa pessoal do histórico',
        oque: 'Se você já comprou aquele produto, o app calcula o que VOCÊ costuma pagar, a partir das suas notas no aparelho.',
        funcao: 'faixa-pessoal',
        arquivo: 'shared/src/estatistica/faixa.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Aplica as duas perguntas do veredito',
        oque: 'Primeiro: a diferença contra a mediana passa de 5%? Se não, é "na média". Se passa, aí os percentis dizem o lado — abaixo do p25 é barato, acima do p75 é caro.',
        porque:
          'A mesma função que o servidor usaria, morando no código compartilhado, para não haver divergência entre o veredito offline e o online.',
        funcao: 'veredito',
        arquivo: 'shared/src/estatistica/veredito.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Mede a idade do dado e fica mais calado se for velho',
        oque: 'Acima de 30 dias a faixa sai com ressalva; acima de 180 dias o app não opina. A exigência dos 5% cresce 0,8% por mês de idade.',
        porque:
          'O app não pode ser mais confiante que o motor estatístico, que já descartaria uma observação daquela idade.',
        funcao: 'frescor',
        arquivo: 'shared/src/estatistica/frescor.ts',
        status: 'parcial',
      },
      {
        onde: 'aparelho',
        titulo: 'Mostra os dois ângulos e a promoção à parte',
        oque: 'A região em destaque, o seu histórico ao lado quando existe, o "menor visto" numa linha separada, e a base em que se apoiou ("3 mercados na sua cidade").',
        porque:
          'Promoção nunca entra no número único: o preço da prateleira é comparado contra a faixa regular, senão quase todo preço normal pareceria caro.',
        funcao: 'verificar',
        arquivo: 'app/src/componentes/VeredictoBadge.tsx',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Se houver sinal, refina online e guarda para a próxima',
        oque: 'Consulta a faixa atual do produto no recorte da sua região, atualiza a tela e grava no cache — para a próxima vez já ser offline.',
        seFalhar: 'Sem sinal ou sem dado, mantém o que o cache tinha. Nunca fica sem resposta.',
        funcao: 'consulta-preco',
        arquivo: 'app/src/nucleo/veredito-local.ts',
        rota: 'POST /consulta/preco',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Se o preço estiver errado, você denuncia',
        oque: 'Um botão manda o produto e o recorte geográfico para a fila de curadoria.',
        porque:
          'Denunciar não publica nem apaga preço nenhum: é sinal para a curadoria corrigir o casamento ou a unidade. O alvo nunca é uma linha da base — não existe caminho de volta dela para um usuário.',
        funcao: 'denuncia-app',
        arquivo: 'app/src/componentes/FolhaDenuncia.tsx',
        rota: 'POST /denuncia',
        status: 'pronto',
      },
    ],
    ramos: [
      {
        titulo: 'Produto que você nunca comprou',
        oque: 'O veredito sai só com o ângulo da região — é justamente o diferencial: vale para quem nunca comprou o item.',
        status: 'pronto',
      },
      {
        titulo: 'Menos de 3 preços na base',
        oque: 'O veredito aparece com ressalva de "poucos dados". Com zero, o app diz que não sabe em vez de chutar.',
        status: 'pronto',
      },
      {
        titulo: 'Preço só de uma loja',
        oque: 'Não é exibido. Com uma observação só, a "mediana da loja" É o preço de uma compra específica — mostrar isso re-identificaria uma pessoa por dedução.',
        status: 'pronto',
      },
    ],
  },

  {
    id: 'j-primeiro-uso',
    titulo: 'Primeiro uso, sem nenhum cupom',
    resumo:
      'O teste mais duro do app: alguém que acabou de instalar e não escaneou nada. Se a tela estiver vazia aqui, a pessoa desinstala.',
    comeca: 'A pessoa abre o app pela primeira vez.',
    termina:
      'Ela já consegue montar uma lista e comparar mercados, com nome de produto de verdade, sem ter escaneado nada.',
    duracao: '2 a 3 minutos',
    status: 'parcial',
    passos: [
      {
        onde: 'aparelho',
        titulo: 'Abertura com a animação da marca',
        oque: 'A tela de abertura constrói o símbolo enquanto o banco local é preparado.',
        funcao: 'onboarding',
        arquivo: 'app/src/telas/SplashTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Explica o app e coleta o consentimento',
        oque: 'Três telas dizendo o que o app faz, e o consentimento de privacidade antes de qualquer dado sair do aparelho.',
        funcao: 'onboarding',
        arquivo: 'app/src/telas/OnboardingTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Criar conta ou entrar',
        oque: 'E-mail e senha, ou Google. A sessão fica no cofre do sistema operacional, não em texto puro.',
        funcao: 'auth',
        arquivo: 'app/src/telas/auth/CadastroTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'navegador',
        titulo: 'Confirmar o e-mail passa por uma página na web',
        oque: 'O link do e-mail abre uma página https que oferece o botão "Abrir no Barganha". O toque é o gesto que os navegadores exigem para lançar o app.',
        seFalhar:
          'PONTO FRÁGIL HOJE: se a página não estiver publicada e o endereço não estiver na lista de permitidos do Supabase, o link não volta para o app — e o login responde "e-mail ou senha incorretos", mandando o diagnóstico para o lado errado.',
        funcao: 'ponte-email',
        arquivo: 'site/auth-callback.html',
        status: 'parcial',
      },
      {
        onde: 'aparelho',
        titulo: 'Boas-vindas, câmera e região',
        oque: 'Um fluxo curto que roda uma vez por aparelho: apresenta o app, pede a câmera e pergunta em que cidade comparar os preços.',
        porque:
          'A região é escolha MANUAL. O app pode sugerir pelas lojas das compras recentes, mas não usa GPS para decidir sozinho — a geografia do dado vem do CNPJ da loja, nunca do rastreamento da pessoa.',
        funcao: 'abertura',
        arquivo: 'app/src/telas/abertura/AberturaFluxo.tsx',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Sem histórico, o app puxa os produtos populares da região',
        oque: 'A lista de compras e o comparador de mercados se sustentam nos produtos que mais aparecem na base daquela cidade.',
        porque:
          'É o que destrava o começo: conta nova, zero cupom, e o app já tem serventia. Sem isso, a primeira semana seria uma tela vazia.',
        funcao: 'busca-produtos',
        arquivo: 'backend/src/consulta/servico-busca-produtos.ts',
        rota: 'POST /consulta/produtos',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'Os preços dos produtos da lista descem para o cache',
        oque: 'A sincronização inclui no recorte os produtos que estão só na lista, nunca comprados — para terem preço offline no mercado.',
        funcao: 'delta-sync',
        arquivo: 'app/src/nucleo/sincronizador.ts',
        rota: 'POST /sync/estatisticas',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Os nomes dos produtos descem junto',
        oque: 'O app manda o lote de ids que tem em cache e recebe nome, marca e categoria — para o catálogo aparecer com nome de gente offline, em vez da descrição crua do cupom ("ARR TP1 TIO J 5KG").',
        porque:
          'O delta de estatística traz PREÇO por id e mais nada. Sem este passo, o app teria o típico de um produto que não sabe nomear. O cache revalida a cada 7 dias porque a curadoria enriquece o produto DEPOIS — sem isso, quem baixou antes do nome existir ficaria sem nome para sempre.',
        funcao: 'sync-produtos',
        arquivo: 'backend/src/sync/servico-sync-catalogo.ts',
        rota: 'POST /sync/produtos',
        status: 'pronto',
      },
    ],
    ramos: [
      {
        titulo: 'A pessoa troca de celular',
        oque: 'Ao entrar de novo, o histórico privado é rebaixado do servidor e o espelho local se reconstrói.',
        status: 'pronto',
      },
      {
        titulo: 'A pessoa sai da conta',
        oque: 'O aparelho é limpo, mas a conta continua no servidor. A tela diz isso explicitamente — antes, "Sair" parecia apagar tudo.',
        status: 'pronto',
      },
    ],
  },

  {
    id: 'j-apagar-conta',
    titulo: 'Apagar a conta',
    resumo:
      'Exigência da Google Play e direito da LGPD. É a jornada que prova que os dois mundos de dados são mesmo separados.',
    comeca: 'Perfil → Configurações da conta → Excluir conta.',
    termina: 'A conta e todo o histórico somem; a base coletiva de preços segue intacta.',
    duracao: 'segundos',
    status: 'pronto',
    passos: [
      {
        onde: 'aparelho',
        titulo: 'Confirma dizendo o que vai e o que fica',
        oque: 'O diálogo avisa que não dá para desfazer e que os preços já compartilhados são anônimos e soltos, e seguem ajudando a região.',
        porque:
          'Sem essa frase, a pessoa acharia que apagar a conta tira os preços dela da base — e não tira, porque não existe ligação de volta para removê-los.',
        funcao: 'apagar-conta',
        arquivo: 'app/src/telas/ConfiguracoesContaTela.tsx',
        status: 'pronto',
      },
      {
        onde: 'servidor',
        titulo: 'Apaga a conta de login e o histórico em cascata',
        oque: 'Some o usuário, os cupons e os itens privados.',
        funcao: 'apagar-conta',
        arquivo: 'backend/src/auth/gerenciador-conta.ts',
        rota: 'DELETE /conta',
        status: 'pronto',
      },
      {
        onde: 'banco',
        titulo: 'A base coletiva não é tocada',
        oque: 'As observações de preço nascem sem id de usuário e sem chave da nota — não existe caminho do cupom para elas.',
        porque:
          'Isso é o desenho, não uma limitação: é a mesma propriedade que impede reconstruir a cesta de alguém.',
        funcao: 'anonimizador',
        arquivo: 'backend/src/anonimizacao/anonimizador.ts',
        status: 'pronto',
      },
      {
        onde: 'aparelho',
        titulo: 'O banco local é zerado',
        oque: 'Notas, cache, fila, lista, alertas e feed — tudo limpo no aparelho.',
        funcao: 'bd-local',
        arquivo: 'app/src/dados/bd.ts',
        status: 'pronto',
      },
      {
        onde: 'navegador',
        titulo: 'Existe também a página web de exclusão',
        oque: 'A Play exige um endereço público onde dê para pedir a exclusão sem instalar o app. Já está publicada.',
        funcao: 'site-legal',
        arquivo: 'site/exclusao-de-conta.html',
        status: 'pronto',
      },
    ],
    ramos: [
      {
        titulo: 'Conta parada há muito tempo',
        oque: 'Existe uma rotina que apaga contas inativas avisando antes por e-mail (dois avisos, via Resend) — falta configurar os segredos em produção e concluir a revisão jurídica da transferência internacional antes de ligar de verdade.',
        status: 'parcial',
      },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   3. FUNÇÕES — o que cada peça faz, em uma frase, e com quem ela conversa.
   ──────────────────────────────────────────────────────────────────────────── */

export const areas = [
  { id: 'captura', nome: 'Captura do cupom', desc: 'Ler a nota e fazer o dado chegar inteiro.' },
  { id: 'sefaz', nome: 'SEFAZ & parsers', desc: 'Transformar o QR em itens estruturados.' },
  { id: 'privacidade', nome: 'Privacidade', desc: 'A fronteira que separa você dos preços.' },
  { id: 'estatistica', nome: 'Estatística', desc: 'A inteligência do barato/na média/caro.' },
  { id: 'api', nome: 'API & sync', desc: 'Servir rápido e habilitar o offline.' },
  { id: 'app', nome: 'Telas do app', desc: 'O que o usuário vê e toca.' },
  { id: 'dados', nome: 'Dados locais', desc: 'O banco dentro do aparelho.' },
  { id: 'operacao', nome: 'Operação', desc: 'Observar, alertar, publicar.' },
];

export const funcoes = [
  /* ── captura ─────────────────────────────────────────────────────────── */
  {
    id: 'scanner',
    nome: 'Escanear o QR do cupom',
    area: 'captura',
    status: 'pronto',
    oque: 'Abre a câmera, lê o QR code da nota fiscal e grava o conteúdo cru no aparelho antes de qualquer outra coisa. Escanear o mesmo cupom de novo abre o que já existe, em vez de criar um segundo.',
    detalhe:
      'Gravar o QR cru primeiro é decisão travada: qualquer estado é guardado desde o dia 1, mesmo sem parser, para processar retroativamente depois. A câmera desmonta quando a tela sai de foco (no Android a prop `active` do expo-camera não funciona e a tela ficava preta). A chave de acesso é lida do texto do QR já na captura (não é parsing da nota — não toca a SEFAZ): é ela que alimenta o índice único local e impede o mesmo cupom virar dois cartões no histórico, contando em dobro no resumo. O extrator mora em `shared` porque o servidor precisa chegar à MESMA chave para o dedup dele bater com o do aparelho. Re-escanear um cupom em falha é retentativa, não duplicata: reaproveita a linha e volta para a fila.',
    ligacoes: ['fila-upload', 'ingestao-qr', 'digitar-chave'],
    arquivos: [
      'app/src/telas/ScannerTela.tsx',
      'app/src/nucleo/camera.ts',
      'shared/src/dominio/chave-acesso.ts',
    ],
    etapas: ['C6.1'],
  },
  {
    id: 'digitar-chave',
    nome: 'Digitar a chave de acesso',
    area: 'captura',
    status: 'pronto',
    oque: 'Plano B quando o QR está rasgado ou ilegível: o usuário digita os 44 dígitos da nota.',
    ligacoes: ['ingestao-qr'],
    arquivos: ['app/src/telas/DigitarChaveTela.tsx', 'backend/src/parsers/chave-acesso.ts'],
    etapas: ['C6.1'],
  },
  {
    id: 'coletor-web',
    nome: 'Coletor por WebView (RJ)',
    area: 'captura',
    status: 'parcial',
    oque: 'Abre o portal da SEFAZ dentro do app para vencer o reCAPTCHA do RJ e manda o HTML da página para o backend ler.',
    falta:
      'Validação no aparelho físico com cupons reais do RJ. A recuperação automática agora é uma máquina de estados coberta por teste, mas nunca rodou no device.',
    detalhe:
      'O RJ não devolve os dados por API: a página é protegida por captcha. A WebView carrega o portal, o usuário resolve o desafio quando aparece, e o HTML resultante sobe para o parser. As decisões de insistir ou parar saíram do componente e viraram um módulo puro (`coletor-regras.ts`), percorrido inteiro pelo teste sem precisar de WebView. São três falhas que só acontecem no aparelho, cada uma com seu próprio teto: a SEFAZ recusar a verificação (volta à consulta original para gerar um token novo, até 4×), o portal mandar o app para um endereço `http://` que está fechado (a mesma navegação é refeita em `https`, até 6×) e a conexão cair (recarrega, até 4×). Nenhuma delas marca o cupom como falha — no pior caso ele fica guardado para tentar mais tarde. Um relógio de segurança evita o único jeito de a tela ficar muda para sempre: a recarga pedida que nunca chega.',
    ligacoes: ['ingestao-html', 'parsers'],
    arquivos: [
      'app/src/componentes/ColetorNotaWeb.tsx',
      'app/src/nucleo/coletor-regras.ts',
      'app/src/nucleo/coletor-regras.test.ts',
    ],
    rotas: ['POST /ingestao/cupom/:id/html'],
    etapas: ['C2.6'],
  },
  {
    id: 'fila-upload',
    nome: 'Fila de upload offline',
    area: 'captura',
    status: 'pronto',
    oque: 'Guarda os cupons escaneados sem sinal e sobe todos quando a internet volta, sem risco de duplicar.',
    detalhe:
      'A idempotência vem da `chave_acesso`: o mesmo cupom enviado duas vezes cai no índice único `(usuario_id, chave_acesso)` e não vira duas notas. A fila sobrevive a sair da conta e voltar.',
    ligacoes: ['sincronizador', 'ingestao-qr', 'bd-local'],
    arquivos: ['app/src/dados/repositorio-fila.ts', 'app/src/nucleo/sincronizador.ts'],
    etapas: ['C6.2'],
  },
  {
    id: 'escanear-barras',
    nome: 'Escanear código de barras',
    area: 'captura',
    status: 'pronto',
    oque: 'Na gôndola, lê o código de barras do produto e devolve o EAN para a tela Verificar.',
    detalhe:
      'O EAN volta por um "correio" em memória (`nucleo/scan-pendente`) em vez de parâmetro de navegação aninhado — mais confiável. Atenção conhecida: os dados do RJ costumam nascer SEM EAN, então o casamento cai no texto.',
    ligacoes: ['verificar', 'casamento-texto'],
    arquivos: ['app/src/telas/EscanearBarrasTela.tsx', 'app/src/nucleo/scan-pendente.ts'],
    etapas: ['C7.1'],
  },

  /* ── sefaz & parsers ─────────────────────────────────────────────────── */
  {
    id: 'ingestao-qr',
    nome: 'Receber o cupom (ingestão)',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Endpoint que recebe o QR, guarda cru, cria o cupom com status "aguardando" e joga na fila de processamento.',
    ligacoes: ['fila-processamento', 'processador', 'rate-limit'],
    arquivos: ['backend/src/http/rotas/ingestao.ts', 'backend/src/ingestao/servico-ingestao.ts'],
    rotas: ['POST /ingestao/qr'],
    etapas: ['C2.1'],
  },
  {
    id: 'ingestao-html',
    nome: 'Completar cupom pelo HTML',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Recebe o HTML da página da SEFAZ coletado pela WebView e extrai os itens, o desconto e o total.',
    ligacoes: ['coletor-web', 'parsers'],
    arquivos: ['backend/src/parsers/html.ts'],
    rotas: ['POST /ingestao/cupom/:id/html'],
    etapas: ['C2.6'],
  },
  {
    id: 'fila-processamento',
    nome: 'Fila de processamento',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Processa os cupons em segundo plano, com retry e backoff, drenando vários em paralelo.',
    detalhe:
      'A fila é DURÁVEL: mora na tabela `fila_processamento`, e cada tarefa é entregue a UM consumidor por `for update skip locked` — é o que permite mais de uma instância sem que as duas parseiem o mesmo cupom. Tentativas e backoff são colunas, então sobrevivem ao restart; quem pega abre uma "lease" de 5 min e, se morrer no meio, a tarefa volta sozinha para a fila. Uma tarefa chega ao consumidor pelo enfileiramento (na hora) ou pelo poll de 5s (o que veio de outra instância, saiu do backoff ou ficou órfão). `FILA_DURAVEL=false` volta à fila em memória — a dos testes e do dev local, válida para uma instância.',
    ligacoes: ['processador', 'reprocessamento'],
    arquivos: [
      'backend/src/fila/fila-postgres.ts',
      'backend/src/fila/armazenamento-supabase.ts',
      'backend/src/fila/fila-memoria.ts',
    ],
    etapas: ['C2.1'],
  },
  {
    id: 'parsers',
    nome: 'Parsers por estado',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Um leitor por estado atrás de uma interface comum: recebe o QR e devolve sempre o mesmo formato de nota.',
    detalhe:
      'Implementados: RJ, SP, MG e um parser ENCAT genérico (o layout que a maioria dos estados usa), mais o parser de HTML. Um estado novo é um arquivo novo no registro — nada mais muda. Erro de parser descreve a FORMA do texto, nunca o conteúdo (para não vazar dado no log).',
    ligacoes: ['cliente-sefaz', 'anonimizador', 'reprocessamento'],
    arquivos: [
      'backend/src/parsers/registro.ts',
      'backend/src/parsers/rj.ts',
      'backend/src/parsers/sp.ts',
      'backend/src/parsers/mg.ts',
      'backend/src/parsers/encat.ts',
    ],
    etapas: ['C2.2', 'C2.3', 'C11.1'],
  },
  {
    id: 'cliente-sefaz',
    nome: 'Cliente da SEFAZ',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Faz a consulta da nota nos portais públicos da SEFAZ, sempre por https.',
    detalhe:
      'A consulta é restrita a uma lista de portais públicos conhecidos — o QR não pode apontar o backend para qualquer endereço.',
    ligacoes: ['parsers'],
    arquivos: ['backend/src/sefaz/cliente-sefaz-http.ts'],
    etapas: ['C2.2'],
  },
  {
    id: 'processador',
    nome: 'Processador de cupom',
    area: 'sefaz',
    status: 'pronto',
    oque: 'O maestro: chama o parser, passa pelo anonimizador e grava tudo numa transação só.',
    detalhe:
      'A gravação é uma função SQL única (`processar_cupom`): loja + itens privados + pool + status numa transação. Antes eram escritas sequenciais, e uma falha depois de inserir no pool duplicava observações no retry.',
    ligacoes: ['parsers', 'anonimizador', 'tipico-na-compra', 'pipeline'],
    arquivos: [
      'backend/src/processamento/processador-cupom.ts',
      'supabase/migrations/20260629090000_processar_cupom_rpc.sql',
    ],
    etapas: ['C2.4', 'C9.3.1'],
  },
  {
    id: 'reprocessamento',
    nome: 'Reprocessamento retroativo',
    area: 'sefaz',
    status: 'pronto',
    oque: 'Reprocessa os QRs guardados quando um estado novo ganha parser ou quando um parser é corrigido.',
    detalhe:
      'É o que dá sentido a guardar o QR cru desde o dia 1: o usuário de um estado sem parser vê o histórico aparecer retroativamente no dia em que o estado entra.',
    ligacoes: ['parsers', 'fila-processamento'],
    arquivos: ['backend/src/processamento/reprocessamento.ts'],
    rotas: ['POST /curadoria/reprocessar'],
    etapas: ['C2.5', 'C11.1'],
  },

  /* ── privacidade ─────────────────────────────────────────────────────── */
  {
    id: 'anonimizador',
    nome: 'Anonimizador (a fronteira)',
    area: 'privacidade',
    status: 'pronto',
    oque: 'O portão único por onde todo preço passa antes de virar dado coletivo: descarta o CPF, solta os itens da cesta e tira qualquer ligação com o usuário.',
    detalhe:
      'Ele produz DOIS mundos que nunca se cruzam: a nota privada (com a chave de acesso, ligada ao usuário) e as observações de preço (sem `usuario_id`, sem chave, itens soltos para ninguém reconstruir a compra). Toda escrita no pool passa por aqui — sem exceção.',
    ligacoes: ['processador', 'gate-exposicao', 'dedup-pool'],
    arquivos: ['backend/src/anonimizacao/anonimizador.ts', 'shared/src/anonimizacao/gate.ts'],
    regras: ['r3'],
    etapas: ['C1.4', 'C2.4'],
  },
  {
    id: 'sanear-qr',
    nome: 'Apagar o CPF do QR guardado',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Depois que o cupom termina de processar, remove o CPF do consumidor de dentro do QR que ficou guardado.',
    detalhe:
      'O QR precisa ser guardado inteiro para o reprocessamento retroativo, mas alguns estados embutem o CPF nele. Ao concluir o cupom, esse trecho é saneado — o reprocessamento não precisa dele.',
    ligacoes: ['anonimizador'],
    arquivos: [
      'shared/src/anonimizacao/qr-payload.ts',
      'supabase/migrations/20260728100000_sanear_qr_payload_cpf.sql',
    ],
    regras: ['r3'],
    etapas: ['C9.2'],
  },
  {
    id: 'gate-exposicao',
    nome: 'Piso de exposição da loja',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Esconde a estatística de uma loja específica quando ela tem poucas observações, para o número não denunciar uma compra individual.',
    detalhe:
      'Com n=1 a "mediana da loja" É o preço de uma compra específica. Abaixo de 3 observações a célula não é servida, não é sincronizada, não é exibida — e não volta como "maior base" no passo seguinte do fallback.',
    ligacoes: ['escopos', 'anonimizador'],
    arquivos: ['shared/src/anonimizacao/exposicao.ts'],
    regras: ['r12'],
    etapas: ['C3.3', 'C9.2'],
  },
  {
    id: 'dedup-pool',
    nome: 'Dedup global do pool',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Impede que o mesmo cupom, enviado por contas diferentes, entre duas vezes na base coletiva.',
    detalhe:
      'Guarda o hash SHA-256 da chave de acesso numa tabela à parte (`chave_publicada`). Serve contra dois problemas ao mesmo tempo: distorção da mediana e abuso por multi-conta. O hash não permite voltar à chave.',
    ligacoes: ['anonimizador'],
    arquivos: ['supabase/migrations/20260712090000_chave_publicada_dedup_pool.sql'],
    regras: ['r15'],
    etapas: ['C9.2.1'],
  },
  {
    id: 'cifra-privada',
    nome: 'Cifra das colunas privadas',
    area: 'privacidade',
    status: 'parcial',
    oque: 'Cifra reversível, por envelope, de `cupom.chave_acesso` e da descrição de `item_cupom` — protege um dump do banco, não uma invasão do processo.',
    detalhe:
      'AES-256-GCM em Node (`node:crypto`); a chave-mestra vive só em variável de ambiente do backend, nunca em `pgcrypto`/parâmetro de query (vazaria para os logs do Postgres). A versão da chave viaja dentro do próprio blob cifrado, o que permite rotação sem downtime (chave atual + anterior convivendo). A chave de acesso continua REVERSÍVEL — o reprocessamento retroativo (C2.5) precisa dela em texto puro — e a idempotência do upload passou a usar um hash SHA-256 determinístico à parte (`chave_acesso_hash`, novo e separado do dedup global em `chave_publicada`), já que o blob cifrado tem IV aleatório e não indexa por igualdade. Auditado pelo gate de privacidade em 08/08/2026 (aprovado com ajustes — ver docs/19 §8).',
    falta:
      'Ativar em produção: aplicar a migração e configurar `CIFRA_CHAVE_ATUAL` no Render, os dois juntos, só no gate da Fase 3 (docs/15) — bloqueador b6. Até lá a coluna cifrada não existe em produção e os dados continuam em claro por lá.',
    ligacoes: ['anonimizador', 'dedup-pool', 'processador'],
    arquivos: [
      'backend/src/seguranca/cifra.ts',
      'supabase/migrations/20260808090000_cifra_dados_privados.sql',
    ],
    regras: ['r3'],
    etapas: ['C9.2.2'],
  },
  {
    id: 'apagar-conta',
    nome: 'Apagar a conta',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Remove a conta de login e todo o histórico privado, no aparelho e no servidor.',
    detalhe:
      'Como os dois mundos são separados, apagar a conta não quebra a base coletiva de preços — as observações anônimas não têm dono para remover.',
    ligacoes: ['perfil', 'purga-inativos'],
    arquivos: [
      'backend/src/auth/gerenciador-conta.ts',
      'app/src/telas/ConfiguracoesContaTela.tsx',
      'site/exclusao-de-conta.html',
    ],
    rotas: ['DELETE /conta'],
    etapas: ['C10.0'],
  },
  {
    id: 'purga-inativos',
    nome: 'Purga de contas inativas',
    area: 'privacidade',
    status: 'parcial',
    oque: 'Apaga automaticamente contas que ficaram muito tempo sem uso, avisando antes por e-mail.',
    detalhe:
      'Canal de e-mail (Resend, C9.2) via `enviarEmail` — fail-closed: sem `RESEND_API_KEY`/`EMAIL_REMETENTE` configurados, o aviso não sai e a purga fica travada por segurança (sem aviso, sem purga). O aviso é em DUAS etapas — um na janela de antecedência, um segundo mais perto da data prevista — porque a Resend aceitar o envio não garante a entrega, e essa é justamente a população com mais e-mail morto (inativa há 24 meses); a purga só avança com os DOIS aceitos. Job agendado 1×/dia (`.github/workflows/purga-inatividade.yml`), rodando em modo RELATÓRIO por padrão — só apaga de fato com a variável `PURGA_APLICAR=true`.',
    falta:
      'Preencher `RESEND_API_KEY`/`EMAIL_REMETENTE` em produção (Settings → Secrets, free tier sem cartão) e concluir a revisão jurídica pendente (mecanismo de transferência internacional do art. 33, identidade do controlador/DPO — ver docs/04 §Operadores) antes de ligar `PURGA_APLICAR=true` de verdade.',
    ligacoes: ['apagar-conta'],
    arquivos: [
      'backend/src/jobs/purga-inatividade.ts',
      'backend/src/observabilidade/email-transacional.ts',
      '.github/workflows/purga-inatividade.yml',
    ],
    etapas: ['C9.2'],
  },
  {
    id: 'log-mascarado',
    nome: 'Log estruturado com máscara',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Todo log sai em JSON com CPF, chave de acesso e afins já mascarados, no app e no backend.',
    detalhe:
      'A mesma máscara nos dois lados. Erro inesperado leva a pilha, mas o motivo é sanitizado antes de logar ou persistir.',
    ligacoes: ['metricas'],
    arquivos: [
      'backend/src/observabilidade/log.ts',
      'shared/src/observabilidade/redacao.ts',
      'app/src/nucleo/log.ts',
    ],
    etapas: ['C9.5'],
  },

  /* ── estatística ─────────────────────────────────────────────────────── */
  {
    id: 'normalizacao',
    nome: 'Normalização de unidade',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Converte todo preço para R$/kg, R$/L ou R$/un, para nunca comparar valor cru.',
    detalhe:
      'É a fonte ÚNICA do app e do backend (o backend só re-exporta). Se divergissem, o mesmo produto teria preço diferente offline e online. São quatro grupos de unidade: fator fixo (kg/g, L/ml, un, dúzia, cento, milheiro); um volume = um item vendido (pacote, bandeja, balde, sachê, garrafa, galão, lata, bisnaga, barra…); embalagem múltipla (CX/FD/PACK/cartela/engradado/EMB), que só entra quando a CONTAGEM é declarada na unidade ("CX12") ou na descrição ("12X350ML", "FD 6") e aí vira R$/un do item de dentro; e as NÃO-COMPARÁVEIS por natureza (metro/m², kit/jogo, par), que ficam fora para sempre. O plural resolve sozinho ("LATAS" → "LATA"), então nenhuma unidade é listada duas vezes. Sem contagem o multipack continua fora do pool, porque "R$ 36 a caixa" na mediana da lata é pior que observação nenhuma. A descrição só destrava embalagem múltipla: ela nunca muda o fator de KG/L/UN, e é isso que impede app e backend de divergirem se um dos lados não a passar. O quarto grupo existe para a TELEMETRIA: sem ele, "M2" e "KIT" liderariam para sempre o ranking de "abreviação que falta" e o contador nunca chegaria a zero — instrumento que não zera não decide nada.',
    ligacoes: ['agregacao', 'veredito', 'faixa-pessoal', 'unidades-recusadas'],
    arquivos: [
      'shared/src/estatistica/normalizacao.ts',
      'backend/src/anonimizacao/anonimizador.ts',
    ],
    regras: ['r5'],
    etapas: ['C3.4'],
  },
  {
    id: 'agregacao',
    nome: 'Motor de agregação',
    area: 'estatistica',
    status: 'parcial',
    oque: 'Calcula a faixa típica de cada produto: mediana, p25/p75, mínimo, máximo — dando mais peso aos preços recentes.',
    falta:
      'NÃO é pendência de engenharia — é bloqueio externo, não há o que codar aqui. A ferramenta de medição (job:calibracao) já existe, roda contra o pool real (backtest walk-forward p/ meia-vida, recall/falso-positivo p/ o cerco de promoção, bootstrap p/ mínimo de observações por nível e, desde C3.6, ruído de amostra + deriva mensal p/ a zona morta do veredito por família de categoria) e recomenda, sem aplicar nada sozinha — decisão humana, por design, mesma filosofia do job:cobertura-tipico. Rodar hoje devolve "dados insuficientes" porque o pool do beta ainda é raso, não porque falte código. Só revisitar quando o beta acumular volume; aí a recomendação vira commit separado.',
    detalhe:
      'Percentis PONDERADOS pelo decaimento temporal: uma observação de 8 meses atrás pesa quase nada, e acima de 180 dias é descartada. A promoção é segregada em duas camadas: a flag de desconto da própria NFC-e e o cerco estatístico (preços abaixo de p25 − 1,5×IQR).',
    ligacoes: ['pipeline', 'escopos', 'normalizacao'],
    arquivos: [
      'backend/src/estatistica/agregacao.ts',
      'backend/src/estatistica/calibracao.ts',
      'backend/src/jobs/calibracao-estatistica.ts',
    ],
    regras: ['r6', 'r9', 'r20'],
    etapas: ['C3.1', 'C3.2', 'C3.6'],
  },
  {
    id: 'escopos',
    nome: 'Escopos geográficos',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Procura a estatística no recorte mais específico que tiver dados: loja → município → região → UF.',
    detalhe:
      'Sempre há resposta, no nível mais específico possível, e a UI diz em que base ela se apoia ("3 mercados na sua cidade"). O nível loja tem o piso de exposição por cima. A geografia vem do CNPJ da loja — nunca do aparelho do usuário.',
    ligacoes: ['gate-exposicao', 'consulta-preco', 'agregacao'],
    arquivos: ['backend/src/estatistica/escopos.ts'],
    regras: ['r4', 'r14'],
    etapas: ['C3.3'],
  },
  {
    id: 'pipeline',
    nome: 'Pipeline de estatística',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Escreve o resultado da agregação na tabela que a consulta lê, para o app receber resposta pronta e rápida.',
    ligacoes: ['agregacao', 'agendador', 'consulta-preco'],
    arquivos: ['backend/src/estatistica/pipeline.ts'],
    etapas: ['C3.1'],
  },
  {
    id: 'agendador',
    nome: 'Recálculo agendado',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Recalcula as estatísticas fora do caminho crítico da ingestão: a cada 30 min o que mudou, e uma vez por semana tudo.',
    detalhe:
      'O recálculo completo semanal existe porque o decaimento temporal é função do tempo: sem ele, um produto que ninguém compra manteria para sempre a última faixa calculada, com peso de dado fresco.',
    ligacoes: ['pipeline'],
    arquivos: [
      'backend/src/estatistica/agendador-recalculo.ts',
      'backend/src/jobs/recalculo-estatistica.ts',
      '.github/workflows/recalculo-estatistica.yml',
    ],
    etapas: ['C3.1'],
  },
  {
    id: 'casamento-texto',
    nome: 'Casamento por texto (sem EAN)',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Quando o item vem sem código de barras, sugere a qual produto ele corresponde comparando as descrições, e permite confirmar a sugestão.',
    detalhe:
      'Crítico para os dados do RJ, que costumam nascer sem EAN. Depois que o casamento é confirmado, o job `republicar-pool` volta e preenche o pool com as observações que estavam órfãs. Sugestões via `POST /curadoria/casamento/sugestoes` e confirmação via `POST /curadoria/casamento/confirmar`.',
    ligacoes: ['republicar', 'curadoria', 'busca-produtos', 'resolvedor-produto'],
    arquivos: [
      'backend/src/estatistica/casamento-texto.ts',
      'backend/src/curadoria/servico-confirmacao-casamento.ts',
    ],
    rotas: ['POST /curadoria/casamento/sugestoes', 'POST /curadoria/casamento/confirmar'],
    etapas: ['C3.5'],
  },
  {
    id: 'resolvedor-produto',
    nome: 'Quem é este produto',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Decide, para cada item do cupom, a qual produto de referência ele pertence — na ordem: código de barras, código interno da loja, decisão da curadoria, descrição.',
    detalhe:
      'Para item SEM código de barras, a identidade do produto ERA a descrição exata: bastava o mercado abreviar o nome para nascer um produto novo e o histórico de preço se partir em dois, em silêncio — com a mediana voltando a "1 observação" e o app opinando com a mesma cara de confiança. O código interno da loja (o mesmo item tem sempre o mesmo código naquele mercado) segura essa identidade. Três guardas evitam o casamento errado quando a loja recicla um código: unidade diferente barra na hora, descrição muito diferente barra, e salto de preço só levanta suspeita (promoção e inflação existem). Nada disso cria produto novo — a chave é só memória de uma decisão já tomada por um caminho mais forte.',
    ligacoes: ['anonimizador', 'fusao-canonicos', 'casamento-texto'],
    arquivos: [
      'backend/src/anonimizacao/resolvedor-produto.ts',
      'backend/src/anonimizacao/casamento.ts',
      'supabase/migrations/20260804090000_item_cupom_codigo_loja.sql',
      'supabase/migrations/20260805090000_casamento_codigo_loja_e_fusao.sql',
    ],
    regras: ['r6'],
    etapas: ['C3.6.1'],
  },
  {
    id: 'fusao-canonicos',
    nome: 'Juntar produtos repetidos',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Junta dois cadastros que são o mesmo produto físico, somando os preços dos dois numa série só.',
    detalhe:
      'O mesmo produto vira dois cadastros quando um mercado escreve "CR LEITE X 200G" e outro "CREME DE LEITE X 200G", ou quando uma rede informa o código de barras e outra não. Cada metade fica com poucos preços, e o app diz "poucos dados ainda" sobre um produto do qual tem dados de sobra. A junção reaponta tudo (preços, histórico do usuário, alertas) e guarda o nome antigo, senão o próximo cupom recria o cadastro repetido. Recusa quando a intenção é ambígua (unidades diferentes, dois códigos de barras distintos) em vez de adivinhar — não há como desfazer.',
    ligacoes: ['resolvedor-produto', 'curadoria', 'pipeline'],
    arquivos: [
      'backend/src/curadoria/servico-fusao-canonicos.ts',
      'supabase/migrations/20260805090000_casamento_codigo_loja_e_fusao.sql',
    ],
    rotas: ['POST /curadoria/produto/fundir'],
    etapas: ['C3.6.1'],
  },
  {
    id: 'fila-codigo-loja',
    nome: 'Fila de códigos-loja suspeitos',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Tela de curadoria para revisar mapeamentos (loja + código interno) que `avaliarMapeamento` marcou como suspeitos ou dormentes, com ações de confirmar (o canônico atual está certo) ou reapontar (a loja reciclou o código para outro produto).',
    detalhe:
      'Até esta etapa a fila só se acumulava: existia o índice (`produto_codigo_loja_suspeito_idx`) e nenhuma tela que o lesse. Reapontar recusa (400) quando o canônico-alvo não existe ou tem unidade-base diferente da linha — o mesmo veto de integridade da fusão de canônicos, pelo mesmo motivo: misturar kg com un não tem conserto depois. Fundir dois canônicos continua sendo uma decisão diferente, feita em `/curadoria/produto/fundir` (C3.6.1).',
    ligacoes: ['resolvedor-produto', 'curadoria'],
    arquivos: [
      'backend/src/curadoria/servico-fila-codigo-loja.ts',
      'backend/src/curadoria/tipos-fila-codigo-loja.ts',
    ],
    rotas: [
      'GET /curadoria/fila-codigo-loja',
      'POST /curadoria/fila-codigo-loja/confirmar',
      'POST /curadoria/fila-codigo-loja/reapontar',
    ],
    etapas: ['C3.6.2'],
  },
  {
    id: 'republicar',
    nome: 'Republicar o pool',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Uma vez por dia, entra no pool as observações de itens que finalmente ganharam um casamento de produto.',
    ligacoes: ['casamento-texto', 'pipeline'],
    arquivos: ['backend/src/jobs/republicar-pool.ts', '.github/workflows/republicar-pool.yml'],
    etapas: ['C3.5'],
  },
  {
    id: 'veredito',
    nome: 'Motor de veredito',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Decide se o preço da prateleira está barato, na média ou caro — e monta os dois ângulos (região e seu histórico) lado a lado.',
    detalhe:
      'Vive no `shared` de propósito: o app resolve offline com a MESMA lógica que o backend usaria online, sem divergência. Duas perguntas em ordem: a diferença importa (zona morta) e, se sim, para que lado (percentis). Nunca compara contra o menor promocional. A zona morta tem duas metades: a base (5%, igual para todos — mede irrelevância, e subi-la no fresco comeria o sinal real que o app existe para mostrar) e a deriva por mês de idade do típico, essa SIM por família de categoria: 2%/mês no fresco (alface é reprecificada toda semana) contra 0,8% no industrializado.',
    ligacoes: ['normalizacao', 'frescor', 'veredito-local', 'faixa-pessoal'],
    arquivos: ['shared/src/estatistica/veredito.ts'],
    regras: ['r6', 'r10', 'r11', 'r13'],
    etapas: ['C3.6', 'C7.2'],
  },
  {
    id: 'frescor',
    nome: 'Frescor do dado',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Mede a idade do preço que sustenta a faixa e faz o app ficar mais calado quanto mais velho o dado for.',
    detalhe:
      'Acima de 30 dias a faixa é exibida com ressalva; acima de 180 dias (a janela da agregação) o app não opina — não pode ser mais confiante que o motor que já descartou aquele dado. A zona morta cresce 0,8% por mês de idade.',
    ligacoes: ['veredito'],
    arquivos: [
      'shared/src/estatistica/frescor.ts',
      'shared/src/estatistica/frescor.test.ts',
      'supabase/migrations/20260729090000_estatistica_observado_em_max.sql',
      'supabase/migrations/20260801120000_preencher_observado_em_max.sql',
    ],
    regras: ['r10'],
    etapas: ['C3.6'],
  },
  {
    id: 'faixa-pessoal',
    nome: 'Faixa pessoal',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Monta a sua faixa típica a partir do seu próprio histórico de compras, no aparelho.',
    detalhe:
      'Mesma forma da faixa regional (é um subconjunto estrutural), então o motor de veredito recebe as duas do mesmo jeito. Aqui os percentis não são ponderados — são poucas observações e todas suas.',
    ligacoes: ['veredito', 'catalogo-local'],
    arquivos: ['shared/src/estatistica/faixa.ts'],
    etapas: ['C7.2'],
  },
  {
    id: 'tipico-na-compra',
    nome: 'Congelar o típico na compra',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Grava, em cada item comprado, qual era o típico da região naquele instante — para um dia poder dizer quanto você economizou de verdade.',
    detalhe:
      'Feito ANTES da UI de propósito: é a única parte irrecuperável. A tabela de estatística guarda só o estado atual, então a mediana de hoje não existe mais amanhã. Duas travas: a mediana é lida antes de o cupom entrar no pool (para não se auto-referenciar) e o nível loja é excluído.',
    ligacoes: ['processador', 'economia-real'],
    arquivos: [
      'backend/src/estatistica/tipico-na-compra.ts',
      'supabase/migrations/20260725090000_item_cupom_tipico_na_compra.sql',
    ],
    regras: ['r16', 'r17'],
    etapas: ['C8.4.1'],
  },
  {
    id: 'economia-real',
    nome: 'Economia real (pagou × típico)',
    area: 'estatistica',
    status: 'falta',
    oque: 'A métrica que mede o app: quanto você pagou a menos (ou a mais) que o típico da região.',
    falta:
      'A UI inteira. E é para esperar: com o pool raso, o snapshot vem vazio para quase todo item e a tela mostraria "R$ 0,00 · 2 de 40 itens comparados" — uma prova visual de que o app não tem dados. O gatilho não é uma data, é cobertura MEDIDA: quando mais de ~60% dos itens de um cupom típico tiverem típico gravado. A cobertura agora dá para medir: `npm run job:cobertura-tipico` (workspace @barganha/backend) calcula a fração mediana por cupom e diz se o gatilho de ~60% já foi atingido.',
    detalhe:
      'Três condições inegociáveis quando for a hora: pode dar negativo (é boletim, não troféu), declara a cobertura ("23 de 41 itens comparados") e cada real é rastreável até o item. Hoje o app mostra o DESCONTO do cupom, que é honesto — é a promoção que o mercado deu, não o mérito do app.',
    ligacoes: ['tipico-na-compra', 'dashboard'],
    arquivos: ['docs/06-comparacao-estatistica.md', 'backend/src/jobs/cobertura-tipico.ts'],
    regras: ['r18'],
    etapas: ['C8.4.1'],
  },

  /* ── api & sync ──────────────────────────────────────────────────────── */
  {
    id: 'consulta-preco',
    nome: 'Consultar o preço típico',
    area: 'api',
    status: 'pronto',
    oque: 'Devolve a faixa típica de um produto no recorte geográfico do usuário, já com o fallback aplicado.',
    ligacoes: ['escopos', 'veredito', 'verificar'],
    arquivos: ['backend/src/consulta/servico-consulta.ts'],
    rotas: ['POST /consulta/preco'],
    etapas: ['C4.1'],
  },
  {
    id: 'busca-produtos',
    nome: 'Buscar produtos no pool',
    area: 'api',
    status: 'pronto',
    oque: 'Busca anônima por termo, ou os produtos mais populares da região — é o que faz o app ter valor para quem nunca escaneou nada.',
    detalhe:
      'Destrava o cold start: conta nova, sem cupom nenhum, já monta lista de compras e compara mercados. Com termo, a lógica é relevância de BUSCA (não casamento de identidade); sem termo, são os populares do recorte.',
    ligacoes: ['casamento-texto', 'lista-compras', 'comparar-mercados'],
    arquivos: ['backend/src/consulta/servico-busca-produtos.ts'],
    rotas: ['POST /consulta/produtos'],
    etapas: ['C4.4', 'C7.6'],
  },
  {
    id: 'comparar-lista',
    nome: 'Comparar a cesta por mercado',
    area: 'api',
    status: 'pronto',
    oque: 'Recebe a lista de compras e diz em qual mercado da região ela sai mais barata, item por item.',
    ligacoes: ['comparar-mercados', 'escopos'],
    arquivos: ['backend/src/consulta/servico-comparacao-lista.ts'],
    rotas: ['POST /consulta/lista'],
    etapas: ['C12.1'],
  },
  {
    id: 'delta-sync',
    nome: 'Delta sync das estatísticas',
    area: 'api',
    status: 'pronto',
    oque: 'Baixa só o que mudou desde a última vez, no recorte dos produtos que interessam ao usuário.',
    detalhe:
      'Cursor keyset (não offset — offset perdia linhas), paginado até o servidor dizer que acabou. O recorte é o histórico do usuário MAIS os produtos da lista de compras: item só listado, nunca comprado, também precisa de preço offline.',
    ligacoes: ['sincronizador', 'cache-local', 'pipeline'],
    arquivos: [
      'backend/src/sync/servico-sync.ts',
      'supabase/migrations/20260722120000_delta_sync_cursor_keyset.sql',
    ],
    rotas: ['POST /sync/estatisticas'],
    etapas: ['C4.2', 'C7.7'],
  },
  {
    id: 'sync-produtos',
    nome: 'Delta de catálogo (nome/marca)',
    area: 'api',
    status: 'pronto',
    oque: 'Desce o nome, a marca e a categoria dos produtos já em cache, para o catálogo ficar navegável offline.',
    detalhe:
      'O delta de estatística traz PREÇO por id de produto e mais nada — o app ficava com o típico de um produto que não sabia nomear, e caía na descrição crua do cupom ("ARR TP1 TIO J 5KG"). Aqui o app manda um lote de ids (teto de 200) e recebe os dados de exibição. Sem cursor de propósito: quem sabe o que falta é o app. O cache local revalida a cada 7 dias, porque a curadoria enriquece produto DEPOIS — sem isso, quem baixou o resumo antes do nome existir ficaria sem nome para sempre.',
    ligacoes: ['delta-sync', 'produtos', 'cache-local', 'curadoria'],
    arquivos: [
      'backend/src/sync/servico-sync-catalogo.ts',
      'app/src/nucleo/sincronizador.ts',
      'app/src/dados/repositorio-cache.ts',
    ],
    rotas: ['POST /sync/produtos'],
    etapas: ['C4.5'],
  },
  {
    id: 'auth',
    nome: 'Autenticação',
    area: 'api',
    status: 'pronto',
    oque: 'Login por e-mail/senha (ou Google) com token verificado do Supabase, guardado no cofre do sistema.',
    detalhe:
      'Antes o próprio id do usuário servia de senha — quem descobrisse o id ingeria no histórico alheio. Agora é JWT verificado com cache. A sessão fica no armazenamento seguro do sistema, não em texto puro.',
    ligacoes: ['ponte-email', 'conta-anonima'],
    arquivos: [
      'backend/src/auth/verificador-token.ts',
      'backend/src/auth/autenticador-supabase.ts',
      'app/src/auth/contexto.tsx',
      'app/src/telas/auth/LoginTela.tsx',
      'app/src/telas/auth/CadastroTela.tsx',
      'app/src/telas/auth/EsqueciSenhaTela.tsx',
      'app/src/telas/auth/RedefinirSenhaTela.tsx',
      'app/src/telas/auth/CabecalhoAuth.tsx',
    ],
    etapas: ['C4.3', 'C4.3.1'],
  },
  {
    id: 'ponte-email',
    nome: 'Ponte dos links de e-mail',
    area: 'api',
    status: 'pronto',
    oque: 'Página https que recebe o link de confirmação de e-mail e abre o app — porque o celular não abre `barganha://` vindo de um redirect.',
    detalhe:
      'O botão "Abrir no Barganha" existe porque o toque é o gesto que os navegadores exigem para lançar um esquema custom. App Links (abrir sem toque) fica para quando houver domínio próprio.',
    ligacoes: ['auth'],
    arquivos: ['site/auth-callback.html', 'app/src/auth/config.ts'],
    etapas: ['C4.3'],
  },
  {
    id: 'conta-anonima',
    nome: 'Conta e histórico no servidor',
    area: 'api',
    status: 'pronto',
    oque: 'Cria a conta, lista e apaga os cupons do usuário no servidor, e reidrata o histórico quando ele entra num aparelho novo.',
    ligacoes: ['auth', 'apagar-conta', 'sincronizador'],
    arquivos: ['backend/src/auth/servico-conta.ts', 'backend/src/http/rotas/conta.ts'],
    rotas: [
      'POST /conta/anonima',
      'DELETE /conta',
      'GET /ingestao/cupons',
      'GET /ingestao/cupom/:id',
      'DELETE /ingestao/cupom/:id',
    ],
    etapas: ['C4.3'],
  },
  {
    id: 'assinatura-backend',
    nome: 'Backend da assinatura',
    area: 'api',
    status: 'pronto',
    oque: 'Guarda o plano da conta (grátis ou Barganha+) e o expõe para o app consultar.',
    detalhe:
      'Tabela `assinatura` privada, com RLS que só permite ao dono LER a própria linha — nenhuma política de escrita, nem para o dono: só a service role do backend concede `plus` (diferente do `for all` de alerta_preco, porque autoconceder assinatura tem valor real, ao contrário de forjar um alerta). Um `plus` com `valido_ate` vencido (ou ilegível) responde como `gratis` — o serviço nunca confia num plano expirado por default. O app já chama o endpoint (C13.5) ao abrir sessão, revalidando o cache local com folga de 7 dias sem rede antes de degradar pro grátis.',
    falta:
      'Ainda não existe escritor: a tabela só ganha linha em C13.3 (compra confirmada pelo Google) e C13.4 (plus por contribuição) — hoje toda conta real lê `gratis`.',
    ligacoes: ['auth', 'plano'],
    arquivos: [
      'supabase/migrations/20260802090000_assinatura.sql',
      'backend/src/servicos/tipos-assinatura.ts',
      'backend/src/servicos/servico-assinatura.ts',
    ],
    rotas: ['GET /conta/estado'],
    etapas: ['C13.2'],
  },
  {
    id: 'rate-limit',
    nome: 'Teto de requisições',
    area: 'api',
    status: 'pronto',
    oque: 'Limita quantas vezes a mesma conta ou o mesmo IP pode chamar a API, contra abuso e raspagem do pool. Compartilhado entre instâncias via Postgres.',
    detalhe:
      'Implementação dual com a MESMA interface: `LimitadorJanelaFixa` (memória, dev/testes) e `LimitadorJanelaFixaPostgres` (produção). A contagem é feita por uma função do banco que incrementa e decide numa operação só, então requisições simultâneas não conseguem furar o teto lendo o mesmo número. Cada teto tem seu escopo na chave — o mesmo IP consultando preço e criando conta não divide um contador único. Se o banco cai, o teto degrada para o processo em vez de derrubar a API.',
    ligacoes: ['ingestao-qr', 'consulta-preco'],
    arquivos: [
      'backend/src/http/rate-limit.ts',
      'backend/src/http/limitador-postgres.ts',
      'backend/src/http/limitador-postgres.test.ts',
      'backend/src/http/servidor.ts',
      'supabase/migrations/20260801090000_rate_limit_janela.sql',
      'supabase/migrations/20260809090000_rate_limit_atomico.sql',
    ],
    etapas: ['C9.3.2'],
  },
  {
    id: 'curadoria',
    nome: 'Curadoria de produtos',
    area: 'api',
    status: 'pronto',
    oque: 'Corrige nome, marca e categoria dos produtos, confirma casamentos e manda reprocessar cupons de uma UF — por uma página web (`/curadoria/painel`), não só por curl. Antes de editar, o curador BUSCA o produto por nome ou EAN (resultado paginado) e clica em "Editar" para carregar o formulário — não precisa mais saber o `produtoCanonicoId` de cor.',
    detalhe:
      'Existe também o enriquecimento AUTOMÁTICO pelo catálogo VTEX das redes conhecidas (`job:enriquecer`), que preenche nome e categoria sem ninguém digitar. A confirmação de casamento por texto (`POST /curadoria/casamento/confirmar`) grava `produto_alias` e é feita pela mesma tela.',
    ligacoes: ['casamento-texto', 'enriquecer-vtex'],
    arquivos: [
      'backend/src/curadoria/tipos.ts',
      'backend/src/curadoria/servico-curadoria.ts',
      'backend/src/curadoria/servico-confirmacao-casamento.ts',
      'backend/src/auth/curadoria.ts',
      'backend/src/http/rotas/curadoria.ts',
      'backend/src/http/rotas/painel-curadoria-html.ts',
      'backend/src/persistencia/repositorio-memoria.ts',
      'backend/src/persistencia/repositorio-supabase.ts',
    ],
    rotas: [
      'GET /curadoria/painel',
      'GET /curadoria/produtos',
      'POST /curadoria/produto',
      'POST /curadoria/casamento/sugestoes',
      'POST /curadoria/casamento/confirmar',
      'POST /curadoria/reprocessar',
    ],
    etapas: ['C11.5'],
  },
  {
    id: 'enriquecer-vtex',
    nome: 'Enriquecimento por catálogo VTEX',
    area: 'api',
    status: 'parcial',
    oque: 'Lê o catálogo público das redes que usam VTEX e preenche nome, marca e categoria dos produtos automaticamente.',
    falta:
      'A categoria só existe no backend — ela não desce para o catálogo local, então a UI offline não agrupa por categoria. E nem todo mercado grande é VTEX: a matriz de plataformas está em docs/17.',
    detalhe:
      'Este mesmo cliente já lê o PREÇO anunciado — é a alavanca para as ofertas (C12.4), que por regra travada vivem numa camada separada e nunca entram na mediana.',
    ligacoes: ['curadoria', 'ofertas'],
    arquivos: [
      'backend/src/fontes/servico-enriquecimento-catalogo.ts',
      'backend/src/fontes/redes.ts',
      'backend/src/jobs/enriquecer-catalogo.ts',
      '.github/workflows/enriquecer-catalogo.yml',
    ],
    etapas: ['C11.5'],
  },
  {
    id: 'moderacao',
    nome: 'Moderação e denúncia',
    area: 'api',
    status: 'pronto',
    oque: 'Fila para revisar preços lançados à mão e denúncias de preço errado, com decisão de aprovar ou recusar.',
    detalhe:
      'Denunciar não publica nada: é sinal para a curadoria corrigir casamento ou unidade. O alvo é produto + recorte geográfico, nunca uma linha do pool — não existe ponteiro de usuário para lá, por desenho. As duas filas (lançamento manual e denúncia) se resolvem pela mesma página web de curadoria do C11.5 (`/curadoria/painel`), e o app já lança e denuncia pelo lado do usuário (ver `lancamento-manual`/`denuncia-app`).',
    ligacoes: ['denuncia-app', 'lancamento-manual', 'curadoria'],
    arquivos: [
      'backend/src/moderacao/servico-moderacao.ts',
      'backend/src/moderacao/servico-denuncia.ts',
      'backend/src/http/rotas/painel-curadoria-html.ts',
    ],
    rotas: [
      'GET /moderacao/fila',
      'POST /moderacao/:id/decisao',
      'POST /denuncia',
      'GET /denuncia/fila',
      'POST /denuncia/:id/decisao',
      'POST /lancamento-manual',
      'GET /curadoria/painel',
    ],
    etapas: ['C11.3', 'C12.5'],
  },
  {
    id: 'ofertas',
    nome: 'Ofertas anunciadas',
    area: 'api',
    status: 'falta',
    oque: 'Mostraria o preço anunciado por encarte/e-commerce das redes, numa camada separada e rotulada.',
    falta:
      'Nada implementado — nem tabela `oferta_anunciada`, nem coleta, nem exibição. É a fonte de receita da Fase 2 e depende de parceria com as redes, não de raspagem.',
    detalhe:
      'REGRA TRAVADA: preço anunciado JAMAIS entra em `observacao_preco` nem na mediana. Vive numa camada separada e rotulada como oferta. O veredito não é influenciado por quem paga — sem exceção, sem "leve destaque".',
    ligacoes: ['enriquecer-vtex'],
    arquivos: ['docs/18-ofertas-e-monetizacao.md'],
    regras: ['r8'],
    etapas: ['C12.4'],
  },

  /* ── telas do app ────────────────────────────────────────────────────── */
  {
    id: 'navegacao',
    nome: 'Navegação',
    area: 'app',
    status: 'pronto',
    oque: 'Quatro abas fixas — Início, Verificar, Lista, Perfil — com o botão de escanear no centro.',
    detalhe:
      'No redesign "3a" a aba Produtos deu lugar a Lista. Produtos não sumiu: virou tela de stack, alcançada pelo atalho dentro da Lista. A troca é de PRIORIDADE — montar a compra é a tarefa recorrente; navegar o catálogo é consulta.',
    ligacoes: ['inicio', 'verificar', 'lista-compras', 'perfil', 'scanner'],
    arquivos: [
      'app/src/navegacao/RaizNavegador.tsx',
      'app/src/navegacao/AbasNavegador.tsx',
      'app/src/navegacao/tipos.ts',
    ],
    etapas: ['C5.1'],
  },
  {
    id: 'abertura',
    nome: 'Abertura (primeiro uso)',
    area: 'app',
    status: 'pronto',
    oque: 'Boas-vindas, permissão de câmera e escolha da região — uma vez só por aparelho.',
    detalhe:
      'A permissão de câmera é pedida pela própria tela e mostra o erro real quando negada, em vez de travar em silêncio.',
    ligacoes: ['navegacao', 'regiao', 'onboarding'],
    arquivos: [
      'app/src/telas/abertura/AberturaFluxo.tsx',
      'app/src/telas/abertura/BemVindoTela.tsx',
      'app/src/telas/abertura/EscolherRegiaoTela.tsx',
      'app/src/telas/abertura/PermissaoCameraTela.tsx',
    ],
    etapas: ['C6.4'],
  },
  {
    id: 'onboarding',
    nome: 'Onboarding + consentimento',
    area: 'app',
    status: 'pronto',
    oque: 'Explica o app em três telas e coleta o consentimento de privacidade antes de qualquer dado sair do aparelho.',
    ligacoes: ['abertura', 'auth'],
    arquivos: ['app/src/telas/OnboardingTela.tsx', 'app/src/telas/SplashTela.tsx'],
    etapas: ['C6.4'],
  },
  {
    id: 'verificar',
    nome: 'Verificar (a gôndola)',
    area: 'app',
    status: 'pronto',
    oque: 'O momento de valor: escaneia o produto, digita o preço da etiqueta e recebe barato / na média / caro.',
    detalhe:
      'Resolve do cache local primeiro (funciona sem sinal) e refina online se houver conexão. Mostra os dois ângulos — região e seu histórico — mais a linha de promoção e a data do dado. Trocar de produto zera o preço digitado.',
    ligacoes: ['veredito-local', 'escanear-barras', 'consulta-preco', 'denuncia-app'],
    arquivos: [
      'app/src/telas/VerificarTela.tsx',
      'app/src/componentes/VeredictoBadge.tsx',
      'app/src/componentes/BarraPreco.tsx',
    ],
    regras: ['r6', 'r13'],
    etapas: ['C7.1', 'C7.2', 'C7.3'],
  },
  {
    id: 'veredito-local',
    nome: 'Veredito local (offline)',
    area: 'app',
    status: 'pronto',
    oque: 'Escolhe a melhor linha do cache do aparelho e monta o veredito sem internet, com a mesma regra do servidor.',
    ligacoes: ['veredito', 'cache-local', 'verificar'],
    arquivos: ['app/src/nucleo/veredito-local.ts', 'app/src/nucleo/tipico-regional.ts'],
    etapas: ['C7.2'],
  },
  {
    id: 'catalogo-local',
    nome: 'Catálogo do histórico',
    area: 'app',
    status: 'pronto',
    oque: 'Agrupa os itens das suas notas em produtos, para você ver o que costuma comprar e por quanto.',
    ligacoes: ['faixa-pessoal', 'produtos'],
    arquivos: ['app/src/nucleo/catalogo.ts', 'app/src/dados/repositorio-produtos.ts'],
    etapas: ['C7.4'],
  },
  {
    id: 'produtos',
    nome: 'Produtos e detalhe',
    area: 'app',
    status: 'pronto',
    oque: 'Lista os produtos monitorados e, no detalhe, mostra a evolução do preço nos últimos 6 meses.',
    detalhe:
      'Offline não agrupa por categoria — a categoria só existe no backend e não desce para o catálogo local.',
    ligacoes: ['catalogo-local', 'editar-produto'],
    arquivos: [
      'app/src/telas/ProdutosTela.tsx',
      'app/src/telas/ProdutoDetalheTela.tsx',
      'app/src/componentes/GraficoLinha.tsx',
    ],
    etapas: ['C7.4', 'C7.5'],
  },
  {
    id: 'lista-compras',
    nome: 'Lista de compras',
    area: 'app',
    status: 'pronto',
    oque: 'O checklist da compra: monta a lista misturando seu histórico com os produtos populares da região.',
    detalhe:
      'Sem histórico, ela se sustenta nos populares da região — é o que faz uma conta nova já ter utilidade. Os produtos da lista entram no recorte do sync, então têm preço offline mesmo sem nunca terem sido comprados.',
    ligacoes: ['busca-produtos', 'comparar-mercados', 'delta-sync'],
    arquivos: [
      'app/src/telas/ListaComprasTela.tsx',
      'app/src/componentes/FolhaAdicionarItem.tsx',
      'app/src/dados/repositorio-lista.ts',
      'app/src/nucleo/lista-regras.ts',
    ],
    etapas: ['C7.6', 'C12.1'],
  },
  {
    id: 'comparar-mercados',
    nome: 'Comparar mercados',
    area: 'app',
    status: 'pronto',
    oque: 'Diz onde a sua cesta sai mais barata, mostrando a cobertura item por item.',
    detalhe:
      'A cesta virou lista com cobertura por item de propósito: "R$ 87 no Mercado X" sem dizer que só 6 dos 15 itens tinham preço seria um número bonito e falso.',
    ligacoes: ['comparar-lista', 'lista-compras'],
    arquivos: ['app/src/telas/CompararMercadosTela.tsx'],
    etapas: ['C12.1'],
  },
  {
    id: 'inicio',
    nome: 'Início',
    area: 'app',
    status: 'pronto',
    oque: 'A porta de entrada: card de descontos do mês e as últimas compras.',
    detalhe:
      'O card diz DESCONTOS, não economia — é o desconto que veio no cupom, que o mercado deu. A economia de verdade (pagou × típico) é outra métrica e ainda não tem UI.',
    ligacoes: ['dashboard', 'compras', 'economia-real'],
    arquivos: ['app/src/telas/InicioTela.tsx', 'app/src/componentes/CartaoEconomia.tsx'],
    etapas: ['C8.1'],
  },
  {
    id: 'compras',
    nome: 'Notas e compras',
    area: 'app',
    status: 'pronto',
    oque: 'O histórico das notas escaneadas, com os itens de cada uma e a confirmação de cupom lido.',
    ligacoes: ['scanner', 'bd-local'],
    arquivos: [
      'app/src/telas/ComprasTela.tsx',
      'app/src/telas/NotaFiscalTela.tsx',
      'app/src/telas/CupomLidoTela.tsx',
    ],
    etapas: ['C6.3'],
  },
  {
    id: 'dashboard',
    nome: 'Painel de descontos',
    area: 'app',
    status: 'pronto',
    oque: 'Resumo dos descontos por mês, agrupado por produto.',
    ligacoes: ['inicio', 'economia-real'],
    arquivos: ['app/src/telas/DashboardTela.tsx'],
    etapas: ['C8.3'],
  },
  {
    id: 'perfil',
    nome: 'Perfil e conta',
    area: 'app',
    status: 'pronto',
    oque: 'Nome de exibição, preferências, mercados favoritos, sair e apagar a conta.',
    ligacoes: ['apagar-conta', 'conquistas', 'regiao'],
    arquivos: ['app/src/telas/PerfilTela.tsx', 'app/src/telas/ConfiguracoesContaTela.tsx'],
    etapas: ['C8.2'],
  },
  {
    id: 'conquistas',
    nome: 'Conquistas',
    area: 'app',
    status: 'pronto',
    oque: 'Selos de contribuição derivados do seu histórico — quantos cupons você já enviou, sequências, marcos.',
    detalhe: 'Conta só cupom PROCESSADO: um cupom que falhou no parser não vira conquista.',
    ligacoes: ['perfil'],
    arquivos: [
      'app/src/telas/ConquistasTela.tsx',
      'app/src/telas/ConquistaDetalheTela.tsx',
      'app/src/nucleo/gamificacao.ts',
    ],
    etapas: ['C12.2'],
  },
  {
    id: 'alertas',
    nome: 'Alertas de preço',
    area: 'app',
    status: 'pronto',
    oque: 'Avisa quando um produto que você acompanha cai de preço na sua região — inclusive com o app fechado, por notificação push.',
    detalhe:
      'O SQLite local continua sendo a fonte da verdade (funciona 100% offline, como antes); toda vez que o usuário cria/remove um alvo, um espelho é sincronizado no servidor (best-effort, nunca bloqueia o app) para o job `alerta-preco-servidor` avisar mesmo com o app fechado. Desligar a chave-mestra ou sair da conta apaga esse espelho — o controle de privacidade não pode "mentir" continuando a avisar depois de desligado. Tocar no aviso abre o produto: o push viaja com o id do produto e o app o consome no toque, inclusive quando o toque é o que LANÇOU o app (aí o destino fica estacionado até a navegação existir).',
    ligacoes: ['notificacoes', 'sincronizador', 'editar-produto', 'alerta-preco-servidor'],
    arquivos: [
      'app/src/telas/AlertasTela.tsx',
      'app/src/nucleo/alertas.ts',
      'app/src/nucleo/alertas-regras.ts',
      'app/src/nucleo/notificacoes-push.ts',
      'app/src/nucleo/notificacoes-push-regras.ts',
      'app/src/navegacao/ref.ts',
      'app/src/dados/repositorio-alertas.ts',
      'shared/src/dominio/alertas-regras.ts',
    ],
    etapas: ['C8.4'],
  },
  {
    id: 'alerta-preco-servidor',
    nome: 'Push de alerta de preço (servidor)',
    area: 'api',
    status: 'pronto',
    oque: 'Espelho no servidor do alerta local: registra o alvo do usuário e o token do aparelho, e um job periódico dispara a notificação push quando o preço bate.',
    detalhe:
      '`PUT /alertas` substitui o conjunto INTEIRO do usuário a cada sync (sem drift entre SQLite e servidor). O job (`job:alerta-preco`, a cada 30min, logo após o recálculo) só LÊ `preco_estatistica` — nunca escreve nela; dedupe por `disparado_em`, com histerese de 5% para rearmar antes de avisar de novo. Token de push tem TTL de 90 dias sem sinal de vida.',
    ligacoes: ['alertas'],
    arquivos: [
      'backend/src/servicos/servico-alertas.ts',
      'backend/src/servicos/tipos-alertas.ts',
      'backend/src/http/rotas/alertas.ts',
      'backend/src/jobs/alerta-preco.ts',
      '.github/workflows/alerta-preco.yml',
      'supabase/migrations/20260801130000_alerta_preco.sql',
    ],
    rotas: [
      'PUT /alertas',
      'DELETE /alertas',
      'POST /dispositivos/push',
      'DELETE /dispositivos/push',
    ],
    etapas: ['C8.4'],
  },
  {
    id: 'notificacoes',
    nome: 'Feed de avisos',
    area: 'app',
    status: 'pronto',
    oque: 'Lista local de avisos: alerta disparado, conquista nova, resumo do mês.',
    detalhe:
      'Tabela privada e derivada, no aparelho. A chave de dedupe usa bucket de tempo para o mesmo aviso não inundar o feed a cada sync.',
    ligacoes: ['alertas', 'bd-local'],
    arquivos: ['app/src/telas/NotificacoesTela.tsx', 'app/src/nucleo/notificacoes-regras.ts'],
    etapas: ['C8.4'],
  },
  {
    id: 'regiao',
    nome: 'Região da comparação',
    area: 'app',
    status: 'pronto',
    oque: 'Define em que cidade os preços são comparados — escolha manual, mais o raio.',
    detalhe:
      'A região é escolha MANUAL, não GPS automático: rastrear o usuário violaria a decisão travada, e a geografia do dado vem do CNPJ da loja. O app também sabe derivar uma sugestão pelas lojas das compras recentes.',
    ligacoes: ['escopos', 'delta-sync'],
    arquivos: [
      'app/src/telas/EditarRegiaoTela.tsx',
      'app/src/componentes/EditorRegiao.tsx',
      'app/src/nucleo/localizacao.ts',
    ],
    regras: ['r4', 'r19'],
    etapas: ['C7.2'],
  },
  {
    id: 'editar-produto',
    nome: 'Editar produto',
    area: 'app',
    status: 'pronto',
    oque: 'Ajusta o alerta de preço e a presença na lista de compras de um produto do catálogo.',
    ligacoes: ['alertas', 'lista-compras'],
    arquivos: ['app/src/telas/EditarProdutoTela.tsx'],
    etapas: ['C8.4'],
  },
  {
    id: 'denuncia-app',
    nome: 'Denunciar preço errado',
    area: 'app',
    status: 'pronto',
    oque: 'Botão para avisar que o preço mostrado está errado, alimentando a fila de curadoria.',
    ligacoes: ['moderacao', 'verificar'],
    arquivos: ['app/src/componentes/FolhaDenuncia.tsx'],
    rotas: ['POST /denuncia'],
    etapas: ['C12.5'],
  },
  {
    id: 'plano',
    nome: 'Plano grátis × Barganha+',
    area: 'app',
    status: 'parcial',
    oque: 'Decide o que cada plano pode ver: histórico de 3 meses, gráfico de 30 dias, 3 alertas e 3 mercados no ranking — ou tudo, no Barganha+.',
    detalhe:
      'A regra mora em shared (uma só, testada) e vale para app e backend. Duas travas: escanear cupom é ilimitado no grátis PARA SEMPRE, e o veredito é idêntico nos dois planos — pagar não compra uma verdade melhor. Um teste cruza a lista do que nunca pode ser cobrado com a dos recursos pagos e reprova o build se alguém trocar um de lado. O app já consulta `GET /conta/estado` (C13.2) ao abrir sessão e cacheia o resultado com folga de 7 dias sem rede antes de degradar pro grátis (nunca o contrário — a folga nunca ESTICA um plano pago). O interruptor de teste das Configurações da conta continua à parte: enquanto ele for a última escolha, o app não revalida contra o servidor, pra simulação não ser apagada no próximo boot.',
    falta:
      'Ninguém paga nada: não há cobrança nem Google Play Billing (C13.3), nem plus por contribuição (C13.4) — hoje toda conta real lê `gratis` do servidor. Dos cortes da tabela, quatro recursos seguem sem gate aplicado: três dependem de telas que ainda não existem (estatísticas C8.3, economia detalhada C8.4.1, ocultar ofertas C12.4) e o quarto, trocar de região livremente, precisa guardar a data da última troca. E os gates das telas que já existem (histórico, gráfico, alertas, ranking) e a revalidação não têm teste próprio.',
    ligacoes: [
      'compras',
      'produtos',
      'alertas',
      'comparar-mercados',
      'perfil',
      'assinatura-backend',
    ],
    arquivos: [
      'shared/src/plano/direitos.ts',
      'app/src/plano/contexto.tsx',
      'app/src/plano/FolhaPlus.tsx',
      'app/src/componentes/BloqueioPlus.tsx',
      'app/src/dados/repositorio-meta.ts',
      'app/src/api/cliente.ts',
    ],
    etapas: ['C13.1', 'C13.5'],
  },
  {
    id: 'ajuda',
    nome: 'Ajuda e sem conexão',
    area: 'app',
    status: 'pronto',
    oque: 'Central de ajuda com FAQ e a tela de "sem internet" com botão de tentar de novo.',
    ligacoes: ['navegacao'],
    arquivos: ['app/src/telas/AjudaTela.tsx', 'app/src/telas/SemConexaoTela.tsx'],
    etapas: ['C8.2'],
  },
  {
    id: 'design-system',
    nome: 'Design system "3a"',
    area: 'app',
    status: 'pronto',
    oque: 'A linguagem visual do app: tinta escura como cor de marca, neutros quentes, e o veredito colorido por semântica.',
    detalhe:
      'No "3a" a marca virou TINTA (#1B1B19) e inverte no escuro — sobre o primário usa-se `sobreTeal`, nunca branco fixo. Verde é barato, âmbar é na média, vermelho é caro; âmbar não é mais cor de marca. Gradientes por react-native-svg. Fonte Instrument Sans (a mesma deste painel).',
    ligacoes: ['navegacao'],
    arquivos: [
      'app/src/tema/cores.ts',
      'app/src/tema/tipografia.ts',
      'app/src/tema/ThemeContext.tsx',
      'design/design_handoff_barganha_3a/README.md',
    ],
    etapas: ['C5.2'],
  },

  /* ── dados locais ────────────────────────────────────────────────────── */
  {
    id: 'bd-local',
    nome: 'Banco no aparelho',
    area: 'dados',
    status: 'pronto',
    oque: 'SQLite dentro do celular com as suas notas, o cache de preços, a fila, a lista, os alertas e o feed.',
    detalhe:
      'Oito tabelas: cupom_local, item_cupom_local, cache_estatistica, fila_upload, meta_sync, lista_compras, alerta_preco, notificacao. O backup do Android está desligado de propósito (`allowBackup: false`) — o histórico não deve viajar para a nuvem da Google.',
    ligacoes: ['sincronizador', 'cache-local'],
    arquivos: ['app/src/dados/bd.ts', 'app/src/dados/migracoes.ts'],
    etapas: ['C5.3'],
  },
  {
    id: 'cache-local',
    nome: 'Cache de estatísticas e catálogo',
    area: 'dados',
    status: 'pronto',
    oque: 'A cópia local das faixas de preço da sua região — e do nome dos produtos — é o que faz o veredito e o catálogo funcionarem sem sinal.',
    detalhe:
      'Duas tabelas derivadas do servidor: cache_estatistica (quanto custa) e cache_produto (como se chama, C4.5). A primeira é zerada ao trocar de região, porque o recorte mudou; a segunda não, porque nome não muda de cidade.',
    ligacoes: ['delta-sync', 'sync-produtos', 'veredito-local'],
    arquivos: ['app/src/dados/repositorio-cache.ts'],
    etapas: ['C5.3', 'C7.2', 'C4.5'],
  },
  {
    id: 'sincronizador',
    nome: 'Sincronizador',
    area: 'dados',
    status: 'pronto',
    oque: 'Sobe a fila de cupons e baixa as estatísticas novas, no ritmo certo para não gastar bateria nem dados.',
    detalhe:
      'Conta falhas seguidas em vez de engolir o erro — sync quebrado em silêncio era o pior modo de falha. O cursor é reiniciado quando o recorte de região muda.',
    ligacoes: ['fila-upload', 'delta-sync', 'sync-produtos', 'cache-local'],
    arquivos: ['app/src/nucleo/sincronizador.ts', 'app/src/nucleo/ritmo.ts'],
    etapas: ['C4.2', 'C4.5', 'C6.2'],
  },
  {
    id: 'cliente-api',
    nome: 'Cliente da API',
    area: 'dados',
    status: 'pronto',
    oque: 'Fala com o backend usando os tipos compartilhados, com tempo de espera ajustado ao servidor grátis.',
    detalhe:
      'O Render free hiberna após ~15 min e acordar leva 30–60s. O teto deixou de ser fixo: 15s quando houve resposta nos últimos 5 min, 60s no primeiro contato depois do silêncio. Sem isso, o app inventava "sem conexão" para um servidor que estava só subindo.',
    ligacoes: ['sincronizador', 'consulta-preco'],
    arquivos: ['app/src/api/cliente.ts', 'app/src/api/politica-timeout.ts'],
    etapas: ['C5.4'],
  },
  {
    id: 'contratos',
    nome: 'Contratos compartilhados',
    area: 'dados',
    status: 'pronto',
    oque: 'Os tipos que app e backend usam em comum, para os dois nunca discordarem sobre o formato do dado.',
    detalhe:
      'Aqui moram também as regras que precisam decidir IGUAL nos dois lados: normalização, veredito, faixa, frescor e o mínimo de observações. Duplicar qualquer uma delas produziria o pior bug possível — o mesmo produto "barato" offline e "na média" online, sem nada no log.',
    ligacoes: ['veredito', 'normalizacao', 'cliente-api'],
    arquivos: ['shared/src/index.ts', 'shared/src/api/dtos.ts', 'shared/src/dominio/entidades.ts'],
    etapas: ['C1.3'],
  },

  /* ── operação ────────────────────────────────────────────────────────── */
  {
    id: 'saude',
    nome: 'Health check',
    area: 'operacao',
    status: 'pronto',
    oque: 'Endpoint que diz se o backend está de pé e se o banco responde, usado pelo deploy e pelo ping que evita a hibernação.',
    ligacoes: ['metricas', 'rollout'],
    arquivos: ['backend/src/observabilidade/saude.ts', '.github/workflows/manter-api-acordada.yml'],
    rotas: ['GET /saude', 'GET /saude/pronto'],
    etapas: ['C10.2'],
  },
  {
    id: 'metricas',
    nome: 'Métricas e telemetria',
    area: 'operacao',
    status: 'pronto',
    oque: 'Números da operação: taxa de parsing por estado, latência do banco, acerto do cache, request id rastreável do app até o log.',
    detalhe:
      'A telemetria de parsing é DURÁVEL (tabela no Postgres) — sobrevive ao sono e ao restart da instância grátis. `/metricas` exige o Bearer da curadoria.',
    ligacoes: ['log-mascarado', 'alerta-parsing'],
    arquivos: [
      'backend/src/observabilidade/telemetria.ts',
      'backend/src/observabilidade/metricas.ts',
    ],
    rotas: ['GET /metricas'],
    etapas: ['C10.2'],
  },
  {
    id: 'alerta-parsing',
    nome: 'Alerta de parser degradado',
    area: 'operacao',
    status: 'pronto',
    oque: 'A cada hora, verifica se um portal da SEFAZ começou a falhar muito e avisa.',
    detalhe:
      'Limiar: 30% de falha com no mínimo 20 tentativas na UF. Calibrado para não disparar com a oscilação normal do reCAPTCHA do RJ e sempre disparar quando um parser quebra de vez. `ALERTA_WEBHOOK_URL` cadastrado como secret no GitHub (02/08/2026) — disparo manual do workflow confirmou a leitura do secret e a execução ponta a ponta sem erro.',
    ligacoes: ['metricas'],
    arquivos: [
      'backend/src/observabilidade/alerta-parsing.ts',
      'backend/src/jobs/alerta-parsing.ts',
      '.github/workflows/alerta-parsing.yml',
    ],
    etapas: ['C10.2'],
  },
  {
    id: 'alerta-anomalias',
    nome: 'Alerta de anomalias',
    area: 'operacao',
    status: 'pronto',
    oque: 'Vigia sinais estranhos na base — variações de preço fora do esperado e padrões de abuso.',
    ligacoes: ['metricas'],
    arquivos: ['backend/src/jobs/alerta-anomalias.ts', '.github/workflows/alerta-anomalias.yml'],
    etapas: ['C10.2'],
  },
  {
    id: 'rollout',
    nome: 'Controle de rollout',
    area: 'operacao',
    status: 'pronto',
    oque: 'Verifica o deploy e permite voltar atrás automaticamente quando a versão nova sobe ruim.',
    ligacoes: ['saude'],
    arquivos: ['backend/src/rollout/controle-rollout.ts', '.github/workflows/verificar-deploy.yml'],
    etapas: ['C10.2'],
  },
  {
    id: 'ci',
    nome: 'CI e qualidade',
    area: 'operacao',
    status: 'pronto',
    oque: 'Em cada push, roda formatação, lint, checagem de tipos e a suíte de testes inteira.',
    ligacoes: ['release'],
    arquivos: ['.github/workflows/ci.yml'],
    etapas: ['C9.1'],
  },
  {
    id: 'release',
    nome: 'Build e publicação',
    area: 'operacao',
    status: 'falta',
    oque: 'Gera o pacote para a Google Play pelo EAS e envia para a faixa de teste.',
    falta:
      'Nunca rodou. Falta a conta de desenvolvedor, a service account da Play e a URL da API do perfil `production` — das três correções de configuração, a versão 1.0.0 e as variáveis do Supabase no EAS já estão feitas.',
    ligacoes: ['ci', 'site-legal'],
    arquivos: ['app/eas.json', '.github/workflows/release.yml'],
    etapas: ['C10.1'],
  },
  {
    id: 'site-legal',
    nome: 'Site legal (política)',
    area: 'operacao',
    status: 'pronto',
    oque: 'Páginas públicas de política de privacidade e exclusão de conta, exigidas pela Play, publicadas por script.',
    detalhe:
      'O `npm run publicar:site` espelha a pasta `site/` no repositório público. A ponte de autenticação também vive lá — e precisa estar publicada para o login por e-mail funcionar.',
    ligacoes: ['ponte-email', 'apagar-conta'],
    arquivos: [
      'site/politica-de-privacidade.html',
      'site/exclusao-de-conta.html',
      'scripts/publicar-site.ps1',
    ],
    etapas: ['C9.4', 'C10.0'],
  },

  /* ── funções que faltavam no primeiro levantamento ───────────────────── */
  {
    id: 'regiao-gps',
    nome: 'Detectar a região pelo GPS (opcional)',
    area: 'app',
    status: 'pronto',
    oque: 'O botão "Usar minha localização" pega a posição UMA vez, descobre o município e devolve para você confirmar.',
    detalhe:
      'É o único uso de GPS do app, e é transitório: a posição (latitude/longitude) nunca é gravada nem enviada. O que fica salvo é só o município escolhido — idêntico ao caminho manual. Não contradiz a regra travada nº 4: o GPS aqui ajuda a PESSOA a se localizar, não vira dado. A geografia do preço continua vindo do CNPJ da loja.',
    ligacoes: ['regiao', 'escopos'],
    arquivos: ['app/src/nucleo/gps.ts'],
    regras: ['r4', 'r19'],
    etapas: ['C7.2'],
  },
  {
    id: 'casamento-identidade',
    nome: 'Casamento direto do produto',
    area: 'estatistica',
    status: 'pronto',
    oque: 'Liga o item da nota ao produto da base por identidade exata: pelo código de barras quando existe, ou pela descrição normalizada + unidade quando não existe.',
    detalhe:
      'O segundo caminho é o que salva o RJ: vários portais mostram só o código INTERNO da loja, e sem ele NADA do cupom entraria na base. Identidade exata nunca funde produtos diferentes — o risco é o oposto, fragmentar ("CR LEITE X 200G" ≠ "CREME DE LEITE X 200G"), e isso a curadoria resolve fundindo depois. Casamento por SIMILARIDADE nunca é automático.',
    ligacoes: ['anonimizador', 'casamento-texto', 'curadoria'],
    arquivos: ['backend/src/anonimizacao/casamento.ts'],
    etapas: ['C3.4'],
  },
  {
    id: 'url-consulta',
    nome: 'Blindagem da URL do QR',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Antes de abrir qualquer coisa, força https e confere se o endereço é de um portal público conhecido.',
    detalhe:
      'Resolve dois problemas de uma vez. Funcional: muitos cupons ainda trazem `http://`, e portais que migraram para TLS FECHARAM a porta 80 — o RJ recusa a conexão antes de existir HTTP para redirecionar. Privacidade: essa URL carrega a chave de acesso de 44 dígitos na query, que é dado do mundo privado — em texto puro ela fica visível para qualquer um no mesmo Wi-Fi.',
    ligacoes: ['coletor-web', 'cliente-sefaz'],
    arquivos: ['shared/src/dominio/url-consulta.ts'],
    regras: ['r3'],
    etapas: ['C2.6'],
  },
  {
    id: 'busca-app',
    nome: 'Busca de produtos no app',
    area: 'app',
    status: 'pronto',
    oque: 'Ao procurar um produto para a lista, junta duas fontes: o que você já comprou e o catálogo da sua região.',
    detalhe:
      'A parte local responde no teclado, sem internet. A regional é best-effort: sem sinal devolve vazio, nunca erro — o que existe offline continua na tela. O histórico vem sempre na frente.',
    ligacoes: ['busca-produtos', 'lista-compras', 'catalogo-local'],
    arquivos: ['app/src/nucleo/busca-produtos.ts', 'app/src/nucleo/busca-produtos-regras.ts'],
    etapas: ['C7.6'],
  },
  {
    id: 'ocr',
    nome: 'OCR de cupons antigos',
    area: 'sefaz',
    status: 'falta',
    oque: 'Leria por foto os cupons de máquina antiga (ECF), que não têm QR code.',
    falta:
      'Não existe. O que está no código são "peças de encaixe" que FALHAM de propósito, devolvendo erro 501 — para o dia em que um motor de OCR entrar. Falta o OCR em si (imagem → texto), o parser de ECF e a tela de captura por foto.',
    detalhe:
      'Falhar explicitamente é a escolha certa aqui: devolver dado vazio envenenaria a base em silêncio. O caminho oficial continua sendo o QR. Adiado de propósito: é Fase 5+ (pós-lançamento) e exige cupons ECF reais para calibrar o parser — sem fixtures reais, não há como fazer isso com confiança. Não é bloqueador de nada antes do lançamento.',
    ligacoes: ['parsers'],
    arquivos: ['backend/src/ocr/parser-ecf.ts'],
    regras: ['r1'],
    etapas: ['C11.4'],
  },
  {
    id: 'limpeza-local',
    nome: 'Limpeza do aparelho ao sair',
    area: 'dados',
    status: 'pronto',
    oque: 'Ao sair da conta ou apagá-la, remove tudo do celular: notas, itens, fila, cache, lista, alertas, feed e o cursor de sincronização.',
    detalhe:
      'Preserva uma coisa só: o registro de que ESTE aparelho já aceitou a política de privacidade. Não é dado pessoal e não pertence à conta — apagá-lo obrigaria a reconsentir a cada logout, atrito sem ganho.',
    ligacoes: ['apagar-conta', 'bd-local', 'auth'],
    arquivos: ['app/src/nucleo/conta.ts'],
    etapas: ['C8.2'],
  },
  {
    id: 'request-id',
    nome: 'Rastro do erro (request id)',
    area: 'operacao',
    status: 'pronto',
    oque: 'Cada chamada leva um código único do app até o log do servidor — é a corda que liga "deu erro na minha tela" à linha que explica o porquê.',
    detalhe:
      'Vive no código compartilhado porque as duas pontas precisam da MESMA regra: o app gera e envia, o backend aceita o recebido em vez de inventar outro.',
    ligacoes: ['log-mascarado', 'metricas'],
    arquivos: ['shared/src/observabilidade/request-id.ts'],
    etapas: ['C10.4'],
  },
  {
    id: 'cronometro-banco',
    nome: 'Cronômetro de todo acesso ao banco',
    area: 'operacao',
    status: 'pronto',
    oque: 'Mede quanto tempo cada consulta ao banco leva, sem que nenhum serviço saiba que está sendo medido.',
    detalhe:
      'Feito com um invólucro na raiz da montagem, não método a método: o repositório implementa treze interfaces e mais de quarenta métodos — instrumentar um a um seriam quarenta chances de esquecer, e o esquecido é justamente o que vai ficar lento.',
    ligacoes: ['metricas', 'saude'],
    arquivos: ['backend/src/persistencia/instrumentar.ts'],
    etapas: ['C10.4'],
  },
  {
    id: 'telemetria-duravel',
    nome: 'Telemetria que sobrevive ao restart',
    area: 'operacao',
    status: 'pronto',
    oque: 'Além do contador em memória, grava no banco quantos cupons deram certo e errado por dia e por estado.',
    detalhe:
      'Essencial no plano grátis: a instância dorme e o contador em memória zera várias vezes ao dia. É essa tabela que vai dizer, durante o beta, se a taxa de parsing passou dos 90% exigidos.',
    ligacoes: ['metricas', 'alerta-parsing', 'unidades-recusadas'],
    arquivos: ['backend/src/observabilidade/telemetria-persistente.ts'],
    etapas: ['C10.2'],
  },
  {
    id: 'unidades-recusadas',
    nome: 'Ranking das unidades que faltam no mapa',
    area: 'operacao',
    status: 'pronto',
    oque: 'Lista, da mais frequente para a menos, as abreviações de unidade que a nota trouxe e o mapa não reconhece — com em quais estados apareceram.',
    detalhe:
      'Fecha o ciclo do mapa de unidades: o item que cai fora do pool por unidade desconhecida deixa de sumir em silêncio e vira uma linha ranqueada em /metricas (`?dias=` ajusta a janela, padrão 30). Lê o ACUMULADO no banco, não o contador em memória — que zera toda vez que a instância grátis dorme, o que na prática impedia juntar amostra suficiente para decidir. A leitura é best-effort: se a consulta falhar o bloco some (nunca vem vazio, que se leria como "nenhuma unidade recusada") e o resto do /metricas continua de pé, porque é justamente a página que se abre quando algo está errado. Contexto que muda a leitura do número: a unidade é escrita pelo ERP do varejista, não pelo portal do estado — abreviação nova chega quando entra um mercado com outro sistema de caixa, mesmo dentro de um estado que já funcionava.',
    ligacoes: ['metricas', 'normalizacao'],
    arquivos: [
      'backend/src/observabilidade/unidades-recusadas.ts',
      'supabase/migrations/20260809100000_unidades_recusadas_ranking.sql',
    ],
    rotas: ['GET /metricas'],
    etapas: ['C3.4', 'C10.2'],
  },
  {
    id: 'debug-html',
    nome: 'Depuração do portal sem vazar dado',
    area: 'privacidade',
    status: 'pronto',
    oque: 'Quando o app manda o HTML da SEFAZ, guarda só o ESQUELETO da página — a árvore de elementos e o tamanho dos textos, nunca os textos.',
    detalhe:
      'Ver o layout real do portal é o que permite consertar os seletores do parser (o do RJ foi escrito sobre um exemplo fixo). Mas a página da nota contém o CPF do consumidor — então o HTML cru nunca é gravado.',
    ligacoes: ['ingestao-html', 'log-mascarado'],
    arquivos: ['backend/src/observabilidade/debug-html.ts'],
    regras: ['r3'],
    etapas: ['C2.6'],
  },
  {
    id: 'alertas-configuraveis',
    nome: 'Alertas configuráveis de operação',
    area: 'operacao',
    status: 'pronto',
    oque: 'Regras ajustáveis sobre as anomalias medidas: latência do banco, acerto do cache, custo do processo, além da taxa de falha por estado.',
    detalhe:
      'Como o alerta de parsing, dependia do webhook não configurado para avisar alguém de fato — resolvido junto (`ALERTA_WEBHOOK_URL` cadastrado em 02/08/2026, disparo manual confirmou a execução).',
    ligacoes: ['alerta-anomalias', 'metricas'],
    arquivos: ['backend/src/observabilidade/regras-alerta.ts'],
    etapas: ['C10.4'],
  },
  {
    id: 'lancamento-manual',
    nome: 'Lançar preço de gôndola à mão',
    area: 'app',
    status: 'pronto',
    oque: 'Informa um preço visto na prateleira sem ter cupom, passando por moderação antes de valer.',
    detalhe:
      'Entra pela aba Verificar: com um EAN escaneado, "Lançar preço" abre o formulário (descrição, unidade, preço, CNPJ da loja, promoção) já com a região configurada preenchida. A geografia é pela LOJA (CNPJ); o id do usuário fica só no registro de moderação, para conter abuso, e nunca na base de preços. Sem tela de "escolher mercado" ainda — o CNPJ é digitado à mão.',
    ligacoes: ['moderacao'],
    arquivos: ['backend/src/http/rotas/contribuicao.ts', 'app/src/telas/LancamentoManualTela.tsx'],
    rotas: ['POST /lancamento-manual'],
    etapas: ['C11.3'],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   3b. INFRAESTRUTURA — código real que NÃO é função de produto.
   Existe para o verificador de cobertura poder exigir que todo arquivo do
   projeto esteja OU descrito como função, OU declarado aqui como encanamento.
   Nada fica invisível por esquecimento.
   ──────────────────────────────────────────────────────────────────────────── */

export const infraestrutura = [
  {
    grupo: 'Componentes de interface',
    oque: 'As peças visuais reutilizadas pelas telas: botões, campos, cartões, diálogos, folhas, esqueletos de carregamento, ícones, gradientes e animação.',
    prefixos: ['app/src/componentes/'],
  },
  {
    grupo: 'Tema e layout',
    oque: 'Cores, tipografia e espaçamento do design "3a".',
    prefixos: ['app/src/tema/'],
  },
  {
    grupo: 'Navegação',
    oque: 'A montagem das abas, do stack de autenticação e da barra inferior.',
    prefixos: ['app/src/navegacao/'],
  },
  {
    grupo: 'Encanamento do app',
    oque: 'Endereço da API, geração de id local, formatação de números e datas, orquestração do feed e do motor de alertas, cofre da sessão e cliente do Supabase.',
    prefixos: [
      'app/src/api/config.ts',
      'app/src/nucleo/id.ts',
      'app/src/nucleo/formato.ts',
      'app/src/nucleo/alertas.ts',
      'app/src/nucleo/notificacoes.ts',
      'app/src/auth/',
      'app/src/dados/repositorio-cupom.ts',
      'app/src/dados/repositorio-meta.ts',
      'app/src/dados/repositorio-notificacoes.ts',
    ],
  },
  {
    grupo: 'Encanamento do servidor',
    oque: 'Montagem do servidor HTTP, injeção de dependências, validação de entrada, tradução de erros, configuração de ambiente e a raiz que liga tudo.',
    prefixos: [
      'backend/src/http/servidor.ts',
      'backend/src/http/dependencias.ts',
      'backend/src/http/contexto.ts',
      'backend/src/http/esquemas.ts',
      'backend/src/http/erros-http.ts',
      'backend/src/http/rotas/',
      'backend/src/composicao.ts',
      'backend/src/config/',
      'backend/src/erros.ts',
      'backend/src/index.ts',
    ],
  },
  {
    grupo: 'Acesso a dados',
    oque: 'As duas implementações do repositório — Supabase em produção, memória nos testes — e o cliente do banco.',
    prefixos: [
      'backend/src/persistencia/repositorio-supabase.ts',
      'backend/src/persistencia/repositorio-memoria.ts',
      'backend/src/persistencia/supabase.ts',
      'backend/src/sefaz/cliente-sefaz-memoria.ts',
      'backend/src/fila/armazenamento-supabase.ts',
      'backend/src/fila/fila-memoria.ts',
    ],
  },
  {
    grupo: 'Apoio à observabilidade',
    oque: 'Sanitização de mensagens de erro, sondas do health check, contador em memória e as fontes de métrica.',
    prefixos: ['backend/src/observabilidade/'],
  },
  {
    grupo: 'Apoio ao domínio',
    oque: 'Tipos base, enums, o contrato da nota estruturada, o decodificador do QR, a tabela de códigos de UF, normalização e o cliente VTEX.',
    prefixos: [
      'shared/src/core.ts',
      'shared/src/dominio/enums.ts',
      'shared/src/dominio/nota-estruturada.ts',
      'backend/src/parsers/qr-payload.ts',
      'backend/src/parsers/cuf.ts',
      'backend/src/anonimizacao/normalizacao.ts',
      'backend/src/fontes/vtex/cliente-vtex.ts',
      'backend/src/auth/autenticador.ts',
      'backend/src/moderacao/tipos-denuncia.ts',
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   4. REGRAS DE NEGÓCIO
   ──────────────────────────────────────────────────────────────────────────── */

export const regras = [
  {
    id: 'r1',
    travada: true,
    titulo: 'Captura QR-first, nunca OCR',
    regra:
      'O dado vem do QR code da NFC-e consultado na SEFAZ — estruturado, confiável. OCR é plano B futuro para cupons antigos.',
    porque:
      'Ler número de foto de papel amassado gera preço errado, e preço errado destrói a única coisa que o app vende: confiança no veredito.',
    onde: ['backend/src/parsers/registro.ts'],
  },
  {
    id: 'r2',
    travada: true,
    titulo: 'Parsing só no backend',
    regra:
      'Um parser por estado, sempre no servidor. O app só envia o conteúdo do QR e guarda o QR cru de qualquer estado desde o dia 1.',
    porque:
      'Portal de SEFAZ muda de layout sem avisar. No backend a correção é um deploy; no app seria uma atualização de loja e milhões de cupons perdidos no caminho.',
    onde: ['backend/src/parsers/', 'backend/src/processamento/reprocessamento.ts'],
  },
  {
    id: 'r3',
    travada: true,
    titulo: 'Nunca persistir dado pessoal',
    regra:
      'O CPF é descartado no parsing. Dois mundos separados: o PRIVADO (suas notas, com chave de acesso) e o COMPARTILHADO (observações de preço soltas, sem usuário, sem chave).',
    porque:
      'Itens soltos e sem dono impedem reconstruir a cesta de alguém. É o que permite a base coletiva existir sem virar um rastro de consumo identificável.',
    onde: ['backend/src/anonimizacao/anonimizador.ts', 'shared/src/anonimizacao/gate.ts'],
  },
  {
    id: 'r4',
    travada: true,
    titulo: 'Geografia pela LOJA, nunca pelo usuário',
    regra: 'O recorte geográfico vem do CNPJ da loja. A região do usuário é escolha manual dele.',
    porque:
      'Preço varia muito por município, então a comparação precisa ser regional — mas obter isso rastreando o aparelho trocaria um problema por um pior.',
    onde: ['backend/src/estatistica/escopos.ts', 'app/src/nucleo/localizacao.ts'],
  },
  {
    id: 'r5',
    travada: true,
    titulo: 'Preço sempre normalizado',
    regra:
      'Todo preço vira R$/kg, R$/L ou R$/un antes de qualquer comparação. Nunca se compara valor cru.',
    porque:
      'R$ 8 de leite não diz nada sem saber se é 1 L ou 200 ml. Sem normalizar, o veredito é sorteio.',
    onde: ['shared/src/estatistica/normalizacao.ts'],
  },
  {
    id: 'r6',
    travada: true,
    titulo: 'Mediana, nunca média',
    regra:
      'O "típico" é a mediana; a faixa normal é p25–p75. A palavra na UI é "típico", nunca "médio".',
    porque:
      'Média é sensível a outlier e a promoção: uma compra em oferta profunda arrasta o número e o app passa a acusar de caro um mercado normal.',
    onde: ['backend/src/estatistica/agregacao.ts', 'shared/src/estatistica/veredito.ts'],
  },
  {
    id: 'r7',
    travada: true,
    titulo: 'Offline obrigatório',
    regra:
      'Registrar cupom e consultar preço funcionam sem internet. Sincronização é incremental, nunca download total.',
    porque:
      'Mercado é justamente onde o sinal cai. Um app de gôndola que precisa de internet não é usado na gôndola.',
    onde: ['app/src/nucleo/sincronizador.ts', 'app/src/dados/repositorio-cache.ts'],
  },
  {
    id: 'r8',
    travada: true,
    titulo: 'Muro da neutralidade',
    regra:
      'O veredito nunca é influenciado por quem paga, patrocina ou fornece dados. Preço anunciado jamais entra no pool nem na mediana — vive em camada separada e rotulada.',
    porque:
      'É o produto inteiro. Um "leve destaque" pago transforma o app em encarte, e encarte já existe de graça.',
    onde: ['docs/18-ofertas-e-monetizacao.md'],
  },
  {
    id: 'r9',
    titulo: 'Promoção segregada em três camadas',
    regra:
      'Primeiro a flag de desconto da própria nota; depois o cerco estatístico (abaixo de p25 − 1,5×IQR); e sempre exibição separada como "menor visto".',
    porque:
      'Colapsar promoção no típico produz a reclamação de "esse mercado está roubando" quando o R$ 5,00 era uma oferta pontual de três semanas atrás.',
    onde: ['backend/src/estatistica/agregacao.ts'],
    numeros: [{ rotulo: 'cerco IQR', valor: '1,5×' }],
  },
  {
    id: 'r10',
    titulo: 'Zona morta de 5% (+ deriva por idade)',
    regra:
      'A diferença contra a mediana precisa passar de 5% para o app opinar. Dentro disso é sempre "na média". A exigência cresce 0,8% por mês de idade do dado.',
    porque:
      'Percentil é posição, não magnitude. Num refrigerante (preço homogêneo) o p25 fica a ~1,5% da mediana e o app estampava BARATO por R$ 0,10 num item de R$ 8. A 5% o corte é cirúrgico: rebaixa ~42% dos "barato" em produtos homogêneos e só ~1% nos dispersos.',
    onde: ['shared/src/estatistica/veredito.ts'],
    numeros: [
      { rotulo: 'zona morta', valor: '5%' },
      { rotulo: 'deriva', valor: '0,8%/mês' },
    ],
  },
  {
    id: 'r11',
    titulo: 'Mínimo de 3 observações para confiar',
    regra:
      'Abaixo de 3 observações a faixa é exibida com ressalva de "poucos dados", e o fallback geográfico sobe de nível.',
    porque:
      'A constante vive no `shared` porque os dois lados precisam decidir IGUAL. Quando era copiada, calibrar significava mudar em três arquivos — e esquecer um dava "barato" offline e "na média" online.',
    onde: ['shared/src/estatistica/veredito.ts'],
    numeros: [{ rotulo: 'n mínimo', valor: '3' }],
  },
  {
    id: 'r12',
    titulo: 'Piso de exposição da loja',
    regra:
      'Estatística de loja com menos de 3 observações não é servida, nem sincronizada, nem exibida — e não volta como "maior base" no fallback.',
    porque:
      'Com n=1 a mediana da loja É o preço de uma compra específica. Expor isso re-identifica uma pessoa por dedução.',
    onde: ['shared/src/anonimizacao/exposicao.ts'],
    numeros: [{ rotulo: 'piso', valor: '3' }],
  },
  {
    id: 'r13',
    titulo: 'O veredito compara contra a faixa regular',
    regra: 'A prateleira é comparada contra p25–p75, nunca contra o menor promocional.',
    porque: 'Comparar com a melhor promoção histórica faria quase todo preço normal parecer caro.',
    onde: ['shared/src/estatistica/veredito.ts'],
  },
  {
    id: 'r14',
    titulo: 'Fallback hierárquico de escopo',
    regra:
      'Loja → município → região → UF. Sempre há resposta, no nível mais específico com dados, e a UI declara a base.',
    porque:
      'Silêncio é pior que uma resposta com ressalva. Mas a resposta tem que dizer de onde veio, ou vira número mágico.',
    onde: ['backend/src/estatistica/escopos.ts'],
  },
  {
    id: 'r15',
    titulo: 'Um cupom entra no pool uma vez só',
    regra:
      'O hash da chave de acesso é registrado. Contas diferentes com o mesmo cupom publicam uma vez.',
    porque:
      'Serve contra dois problemas ao mesmo tempo: distorção da mediana e abuso por multi-conta.',
    onde: ['supabase/migrations/20260712090000_chave_publicada_dedup_pool.sql'],
  },
  {
    id: 'r16',
    titulo: 'O típico é lido ANTES de o cupom entrar no pool',
    regra:
      'O snapshot do típico gravado em cada item usa a mediana de antes da própria compra do usuário.',
    porque:
      'Senão a métrica se auto-referencia: a sua compra entra na base e depois você se compara com ela. A ordem está travada por teste.',
    onde: [
      'backend/src/estatistica/tipico-na-compra.ts',
      'backend/src/processamento/fluxo.test.ts',
    ],
  },
  {
    id: 'r17',
    titulo: 'Nível loja fora da economia real',
    regra: 'O snapshot do típico usa município → região → UF. A própria loja é excluída.',
    porque:
      'Comparar com a mediana da loja onde você comprou tende a zero e responde "peguei promoção aqui?", não "escolhi bem?".',
    onde: ['backend/src/estatistica/tipico-na-compra.ts'],
  },
  {
    id: 'r18',
    titulo: 'Economia real é boletim, não troféu',
    regra:
      'Quando a UI existir: pode dar negativo, declara a cobertura ("23 de 41 itens comparados") e cada real é rastreável até o item.',
    porque:
      'Somar só o que ficou abaixo do típico infla o número e vira métrica de vaidade. E um número parcial se passando por total é mentira por omissão.',
    onde: ['docs/06-comparacao-estatistica.md'],
  },
  {
    id: 'r19',
    titulo: 'Região é sempre confirmada pelo usuário',
    regra:
      'Quem define a cidade da comparação é a pessoa. O app pode SUGERIR — pelas lojas das compras recentes, ou pelo GPS quando ela toca em "Usar minha localização" — mas nunca decide sozinho, e a posição não é guardada.',
    porque:
      'O GPS existe e é opcional: pega a posição uma vez, traduz para município, mostra para confirmar e descarta a coordenada. Só o município fica salvo, igual ao caminho manual. Isso mantém a regra travada nº 4 de pé — o que geolocaliza o PREÇO é o CNPJ da loja; o GPS só ajuda a pessoa a se achar no mapa.',
    onde: ['app/src/nucleo/localizacao-regras.ts', 'app/src/nucleo/gps.ts'],
  },
  {
    id: 'r20',
    titulo: 'Preço velho pesa menos, e muito velho não conta',
    regra:
      'Decaimento com meia-vida de 30 dias. Acima de 180 dias a observação é descartada; acima de 30 dias a faixa sai com ressalva.',
    porque:
      'Inflação de alimento é real. Um preço de 8 meses atrás descreve outro mercado — e o app não pode ser mais confiante que o motor que já jogou aquele dado fora.',
    onde: ['backend/src/estatistica/agregacao.ts', 'shared/src/estatistica/frescor.ts'],
    numeros: [
      { rotulo: 'meia-vida', valor: '30 dias' },
      { rotulo: 'janela', valor: '180 dias' },
      { rotulo: 'ressalva', valor: '30 dias' },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   5. ETAPAS C0–C13
   ──────────────────────────────────────────────────────────────────────────── */

export const camadas = [
  { id: 'C0', nome: 'Fundação', desc: 'Monorepo, tooling, CI, banco.' },
  { id: 'C1', nome: 'Domínio', desc: 'Modelo de dados e contratos.' },
  { id: 'C2', nome: 'Captura', desc: 'Ingestão e parsers da SEFAZ.' },
  { id: 'C3', nome: 'Estatística', desc: 'O motor do veredito.' },
  { id: 'C4', nome: 'API', desc: 'Consulta e sincronização.' },
  { id: 'C5', nome: 'Esqueleto', desc: 'Fundação do app.' },
  { id: 'C6', nome: 'Cupom', desc: 'Captura offline-first.' },
  { id: 'C7', nome: 'Veredito', desc: 'A consulta na gôndola.' },
  { id: 'C8', nome: 'Histórico', desc: 'Estatísticas e perfil.' },
  { id: 'C9', nome: 'Qualidade', desc: 'Testes, privacidade, performance.' },
  { id: 'C10', nome: 'Lançamento', desc: 'Release e operação.' },
  { id: 'C11', nome: 'Expansão', desc: 'Novos estados e plataformas.' },
  { id: 'C12', nome: 'Diferenciação', desc: 'O que faz escolherem o app.' },
  { id: 'C13', nome: 'Assinatura', desc: 'Planos grátis e pago.' },
];

export const etapas = [
  {
    codigo: 'C0.1',
    nome: 'Monorepo',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Três workspaces: app, backend, shared.',
  },
  {
    codigo: 'C0.2',
    nome: 'Tooling',
    fase: 'MVP',
    status: 'pronto',
    oque: 'TypeScript strict, ESLint, Prettier, EditorConfig.',
  },
  {
    codigo: 'C0.3',
    nome: 'CI + ambientes',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Lint e testes em cada push; Supabase de dev separado do de produção desde 24/07/2026.',
  },
  {
    codigo: 'C0.4',
    nome: 'Postgres + migrations',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Supabase provisionado com base de migrations versionadas.',
  },

  {
    codigo: 'C1.1',
    nome: 'Modelo de dados v1',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Entidades mapeadas às telas.',
  },
  {
    codigo: 'C1.2',
    nome: 'Migrations dos dois lados',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Lado privado e lado compartilhado, com RLS explícito em toda tabela.',
  },
  {
    codigo: 'C1.3',
    nome: 'Contratos no shared',
    fase: 'MVP',
    status: 'pronto',
    oque: 'NotaEstruturada e DTOs usados pelos dois lados.',
  },
  {
    codigo: 'C1.4',
    nome: 'Fronteira de anonimização',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Gate único de escrita no pool.',
  },

  {
    codigo: 'C2.1',
    nome: 'Ingestão + fila',
    fase: 'MVP',
    status: 'pronto',
    oque:
      'Endpoint do QR e fila DURÁVEL no Postgres com retry/backoff — reivindicação por ' +
      '`for update skip locked`, então duas instâncias nunca processam o mesmo cupom.',
  },
  {
    codigo: 'C2.2',
    nome: 'Parser RJ',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Parser do RJ com fixtures e testes, mais a WebView que vence o reCAPTCHA.',
    falta: 'Validação no aparelho físico com cupons reais.',
  },
  {
    codigo: 'C2.3',
    nome: 'Parser SP',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Parser de SP com fixtures e testes.',
  },
  {
    codigo: 'C2.4',
    nome: 'Anonimização',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Nota privada e observações anônimas na mesma transação.',
  },
  {
    codigo: 'C2.5',
    nome: 'Status + reprocessamento',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Ciclo de status do cupom e reprocessamento retroativo por estado.',
  },
  {
    codigo: 'C2.6',
    nome: 'Coletor por WebView',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Caminho de captura para portais com captcha (RJ).',
    falta: 'Mesma validação no device do C2.2.',
  },

  {
    codigo: 'C2.7',
    nome: 'Chave digitada',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Alternativa ao QR ilegível: os 44 dígitos entram pela mesma porta de ingestão.',
  },

  {
    codigo: 'C3.1',
    nome: 'Pipeline de estatística',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Mediana, percentis, mín/máx e n gravados para consulta rápida.',
  },
  {
    codigo: 'C3.2',
    nome: 'Decaimento temporal',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Peso por idade, meia-vida de 30 dias, janela de 180.',
    falta: 'Calibrar a meia-vida com dados reais.',
  },
  {
    codigo: 'C3.3',
    nome: 'Escopos geo + fallback',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Loja → município → região → UF, com piso de exposição na loja.',
  },
  {
    codigo: 'C3.4',
    nome: 'Casamento por EAN',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Casamento direto pelo código de barras. O mapa de unidades separa quatro grupos — fator fixo (kg/L/un/dúzia/cento), um volume = um item (pacote, garrafa, lata, balde, sachê…), embalagem múltipla que só entra com a contagem declarada (CX/FD/PACK/cartela/engradado) e as que nunca viram preço comparável (metro, kit, par). Plural resolve sozinho. A abreviação que o mapa nunca viu é contada por UF e volta ranqueada, com o acumulado do banco, em /metricas.',
  },
  {
    codigo: 'C3.5',
    nome: 'Casamento por texto',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Sugestão por similaridade para itens sem EAN, com confirmação via API.',
  },
  {
    codigo: 'C3.6.1',
    nome: 'Identidade do produto sem EAN',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Ordem única de casamento (EAN → código interno da loja → decisão da curadoria → descrição) e a junção de cadastros repetidos.',
    falta:
      'Os limiares das guardas (similaridade de 0,55, faixa de dúvida em 0,35, banda de preço de 3×, dormência de 18 meses) são chute fundamentado, não calibração: precisam de volume do beta para medir. E a herança de código entre filiais da mesma rede está DESLIGADA — é hipótese ("filiais compartilham o mesmo sistema"), e ligar hipótese antes de medir é como dado errado entra em escala.',
  },
  {
    codigo: 'C3.6.2',
    nome: 'Fila de curadoria dos códigos-loja suspeitos',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Tela para revisar as linhas que o casamento por (loja, código) recusou e deixou esperando: confirmar o canônico atual ou reapontar para outro.',
  },
  {
    codigo: 'C3.6',
    nome: 'Promoção + veredito híbrido',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Promoção segregada, dois ângulos lado a lado, zona morta por categoria e frescor.',
    falta:
      'NÃO é pendência de engenharia — é bloqueio externo, como em C3.2. O que faltava (zona morta por categoria) agora existe dos dois lados: o veredito resolve a zona morta por FAMÍLIA de categoria (`fresco` / `industrializado` / `outros`, em `shared`, para app e backend decidirem igual) e o `job:calibracao` ganhou a quarta medição, que é a única dele sobre o VEREDITO e não sobre a agregação. Ela mede as duas metades separadamente: a BASE, pelo ruído de amostra (metade do balanço da mediana numa célula de 8 observações, p75 da família), e a DERIVA mensal, pela taxa entre o terço velho e o terço novo de cada grupo. A base fica igual em todas as famílias de propósito — ela mede irrelevância ("R$ 0,50 num item de R$ 10 não muda decisão"), e subi-la no fresco comeria justamente o sinal real que o app existe para mostrar; quem varia é a deriva (2%/mês no fresco contra 0,8%). O que falta são OBSERVAÇÕES: a medição pede 12+ preços regulares por grupo de município, e o pool do beta tinha 6 no total em 09/08/2026. Os números da tabela seguem chute fundamentado até lá — e o mesmo cron mensal avisa quando a medição passar a discordar deles.',
  },

  {
    codigo: 'C4.1',
    nome: 'Consulta de estatística',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Faixa típica com o fallback aplicado.',
  },
  {
    codigo: 'C4.2',
    nome: 'Delta sync',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Cursor keyset paginado, no recorte do usuário.',
  },
  {
    codigo: 'C4.3',
    nome: 'Autenticação',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Login com JWT verificado do Supabase e sessão no cofre do sistema, com a ponte de e-mail publicada e na allow-list do Supabase.',
  },
  {
    codigo: 'C4.3.1',
    nome: 'Endurecer o token',
    fase: 'MVP',
    status: 'pronto',
    oque: 'O id do usuário deixou de servir como senha; agora é JWT verificado com cache.',
  },
  {
    codigo: 'C4.4',
    nome: 'Busca no pool',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Busca anônima por termo ou populares da região — destrava o cold start.',
  },
  {
    codigo: 'C4.5',
    nome: 'Delta de catálogo',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Desce nome/marca/categoria para o catálogo ficar navegável offline.',
    detalhe:
      'POST /sync/produtos recebe um lote de ids e devolve os dados de exibição. O app guarda em cache_produto (migração v11), revalida a cada 7 dias e passa a mostrar o nome de catálogo no lugar da descrição do cupom.',
  },

  {
    codigo: 'C5.1',
    nome: 'Expo + navegação',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Quatro abas mais o scan central; Expo SDK 54.',
  },
  {
    codigo: 'C5.2',
    nome: 'Design system',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Redesign "3a": tinta como marca, neutros quentes, Instrument Sans, modo escuro.',
  },
  {
    codigo: 'C5.3',
    nome: 'SQLite local',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Oito tabelas: espelho privado, cache, fila, lista, alertas, feed.',
  },
  {
    codigo: 'C5.4',
    nome: 'Cliente de API tipado',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Usa os contratos do shared, com timeout adaptado ao cold start.',
  },

  {
    codigo: 'C6.1',
    nome: 'Câmera + QR cru',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Lê o QR e grava o conteúdo cru antes de qualquer processamento.',
  },
  {
    codigo: 'C6.2',
    nome: 'Fila idempotente',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Sobe sem duplicar, com retry, e sobrevive a sair da conta.',
  },
  {
    codigo: 'C6.3',
    nome: 'Tela da nota',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Itens parseados e confirmação de cupom lido.',
  },
  {
    codigo: 'C6.4',
    nome: 'Onboarding + consentimento',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Três telas mais o gate de abertura, uma vez por aparelho.',
  },

  {
    codigo: 'C7.1',
    nome: 'Tela Verificar',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Scan de barras como caminho principal, busca por nome como alternativa.',
  },
  {
    codigo: 'C7.2',
    nome: 'Veredito do cache',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Resolve offline com a mesma lógica do servidor e refina online.',
  },
  {
    codigo: 'C7.3',
    nome: 'Exibição híbrida',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Dois ângulos, linha de promoção à parte e data do dado.',
  },
  {
    codigo: 'C7.4',
    nome: 'Produtos',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Catálogo dos produtos monitorados.',
  },
  {
    codigo: 'C7.5',
    nome: 'Detalhe do produto',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Evolução do preço em 6 meses.',
  },
  {
    codigo: 'C7.6',
    nome: 'Catálogo regional',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Lista e comparação mesclam histórico com o pool da região.',
  },
  {
    codigo: 'C7.7',
    nome: 'Lista no escopo do sync',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Produto só listado, nunca comprado, também tem preço offline.',
  },

  {
    codigo: 'C8.1',
    nome: 'Início',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Card de descontos e últimas compras.',
  },
  {
    codigo: 'C8.2',
    nome: 'Perfil',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Dados, preferências, mercados favoritos, sair e apagar conta.',
  },
  {
    codigo: 'C8.3',
    nome: 'Estatísticas',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Painel de descontos por mês e por produto.',
  },
  {
    codigo: 'C8.4',
    nome: 'Alertas + tendência',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Alerta de queda de preço por push (mesmo com o app fechado) e feed local de avisos.',
  },
  {
    codigo: 'C8.4.1',
    nome: 'Economia real',
    fase: 'Pós',
    status: 'parcial',
    oque: 'O snapshot do típico já é gravado em cada item comprado.',
    falta:
      'A UI inteira. Gatilho: cobertura medida acima de ~60% dos itens de um cupom típico — não uma data. A medição já dá para rodar (`job:cobertura-tipico`); falta o volume do beta para o gatilho ser atingido.',
  },

  {
    codigo: 'C9.1',
    nome: 'Pirâmide de testes',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Unit, integração e e2e, com fixtures de cupons reais.',
  },
  {
    codigo: 'C9.2',
    nome: 'Gate LGPD',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Checagem de re-identificação, piso de exposição, saneamento do QR.',
    falta:
      'A purga de inativos já tem o canal de e-mail no código, mas espera os segredos de produção e a revisão jurídica da transferência internacional (docs/04 §Operadores).',
  },
  {
    codigo: 'C9.2.1',
    nome: 'Dedup do pool',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Mesmo cupom por contas diferentes publica uma vez.',
  },
  {
    codigo: 'C9.2.2',
    nome: 'Cifra das colunas privadas',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Cifra reversível por envelope (chave fora do banco) de `chave_acesso` e da descrição do item.',
    falta:
      'Ativação em produção (aplicar a migração + configurar `CIFRA_CHAVE_ATUAL` no Render, juntos) — gate da Fase 3, bloqueador b6, docs/19 §8.',
  },
  {
    codigo: 'C9.3',
    nome: 'Performance',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Índices, EXPLAIN e recálculo fora do caminho crítico.',
  },
  {
    codigo: 'C9.3.1',
    nome: 'Ingestão transacional',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Uma função SQL grava loja, itens, pool e status numa transação.',
  },
  {
    codigo: 'C9.3.2',
    nome: 'Rate limit',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Teto por conta e por IP nas rotas públicas, contado no banco e válido para todas as instâncias.',
    detalhe:
      'O contador saiu da memória do processo e foi para o banco. Três coisas que só apareciam sob carga foram corrigidas: a contagem agora é feita numa operação única (antes, requisições simultâneas liam o mesmo número e o teto vazava justamente durante um ataque); cada teto tem seu próprio escopo (antes, o mesmo IP consultando preço e criando conta somava tudo num contador só); e a limpeza das janelas velhas respeita a duração de cada uma (antes, a limpeza do teto de 1 minuto apagava o de 1 hora, e o limite de 20 contas por hora virava 20 por minuto). Se o banco ficar indisponível, o teto volta a valer por processo em vez de derrubar a API inteira.',
  },
  {
    codigo: 'C9.3.3',
    nome: 'Endurecimento de segurança do banco',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Correções apontadas pelo linter de segurança do Supabase: RLS explícito em toda tabela e caminho de busca fixo nas funções.',
    detalhe:
      'Resolve o drift de RLS: a proteção automática vive só no banco de nuvem, então toda tabela nova precisa de RLS escrito na migração.',
  },
  {
    codigo: 'C9.4',
    nome: 'Política publicada',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Política de privacidade e exclusão de conta no ar, publicadas por script.',
  },
  {
    codigo: 'C9.5',
    nome: 'Log e sanitização',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Log JSON com a mesma máscara nos dois lados, request id rastreável.',
  },

  {
    codigo: 'C10.0',
    nome: 'Conformidade de loja',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Política em URL pública, página de exclusão de conta, Expo SDK 54 e target API novo.',
    falta:
      'Data Safety e classificação de conteúdo: as respostas estão prontas em docs/14, mas não há console onde preencher (falta a conta).',
  },
  {
    codigo: 'C10.0.1',
    nome: 'Política de privacidade no ar',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Página pública no GitHub Pages, gerada do documento do projeto.',
  },
  {
    codigo: 'C10.0.2',
    nome: 'Exclusão de conta',
    fase: 'MVP',
    status: 'pronto',
    oque: 'No app (Perfil) e na web — a Play exige as duas para app com cadastro.',
  },
  {
    codigo: 'C10.0.3',
    nome: 'Formulário Data Safety',
    fase: 'MVP',
    status: 'parcial',
    oque: 'As respostas estão escritas e justificadas em docs/14.',
    falta: 'Não há onde preencher enquanto a conta de desenvolvedor não existir.',
  },
  {
    codigo: 'C10.0.4',
    nome: 'Target API 36',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Exigência para apps novos a partir de 31/08/2026. O upgrade para o Expo SDK 54 já foi feito.',
    falta: 'Validar num aparelho com um dev build novo — o binário antigo não abre o código novo.',
  },
  {
    codigo: 'C10.0.5',
    nome: 'Classificação e ficha da loja',
    fase: 'MVP',
    status: 'parcial',
    oque: 'App utilitário de compras, sem conteúdo sensível. Textos e roteiro de capturas prontos em docs/16.',
    falta: 'Preencher no console e produzir as capturas de tela com dados semeados.',
  },
  {
    codigo: 'C10.1',
    nome: 'Build EAS + Play',
    fase: 'MVP',
    status: 'falta',
    oque: 'Gerar o pacote e subir na faixa de teste fechado.',
    falta:
      'Conta de desenvolvedor (US$ 25), service account da Play, e as três correções de configuração dos bloqueadores.',
  },
  {
    codigo: 'C10.2',
    nome: 'Observabilidade',
    fase: 'MVP',
    status: 'parcial',
    oque: 'Telemetria durável por estado, health check, métricas, rollback automático.',
    falta: 'O webhook do alerta de parsing não está configurado — o alerta não avisa ninguém.',
  },
  {
    codigo: 'C10.3',
    nome: 'Lançamento faseado',
    fase: 'MVP',
    status: 'falta',
    oque: 'Rollout 10% → 25% → 50% → 100% com gate a cada passo.',
    falta: 'Depende do beta fechado concluído.',
  },

  {
    codigo: 'C10.4',
    nome: 'Observabilidade profunda',
    fase: 'MVP',
    status: 'pronto',
    oque: 'Health check detalhado, código de rastreio do erro do app até o log, cronômetro de banco, acerto de cache, custo do processo e alertas configuráveis.',
  },

  {
    codigo: 'C11.1',
    nome: 'Novos estados',
    fase: 'Pós',
    status: 'parcial',
    oque: 'MG e o parser ENCAT genérico já existem; o reprocessamento retroativo funciona.',
    falta:
      'Os demais estados. Cada um é um arquivo novo no registro, mas precisa de cupom real para as fixtures.',
  },
  {
    codigo: 'C11.2',
    nome: 'iOS / App Store',
    fase: 'Pós',
    status: 'falta',
    oque: 'Publicar na App Store.',
    falta: 'Tudo. O perfil de build iOS existe no eas.json, mas nada foi feito.',
  },
  {
    codigo: 'C11.3',
    nome: 'Lançamento manual',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Tela no app (a partir de um EAN escaneado) + backend + fila de moderação pela página de curadoria.',
  },
  {
    codigo: 'C11.4',
    nome: 'OCR de cupons antigos',
    fase: 'Pós',
    status: 'falta',
    oque: 'Leria por foto os cupons de máquina antiga (ECF), que não têm QR.',
    falta:
      'Tudo. O que existe são peças de encaixe que FALHAM de propósito (erro 501) — falhar explícito em vez de devolver dado vazio que envenenaria a base. Falta o motor de OCR, o parser de ECF e a tela de foto. Adiado de propósito: exige cupons ECF reais para calibrar o parser (o layout varia por fabricante de impressora e época) e não é bloqueador do lançamento — só entra em Fase 5+.',
  },
  {
    codigo: 'C11.5',
    nome: 'Enriquecimento de produtos',
    fase: 'Pós',
    status: 'parcial',
    oque: 'Curadoria manual por página web (`/curadoria/painel`) e enriquecimento automático pelo catálogo VTEX.',
    falta:
      'A categoria não desce para o app — a UI offline não agrupa por categoria. E nem toda rede é VTEX.',
  },

  {
    codigo: 'C12.1',
    nome: 'Cesta comparada',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Onde a sua lista sai mais barata, com cobertura por item.',
  },
  {
    codigo: 'C12.2',
    nome: 'Gamificação',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Selos de contribuição derivados do histórico local.',
  },
  {
    codigo: 'C12.3',
    nome: 'Combustíveis e farmácia',
    fase: 'Pós',
    status: 'falta',
    oque: 'Recortes por categoria com curadoria e UI própria.',
    falta: 'Nada implementado.',
  },
  {
    codigo: 'C12.4',
    nome: 'Ofertas anunciadas',
    fase: 'Pós',
    status: 'falta',
    oque: 'Camada separada e rotulada de preço anunciado.',
    falta: 'Nem tabela, nem coleta, nem exibição. É a receita da Fase 2 e depende de parceria.',
  },
  {
    codigo: 'C12.5',
    nome: 'Denúncia de preço',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Botão no app, fila de curadoria no backend e página web para resolver a fila.',
  },

  {
    codigo: 'C13.1',
    nome: 'Conceito de direito',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Plano e recurso em shared, com uma função única que decide o que cada plano pode — e um teste que impede cobrar pelo veredito.',
  },
  {
    codigo: 'C13.2',
    nome: 'Backend da assinatura',
    fase: 'Pós',
    status: 'pronto',
    oque: 'Tabela privada de assinatura, com RLS, e o estado do plano exposto na conta.',
    detalhe:
      'Tabela `assinatura` (usuario_id, plano, origem, valido_ate) com RLS só de SELECT do dono — sem política de escrita nem para o dono, porque só a service role do backend pode conceder `plus` (diferente do padrão `for all` de alerta_preco). `GET /conta/estado` devolve `{ plano, validoAte? }`, tratando um `plus` com `valido_ate` vencido (ou ilegível) como `gratis` — nunca confia num plano expirado. Ainda sem escritor: a tabela só ganha linhas em C13.3 (compra) e C13.4 (contribuição). O app já consome o endpoint (C13.5), revalidando o cache local a cada sessão.',
    arquivos: [
      'supabase/migrations/20260802090000_assinatura.sql',
      'backend/src/servicos/servico-assinatura.ts',
      'backend/src/http/rotas/conta.ts',
    ],
    rotas: ['GET /conta/estado'],
  },
  {
    codigo: 'C13.3',
    nome: 'Google Play Billing',
    fase: 'Pós',
    status: 'falta',
    oque: 'Compra pela loja e webhook do Google confirmando o estado no backend.',
    falta:
      'Nada implementado. Cobrança de conteúdo digital fora do Play derruba o app da loja, e quem decide se está pago é o backend, nunca o app.',
  },
  {
    codigo: 'C13.4',
    nome: 'Plus por contribuição',
    fase: 'Pós',
    status: 'falta',
    oque: 'Quem manda 4 cupons processados no mês ganha o plano pago no mês seguinte.',
    falta:
      'Nada implementado. É o que impede a assinatura de brigar com o fluxo de cupons que alimenta a mediana.',
  },
  {
    codigo: 'C13.5',
    nome: 'Limites no app',
    fase: 'Pós',
    status: 'parcial',
    oque: 'Cadeados com prévia do valor no histórico, no gráfico do produto, nos alertas e no ranking de mercados; a folha do Barganha+ abre de qualquer um deles. O app consulta `GET /conta/estado` a cada sessão e cacheia com folga de 7 dias sem rede antes de degradar pro grátis.',
    falta:
      'Quatro recursos estão DECLARADOS e não consultados — nenhuma tela chama podeUsar(). Três dependem de telas que não existem (estatísticas C8.3, economia detalhada C8.4.1, ocultar ofertas C12.4) e o quarto, trocar de região livremente, precisa guardar a data da última troca. "Listas ilimitadas" não é um cadeado: o app tem UMA lista, sem id. Os gates das telas e a revalidação não têm teste próprio.',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   6. PUBLICAR — o caminho até a loja. É uma sequência real, por isso numerada.
   ──────────────────────────────────────────────────────────────────────────── */

export const publicacao = {
  resumo:
    'A Google Play exige, para conta pessoal nova, 12+ testadores ativos por 14 dias corridos antes de liberar produção. O relógio só começa quando a faixa de teste fechado existe e as pessoas entram — então tudo que vem antes é caminho crítico.',
  custo: 'US$ 25, uma vez, na conta de desenvolvedor. Todo o resto roda em free tier.',
  fases: [
    {
      n: 0,
      titulo: 'Destravar o que impede o build',
      duracao: '1 dia',
      status: 'parcial',
      passos: [
        { t: 'Trocar a URL da API no perfil `production` do EAS', feito: true },
        { t: 'Subir a versão do app para 1.0.0', feito: true },
        { t: 'Cadastrar as variáveis do Supabase no EAS (`eas env:create`)', feito: true },
        { t: 'Validar a captura do RJ num aparelho físico, com cupons reais', feito: false },
        { t: 'Configurar o webhook do alerta de parsing', feito: true },
      ],
    },
    {
      n: 1,
      titulo: 'Backend no ar',
      duracao: 'meio dia',
      status: 'parcial',
      passos: [
        { t: 'Aplicar as migrations em produção (`supabase db push`)', feito: true },
        { t: 'Render free pelo blueprint, com os segredos preenchidos', feito: true },
        {
          t: 'Crons do GitHub Actions ativos (recálculo, republicação, alertas, keep-warm)',
          feito: true,
        },
        { t: 'Smoke test: `GET /saude` responde ok', feito: true },
        {
          t: 'Recálculo completo depois do deploy, para o frescor preencher todas as linhas',
          feito: false,
        },
      ],
    },
    {
      n: 2,
      titulo: 'Conformidade publicada',
      duracao: 'meio dia',
      status: 'parcial',
      passos: [
        { t: 'Política de privacidade em URL pública', feito: true },
        { t: 'Página de exclusão de conta em URL pública', feito: true },
        { t: 'Ponte de autenticação publicada e na allow-list do Supabase', feito: false },
        {
          t: 'Respostas de Data Safety e classificação de conteúdo prontas (docs/14)',
          feito: true,
        },
      ],
    },
    {
      n: 3,
      titulo: 'Beta fechado — os 14 dias',
      duracao: '14 dias corridos',
      status: 'falta',
      passos: [
        { t: 'Criar a conta de desenvolvedor (US$ 25) e o app "Barganha"', feito: false },
        {
          t: 'Preencher a ficha: política, exclusão de conta, Data Safety, classificação',
          feito: false,
        },
        { t: 'Criar a faixa de teste fechado e a lista de testadores por e-mail', feito: false },
        { t: 'Build de produção e primeiro upload manual do .aab', feito: false },
        { t: 'Recrutar 20 pessoas (para garantir 12 ativos), todas na mesma semana', feito: false },
        {
          t: 'Concentrar em 1–2 municípios — 2 cidades densas valem mais que 10 ralas',
          feito: false,
        },
        { t: 'Meta de semeadura: 2+ cupons por testador por semana', feito: false },
        {
          t: 'QA dirigido: captcha do RJ, item sem EAN, mercado sem sinal, câmera, exclusão de conta, veredito',
          feito: false,
        },
      ],
      gates: [
        '12+ testadores contínuos por 14 dias',
        'Taxa de parsing acima de 90% por UF ativa',
        'Veredito coerente nos municípios semeados, validado à mão',
        'Zero incidentes de privacidade',
        'Crash-free acima de 99%',
      ],
    },
    {
      n: 4,
      titulo: 'Produção com rollout faseado',
      duracao: '7 dias',
      status: 'falta',
      passos: [
        { t: 'D0 — 10%: 48 h com crash-free > 99% e parsing > 90%', feito: false },
        { t: 'D2 — 25%: 48 h estáveis, latência aceitável', feito: false },
        { t: 'D4 — 50%: 72 h estáveis', feito: false },
        { t: 'D7 — 100%', feito: false },
      ],
      nota: 'Se quebrar: "interromper implantação" segura no % atual. Correção só de JS vai por OTA sem revisão da loja; problema de parsing é backend — corrige e reprocessa, sem tocar na loja.',
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────────
   6.5. O PLANO — as duas metades separadas pelo beta.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A pergunta que esta seção responde: "o que falta para lançar, e o que vem
 * depois?".
 *
 * O QUE É CURADO AQUI (e só isto): em que lado do beta cada etapa cai, e por
 * que uma frente vem antes da outra. Isso não é derivável — o campo `fase` das
 * etapas diz `MVP`/`Pós`, que NÃO é o mesmo corte: `C10.3` (rollout faseado) é
 * MVP e acontece depois do beta; `C11.5` (enriquecimento) é Pós e já está meio
 * pronto. Quem decide o corte é o gate do beta, não o número da etapa.
 *
 * O QUE NÃO É CURADO: os itens em si. Passos vêm de `publicacao.fases`,
 * travas de `bloqueadores`, trabalho de código de `etapas`, e o que fica para
 * depois de `dividas`. Nada é redigitado — se um passo virar `feito: true` lá,
 * ele muda aqui sozinho.
 *
 * A REDE DE SEGURANÇA: o gerador exige que TODA etapa não-pronta esteja citada
 * em exatamente um lado (`etapas` de alguma frente). Etapa nova sem lugar no
 * plano reprova o `painel:conferir` — é o que impede o plano de envelhecer
 * calado enquanto o catálogo cresce.
 */
export const plano = {
  resumo:
    'O beta fechado é a linha que divide o projeto em dois. Antes dele, tudo é caminho crítico: sem build publicável não há testador, e sem testador não há base de preço. Depois dele, nada é mais bloqueante — é crescimento, alcance e receita, na ordem em que cada um deixa de ser prematuro.',
  marco: {
    titulo: 'Beta fechado na Play — 12+ testadores por 14 dias corridos',
    porque:
      'Não é uma escolha de produto, é exigência da Google para conta pessoal nova. E cai bem: o beta é também a semeadura da base. Um app de comparação de preços com a base vazia não tem o que comparar — os 14 dias são o que transforma o app em produto.',
    fase: 3,
  },

  antes: [
    {
      id: 'p1',
      titulo: 'Destravar o build',
      porque:
        'Três linhas de configuração e uma conta. Nada aqui é engenharia — é o tipo de item que custa minutos e trava semanas se for descoberto tarde.',
      quem: 'você',
      bloqueadores: ['b4'],
      fases: [0],
      // Este passo da fase 0 É o bloqueador b5 (que mora na frente 2), escrito
      // curto. Mostrar os dois contaria o mesmo trabalho duas vezes e
      // estragaria o "em aberto" e a barra. O gerador confere que cada texto
      // aqui existe mesmo na fase — se o passo for reescrito lá, o
      // `painel:conferir` reprova em vez de silenciosamente voltar a duplicar.
      // A versão 1.0.0 saiu daqui quando o b2 foi resolvido, e a URL da API
      // quando o b1 foi: sem bloqueador para duplicar, o passo volta a
      // aparecer — agora como feito.
      pular: ['Validar a captura do RJ num aparelho físico, com cupons reais'],
      etapas: ['C10.1'],
    },
    {
      id: 'p2',
      titulo: 'Provar a captura no aparelho',
      porque:
        'O RJ é o estado semeado primeiro e o único atrás de reCAPTCHA. Se a captura falhar no beta, o testador não escaneia nada e os 14 dias queimam sem gerar base — o relógio da Google não pausa. É o pré-requisito nº 1 do gate, e o único que nenhum teste automatizado consegue dar.',
      quem: 'você',
      bloqueadores: ['b5'],
      etapas: ['C2.2', 'C2.6'],
    },
    {
      id: 'p3',
      titulo: 'Fechar a ficha da loja',
      porque:
        'Data Safety, classificação, política e exclusão de conta. As respostas já estão escritas em docs/14 e docs/16; o que falta é colar no console e publicar a ponte de autenticação — sem ela, o link de confirmação de e-mail não volta para o app.',
      quem: 'você',
      fases: [2],
      etapas: ['C10.0', 'C10.0.3', 'C10.0.4', 'C10.0.5'],
    },
    {
      id: 'p4',
      titulo: 'Backend pronto para receber gente',
      porque:
        'O essencial já está no ar. Sobra o recálculo completo pós-deploy (sem ele o frescor nasce vazio e o veredito fica mudo) e ligar a cifra das colunas privadas na mesma janela da migração.',
      quem: 'misto',
      bloqueadores: ['b6'],
      fases: [1],
      etapas: ['C9.2', 'C9.2.2', 'C10.2'],
    },
    {
      id: 'p5',
      titulo: 'Rodar os 14 dias',
      porque:
        'Recrutar 20 para garantir 12 ativos, concentrar em 1–2 municípios (duas cidades densas valem mais que dez ralas) e fazer o QA dirigido enquanto a base se povoa. É a fase mais longa e a menos técnica.',
      quem: 'você',
      fases: [3],
      // A conta de desenvolvedor é o bloqueador b4, já mostrado na frente 1.
      pular: ['Criar a conta de desenvolvedor (US$ 25) e o app "Barganha"'],
      etapas: [],
    },
  ],

  depois: [
    {
      id: 'd1',
      titulo: 'Estabilizar o que foi ao ar',
      quando: 'Imediatamente após o gate',
      porque:
        'O rollout faseado é a única rede que existe entre um bug e a base inteira de usuários. Só depois dele faz sentido tocar em qualquer coisa nova.',
      etapas: ['C10.3'],
      dividas: ['Rate limit em memória'],
    },
    {
      id: 'd2',
      titulo: 'Afinar o veredito com dado real',
      quando: 'Quando houver volume',
      porque:
        'Meia-vida, zona morta e limiares estão em valores escolhidos na mesa, não calibrados. Calibrar antes de ter distribuição real seria chutar com mais passos — por isso espera, de propósito.',
      etapas: ['C3.2', 'C3.6', 'C3.6.1', 'C8.4.1'],
      dividas: ['Constantes estatísticas não calibradas', 'Curadoria sem interface'],
    },
    {
      id: 'd3',
      titulo: 'Ampliar o alcance',
      quando: 'Depois de estável em uma praça',
      porque:
        'Mais estados e mais produtos reconhecidos. Vem depois porque cada praça nova divide a densidade de dados: espalhar cedo é ter dez cidades sem mediana em vez de duas com veredito.',
      etapas: ['C11.1', 'C11.5', 'C11.4', 'C11.2'],
      dividas: [],
    },
    {
      id: 'd4',
      titulo: 'Receita',
      quando: 'Só com base madura',
      porque:
        'Cobrar por um veredito que ainda não é confiável queima a confiança uma vez só. A oferta anunciada entra aqui e entra ROTULADA, numa camada separada — nunca na mediana (decisão travada nº 8).',
      etapas: ['C13.3', 'C13.4', 'C13.5', 'C12.3', 'C12.4'],
      dividas: ['Colunas privadas em claro'],
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────────
   7. VALIDAÇÃO NO REAL — o que só um aparelho de verdade prova.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Teste automatizado prova DECISÃO ("dado este preço, dispara?"). Não prova
 * ENTREGA: permissão do sistema, credencial de push, câmera, rede caindo,
 * portal da SEFAZ com captcha. Cada item aqui é uma coisa que passa no CI e
 * ainda assim pode estar quebrada no aparelho — com o passo a passo de como
 * provar que não está.
 */
export const validacaoReal = [
  {
    id: 'v1',
    titulo: 'O push de alerta chega com o app fechado',
    etapa: 'C8.4',
    porque:
      'Os 26 testes da corrente de alerta provam a decisão e o envio em memória — nenhum deles fala com o Expo Push, com o FCM ou com a bandeja do Android. Emulador não recebe push (o próprio código pula: `Device.isDevice`) e o Expo Go também não serve.',
    precisa: [
      '**Credencial FCM — hoje não existe no repo.** `expo-notifications` está instalado, mas não há `google-services.json` nem `android.googleServicesFile` no `app/app.json`. Sem isso `getExpoPushTokenAsync` falha no Android e nenhum token sobe. É o primeiro passo, não um detalhe.',
      'Dev build EAS num Android físico (perfil `development`, que já tem `developmentClient: true`).',
      '`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente de quem roda o job.',
    ],
    passos: [
      'Criar o projeto no Firebase, baixar o `google-services.json`, apontá-lo em `app/app.json` (`android.googleServicesFile`) e subir a chave FCM V1 com `cd app && eas credentials`.',
      'Buildar e instalar: `cd app && eas build --profile development --platform android`.',
      'No app, abrir um produto e criar um alerta de preço. A permissão de notificação só é pedida no PRIMEIRO alerta do aparelho — aceite quando aparecer.',
      'Conferir no Supabase que `dispositivo_push` ganhou uma linha sua e `alerta_preco` ganhou o alvo. Se `dispositivo_push` está vazio, pare aqui: o token não subiu.',
      'Forçar a condição: editar o alerta com um alvo ACIMA da mediana atual do produto na sua região, para ele disparar já na primeira rodada.',
      'FECHAR o app (matar pelo gerenciador de tarefas, não só minimizar) e rodar `cd backend && npm run job:alerta-preco` — ou disparar `alerta-preco.yml` pelo "Run workflow" no GitHub.',
    ],
    sucesso:
      'A notificação "Preço baixou" aparece na bandeja com o app fechado, e `alerta_preco.disparado_em` fica carimbado. Rodar o job DE NOVO não pode mandar um segundo aviso: o alvo já disparou e só rearma se o preço subir 5% acima dele.',
    falhou:
      '`dispositivo_push` vazio = o token nunca subiu (procure `push.obter_token` / `push.registrar_token` no log do app). Linha existe e nada chega = credencial FCM. Chega mas repete a cada rodada = `disparado_em` não está sendo persistido.',
    onde: ['backend/src/jobs/alerta-preco.ts', 'app/src/nucleo/notificacoes-push.ts'],
    prompt:
      'Quero validar o push de alerta de preço (item v1 do painel) num Android físico — a parte de escanear/tocar é manual, você não faz por mim. Me guia: primeiro conferir se a credencial FCM está configurada (google-services.json + android.googleServicesFile em app/app.json + eas credentials), depois subir o dev build, e por fim rodar `npm run job:alerta-preco` no backend enquanto eu acompanho a bandeja do aparelho. Vá conferindo comigo as linhas de `dispositivo_push` e `alerta_preco` no Supabase a cada passo. No fim, atualiza o item v1 em painel/mapa.mjs com o que deu e roda `npm run painel`.',
  },
  {
    id: 'v2',
    titulo: 'Tocar na notificação abre o produto certo — inclusive no arranque frio',
    etapa: 'C8.4',
    porque:
      'É o caminho mais frágil do push e o único que nenhum teste alcança: quando o toque LANÇA o app, o destino precisa sobreviver aos gates (consentimento → login → abertura) antes de existir navegação. O teste cobre a decisão e a dedupe; a ordem real dos gates, não.',
    precisa: ['O v1 funcionando (é o mesmo aparelho e o mesmo push).'],
    passos: [
      'FRIO: matar o app, disparar o job, tocar na notificação.',
      'SEGUNDO PLANO: abrir o app, minimizar, disparar o job, tocar na notificação.',
      'ABERTO: deixar o app aberto em outra aba, disparar o job, tocar no banner.',
      'Repetir o caso FRIO com um alerta de OUTRO produto, estando já na tela de um produto.',
    ],
    sucesso:
      'Nos três casos o app termina na tela do produto certo. No frio ele passa pela splash e chega lá sozinho. E o "voltar" sai do produto para onde você estava — se voltar para a MESMA tela de produto, a tela empilhou duas vezes e a dedupe do arranque frio não pegou.',
    falhou:
      'Abriu o app mas ficou na tela de sempre = o payload chegou sem `produtoCanonicoId` (confira o `data` que o job monta). Abriu empilhado = dedupe. Abriu numa tela vazia de produto = o id não está no catálogo local daquele aparelho.',
    onde: ['app/src/nucleo/notificacoes-push-regras.ts', 'app/src/navegacao/ref.ts', 'app/App.tsx'],
    prompt:
      'Quero validar o toque na notificação de alerta (item v2 do painel) — os três estados do app (fechado, segundo plano, aberto). Me guia nos passos e me ajuda a ler o log do app enquanto eu toco nas notificações no aparelho. Presta atenção especial no arranque frio e no "voltar" (tela empilhada). No fim, atualiza o item v2 em painel/mapa.mjs e roda `npm run painel`.',
  },
  {
    id: 'v3',
    titulo: 'A captura de cupom do RJ sobrevive ao reCAPTCHA',
    etapa: 'C2.6',
    porque:
      'O portal do RJ é protegido por captcha e a captura passa por WebView. A recusa já é tratada (vira 422 `erro_portal` + recarga automática), mas contra fixture — não contra o portal real, que oscila. É o mesmo ponto do bloqueador b5, e é pré-requisito do beta: se o RJ falhar, os testadores não escaneiam nada.',
    precisa: [
      'Dev build no aparelho e o backend alcançável pela LAN (`app/.env` com o IP da máquina, nunca `localhost`).',
      'Cupons fiscais de papel do RJ, de verdade.',
    ],
    passos: [
      'Subir o backend e deixar o log dele à vista.',
      'Escanear uns 10 cupons reais do RJ seguidos, sem intervalo.',
      'Observar no log quantos viram 422 `erro_portal` e se a recarga automática recupera sozinha.',
    ],
    sucesso:
      'Todo cupom termina processado, mesmo os que bateram no captcha na primeira tentativa — sem o usuário precisar fazer nada além de esperar.',
    falhou:
      'Se a recarga não recupera, a captura do RJ trava no beta inteiro. Uma nota que fica em "Enviando/Processando" para sempre normalmente é backend fora do ar, não captcha.',
    onde: ['app/src/componentes/ColetorNotaWeb.tsx', 'backend/src/parsers/rj.ts'],
    prompt:
      'Quero validar a captura do RJ num aparelho físico (item v3 do painel, mesmo assunto do bloqueador b5). Sobe o backend, me diz o IP certo pro app/.env, e acompanha o log comigo enquanto eu escaneio uns 10 cupons reais do RJ — conta quantos bateram no captcha e se a recarga automática recuperou sozinha. No fim, atualiza o item v3 e o bloqueador b5 em painel/mapa.mjs e roda `npm run painel`.',
  },
  {
    id: 'v4',
    titulo: 'A câmera não fica preta ao voltar para o scanner',
    etapa: 'C7.1',
    porque:
      'A prop `active` do `expo-camera` 16 é só de iOS. No Android a solução é DESMONTAR o `CameraView` fora de foco (`useCameraAtiva`) — e tela preta é exatamente o tipo de defeito que nenhum teste vê e todo usuário vê.',
    precisa: ['Android físico (o emulador tem câmera falsa e não reproduz).'],
    passos: [
      'Abrir o scanner, sair para outra aba e voltar. Cinco vezes.',
      'Abrir o scanner, minimizar o app, esperar uns segundos, voltar.',
      'Repetir no scanner de código de barras da gôndola, que é a outra tela com câmera.',
    ],
    sucesso: 'O preview sempre volta a aparecer. Nenhuma vez fica preto ou congelado.',
    falhou: 'Preto ao voltar = o `CameraView` continuou montado fora de foco.',
    onde: ['app/src/nucleo/camera.ts', 'app/src/telas/ScannerTela.tsx'],
    prompt:
      'Quero validar a câmera no Android (item v4 do painel): tela preta ao voltar para o scanner. Me lembra o roteiro e me ajuda a ler o log se acontecer. Se reproduzir, investiga `useCameraAtiva` em app/src/nucleo/camera.ts. No fim, atualiza o item v4 em painel/mapa.mjs e roda `npm run painel`.',
  },
  {
    id: 'v5',
    titulo: 'O app inteiro funciona no modo avião',
    etapa: 'C5.4',
    porque:
      'Offline é decisão travada, não recurso: registrar cupom e consultar preço têm que funcionar sem rede. Os testes cobrem a fila e o cache isolados; o que só o aparelho prova é a fila DRENANDO sozinha quando a rede volta, sem o usuário pedir.',
    precisa: ['Aparelho com uma conta já logada e alguns cupons já escaneados.'],
    passos: [
      'Ligar o modo avião.',
      'Escanear um cupom: ele tem que ser aceito e ficar na fila, sem erro na cara do usuário.',
      'Consultar um produto que você já tem no catálogo: o veredito tem que sair do cache.',
      'Desligar o modo avião e deixar o app aberto.',
    ],
    sucesso:
      'A fila drena sozinha em segundos, sem você tocar em nada, e o cupom aparece processado no histórico.',
    falhou:
      'Erro na cara do usuário durante o avião = alguma chamada não está passando pela fila. Fila que não drena ao voltar = o gatilho de `AppState`/rede.',
    onde: ['app/src/dados/repositorio-fila.ts', 'app/src/nucleo/sincronizador.ts'],
    prompt:
      'Quero validar o fluxo offline no aparelho (item v5 do painel): modo avião, escanear, consultar, religar a rede e ver a fila drenar sozinha. Me guia no roteiro e acompanha o log do app e do backend comigo. No fim, atualiza o item v5 em painel/mapa.mjs e roda `npm run painel`.',
  },
  {
    id: 'v6',
    titulo: 'O link do e-mail de confirmação volta para o app',
    etapa: 'C4.3.1',
    porque:
      'O link `barganha://` não abre o app quando clicado no e-mail do celular. A ponte é uma página HTTPS (`site/auth-callback.html`) que redireciona — e ela só funciona DEPOIS de publicada no GitHub Pages. Um cadastro que não confirma trava o testador logo no primeiro minuto.',
    precisa: [
      'A pasta `site/` publicada (`npm run publicar:site`).',
      'Um e-mail de verdade, aberto no próprio celular.',
    ],
    passos: [
      'Cadastrar uma conta nova pelo app, com um e-mail que você acessa no celular.',
      'Abrir o e-mail NO CELULAR e tocar no link de confirmação.',
      'Repetir com o fluxo de "esqueci a senha".',
    ],
    sucesso: 'O navegador abre a ponte e devolve para o app, já logado (ou na tela de nova senha).',
    falhou:
      'Se ficar preso no navegador, a página da ponte não está publicada ou o `scheme` não bate com o `barganha` do `app.json`.',
    onde: ['site/auth-callback.html', 'app/src/auth/contexto.tsx'],
    prompt:
      'Quero validar o link de e-mail de auth no celular (item v6 do painel). Primeiro confere se site/auth-callback.html está publicado no GitHub Pages (npm run publicar:site) e se o scheme bate com o app.json, depois me guia no teste de cadastro e de "esqueci a senha" com e-mail real. No fim, atualiza o item v6 em painel/mapa.mjs e roda `npm run painel`.',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   8. DÍVIDAS conscientes — correto hoje, problema amanhã.
   ──────────────────────────────────────────────────────────────────────────── */

export const dividas = [
  {
    titulo: 'Rate limit em memória',
    hoje: 'O teto vale por processo e protege o que precisa proteger.',
    quando:
      'Com duas instâncias o limite efetivo dobra. A interface já permite trocar o miolo sem tocar nas rotas.',
    onde: 'backend/src/http/rate-limit.ts',
  },
  {
    titulo: 'Colunas privadas em claro',
    hoje: 'A base está praticamente vazia e o CPF nunca entra em lugar nenhum.',
    quando:
      'Antes de haver usuário real com histórico real — é o gate pré-beta. Rotação de chave escrita ANTES de ligar a cifra.',
    onde: 'docs/19 §8',
  },
  {
    titulo: 'Curadoria sem interface',
    hoje: 'Uma pessoa só resolve por API com Bearer.',
    quando:
      'A partir do beta: corrigir casamento errado por curl não escala, e item sem EAN é a regra no RJ.',
    onde: 'backend/src/curadoria/',
  },
  {
    titulo: 'Constantes estatísticas não calibradas',
    hoje: 'Valores conservadores e documentados, com o raciocínio escrito.',
    quando:
      'Durante e depois do beta: meia-vida, zona morta por categoria, cerco de promoção, mínimos de n.',
    onde: 'docs/06 §A calibrar',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   9. SKILLS recomendadas
   ──────────────────────────────────────────────────────────────────────────── */

export const skills = [
  {
    grupo: 'Já instaladas — use mais',
    itens: [
      {
        nome: 'graphify',
        quando:
          'Antes de mexer em código que você não lembra. `graphify query "..."` devolve o subgrafo em vez de você caçar arquivo.',
        porque:
          'Já está integrada ao repositório e é o antídoto contra "resolver o que já foi resolvido".',
      },
      {
        nome: 'supabase',
        quando: 'Qualquer coisa de banco, auth, RLS, migração ou Edge Function.',
        porque: 'O projeto é Supabase de ponta a ponta e o drift de RLS já mordeu antes.',
      },
      {
        nome: 'supabase-postgres-best-practices',
        quando: 'Ao escrever consulta nova ou índice — sobretudo nas consultas geográficas.',
        porque:
          'A estatística por município é o caminho quente e o que vai doer primeiro com volume.',
      },
      {
        nome: 'simplify',
        quando: 'Depois de fechar uma feature, antes do commit.',
        porque:
          'Revisa reuso e simplificação do diff — é o refatoramento que você pediu, sem virar reescrita.',
      },
      {
        nome: 'security-review',
        quando: 'Antes de cada release, e obrigatoriamente antes do beta.',
        porque:
          'Revisa as mudanças pendentes com olho de segurança. Com LGPD travada em decisão, isso é gate, não luxo.',
      },
      {
        nome: 'dataviz',
        quando:
          'Qualquer gráfico: evolução de 6 meses, painel de descontos, telemetria de parsing.',
        porque: 'Você tem três lugares com gráfico e nenhum sistema visual comum entre eles.',
      },
      {
        nome: 'artifact-design',
        quando: 'Toda vez que a saída for uma página para você olhar, como este painel.',
        porque: 'Evita que cada entrega visual tenha uma cara diferente.',
      },
    ],
  },
  {
    grupo: 'Vale criar — específicas do Barganha',
    itens: [
      {
        nome: '/publicar',
        quando: 'A cada release.',
        porque:
          'Encadear: check completo → conferir os bloqueadores → build EAS → subir faixa → registrar a versão. Hoje é memória e docs/13 aberto ao lado.',
      },
      {
        nome: '/estado-do-projeto',
        quando: 'Ao voltar depois de dias longe.',
        porque:
          'Regenerar o painel e ler o diff dele em voz alta: o que mudou de status desde a última vez. Ataca exatamente o "me perdi em 10 dias".',
      },
      {
        nome: '/novo-estado',
        quando: 'Ao adicionar uma UF.',
        porque:
          'Parser + fixtures + teste + registro + reprocessamento retroativo é sempre a mesma receita de cinco passos.',
      },
      {
        nome: '/gate-lgpd',
        quando: 'Em toda mudança que toca dado.',
        porque: 'A decisão travada nº 3 merece um checklist executável, não uma leitura de doc.',
      },
      {
        nome: '/loja',
        quando: 'Ficha da Play, screenshots, textos, changelog de versão.',
        porque:
          'Marketing de app store é trabalho repetitivo com formato fixo — os textos já estão prontos em docs/16.',
      },
    ],
  },
  {
    grupo: 'Agentes do time — quem chamar',
    itens: [
      {
        nome: 'devops-engineer',
        quando: 'Bloqueadores 1 a 4. É o agente do caminho crítico agora.',
        porque: 'Build, EAS, Play, Render, crons e segredos.',
      },
      {
        nome: 'data-scientist',
        quando: 'Durante e depois do beta, para calibrar as constantes.',
        porque: 'Meia-vida, zona morta por categoria, cerco de promoção, casamento por texto.',
      },
      {
        nome: 'privacy-lgpd-specialist',
        quando: 'Gate obrigatório em toda PR que toca dado, e na cifra das colunas privadas.',
        porque: 'É o único que pode barrar uma feature por vazamento.',
      },
      {
        nome: 'product-manager',
        quando: 'Antes de construir a economia real ou as ofertas.',
        porque:
          'Os dois têm gatilho de "não construir antes da hora" — e a hora é medida, não sentida.',
      },
      {
        nome: 'qa-engineer',
        quando: 'Montando o QA dirigido dos 14 dias.',
        porque: 'Os seis cenários do beta merecem roteiro, não improviso.',
      },
    ],
  },
];
