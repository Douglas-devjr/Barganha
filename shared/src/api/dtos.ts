/**
 * DTOs da API (contratos app ↔ backend). As semânticas exatas de cada endpoint
 * são refinadas nas camadas donas (ingestão em C2, consulta/sync em C4); aqui
 * fica a forma estável que ambos os lados consomem.
 */

import type { UnidadeBase } from '../core';
import type { PrecoEstatistica, TipicoNaCompra } from '../dominio/entidades';
import type { EscopoGeo, MotivoDenuncia, StatusCupom, StatusModeracao } from '../dominio/enums';

// ─────────────────────────── Ingestão (C2.1) ───────────────────────────

/** App envia só o QR cru; o parsing roda no backend (nunca no app). */
export interface IngestaoQrRequest {
  qrPayload: string;
  /** Quando o app capturou o QR (ISO 8601) — offline-first. */
  capturadoEm: string;
}

export interface IngestaoQrResponse {
  cupomId: string;
  status: StatusCupom;
  /**
   * Chave de acesso extraída do QR pelo backend (o app não parseia QR). O app a
   * grava no espelho local — é o que ativa a idempotência local por chave
   * (índice único em `cupom_local`, docs/05).
   */
  chaveAcesso?: string;
}

/**
 * Ingestão por HTML (C2.6). Quando o portal da SEFAZ exige navegador/reCAPTCHA
 * (ex.: RJ), o app abre a nota num WebView no aparelho do usuário e envia o HTML
 * já renderizado. O parsing continua no backend (decisão travada nº2): o app só
 * entrega o HTML do cupom que ele já registrou por QR. A resposta é o próprio
 * `CupomResponse` atualizado (idealmente já `processado`, com os itens).
 */
export interface IngestaoHtmlRequest {
  html: string;
}

/**
 * Item de uma nota já processada, devolvido ao DONO do cupom (lado privado).
 * Espelha `ItemCupom` sem os ids internos — o app guarda no espelho local.
 */
export interface ItemNotaResponse {
  produtoCanonicoId?: string;
  descricaoOriginal: string;
  ean?: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto?: number;
  /**
   * Típico da região congelado no processamento (ver `TipicoNaCompra`). Desce ao
   * espelho local para a comparação pagou × típico ser 100% offline depois — o
   * app não recalcula nem re-consulta o pool para números do passado.
   */
  tipicoNaCompra?: TipicoNaCompra;
}

/**
 * Estado de um cupom do próprio usuário (C6.3). A ingestão é assíncrona (202 +
 * fila), então o app consulta este recurso PRIVADO (Bearer, escopo do dono) para
 * acompanhar o parsing e exibir os itens quando `status = 'processado'`.
 *
 * É lado PRIVADO de ponta a ponta: só o dono lê, nunca toca o pool anônimo
 * (docs/04). `loja` é a referência mínima para o cabeçalho da nota.
 */
export interface CupomResponse {
  cupomId: string;
  status: StatusCupom;
  emitidoEm?: string;
  uf?: string;
  loja?: {
    cnpj: string;
    razaoSocial?: string;
    nomeFantasia?: string;
    municipio?: string;
    uf?: string;
  };
  itens: ItemNotaResponse[];
  /** Desconto total do cupom (R$), quando o portal informa (docs/06). */
  descontoTotal?: number;
  /** Valor efetivamente pago (R$) = soma dos itens − desconto total. */
  valorPago?: number;
}

// ──────── Rehidratação do histórico privado no login (restore, docs/04) ────────

/**
 * Página do histórico do PRÓPRIO usuário para a rehidratação servidor→local. Ao
 * SAIR, o app limpa o espelho local do aparelho (higiene de dispositivo
 * compartilhado), mas o histórico continua guardado na CONTA, no servidor. Ao
 * ENTRAR de novo — aqui ou num aparelho novo/reinstalação — este endpoint
 * PRIVADO (Bearer, escopo do dono) traz os cupons de volta para o app
 * reconstruir o histórico. Nunca toca o pool anônimo (decisão travada nº3).
 *
 * `cursor` é OPACO (keyset por captura); ausente = primeira página. `limite` é o
 * teto de cupons por página — o serviço aplica um máximo.
 */
export interface HistoricoCuponsRequest {
  cursor?: string;
  limite?: number;
}

/**
 * Um cupom do histórico do próprio usuário. Espelha o `CupomResponse` (cabeçalho
 * + itens) e acrescenta o que o espelho local precisa para ser FIEL: `qrPayload`
 * (invariante NOT NULL local + base do reprocessamento retroativo, decisão
 * travada nº2), `chaveAcesso` (idempotência local, docs/05) e `capturadoEm`
 * (data do histórico — base da sequência de semanas e dos selos). Tudo isto é
 * dado do DONO, trafega só no canal autenticado dele e nunca cruza para o pool.
 */
export interface HistoricoCupom {
  cupomId: string;
  status: StatusCupom;
  qrPayload: string;
  chaveAcesso?: string;
  capturadoEm: string;
  emitidoEm?: string;
  uf?: string;
  loja?: {
    cnpj: string;
    razaoSocial?: string;
    nomeFantasia?: string;
    municipio?: string;
    uf?: string;
  };
  itens: ItemNotaResponse[];
  descontoTotal?: number;
  valorPago?: number;
}

export interface HistoricoCuponsResponse {
  cupons: HistoricoCupom[];
  /** Cursor da próxima página (opaco). Ausente = fim do histórico. */
  proximoCursor?: string;
}

// ───────────────────────────── Conta (C4.3) ─────────────────────────────

/**
 * Conta anônima. Sem nome/CPF (minimização LGPD, docs/04). O `usuarioId` é a
 * credencial que o app guarda e envia como `Authorization: Bearer <id>` nos
 * endpoints privados (ingestão). Consulta e delta sync são anônimos (lêem só o
 * pool compartilhado) e NÃO exigem conta.
 */
export interface ContaAnonimaResponse {
  usuarioId: string;
}

// ───────────────────────── Consulta veredito (C4.1) ─────────────────────

/** Entrada na gôndola: EAN (principal) ou nome (fallback) + recorte geo. */
export interface ConsultaPrecoRequest {
  ean?: string;
  nome?: string;
  municipio?: string;
  uf?: string;
}

/**
 * Resumo de exibição do produto (enriquecimento de curadoria, C11.5). Campos
 * humanos para a UI da gôndola; ausentes quando o produto ainda não foi
 * enriquecido (cai-se na `descricaoNormalizada` técnica).
 */
export interface ProdutoResumo {
  produtoCanonicoId: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
  unidadeBase: UnidadeBase;
}

/** Estatística resolvida + o nível de escopo de fato usado no fallback. */
export interface ConsultaPrecoResponse {
  produtoCanonicoId: string;
  /** Escopo efetivamente atendido (loja→município→região→UF). */
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
  /** Dados de exibição do produto, quando enriquecido (C11.5). */
  produto?: ProdutoResumo;
}

// ───────────────── Lista de compras comparada por loja (C12.1) ──────────────

/**
 * Compara uma cesta entre as lojas da região: "onde minha lista sai mais
 * barata". Anônima como a consulta de preço — lê só `preco_estatistica` no
 * escopo `loja`. A `quantidade` é um multiplicador da unidade-base do produto
 * (padrão 1); a comparação é RELATIVA entre lojas, não um orçamento exato.
 */
export interface ComparacaoListaRequest {
  itens: Array<{ produtoCanonicoId: string; quantidade?: number }>;
  /** Recorte geográfico das lojas candidatas (mesma semântica da consulta). */
  municipio?: string;
  uf?: string;
}

/** Preço de UM item da lista numa loja (mediana × quantidade). */
export interface ItemComparacaoLoja {
  produtoCanonicoId: string;
  /** Ausente = a loja não tem estatística para este item (fora da cobertura). */
  preco?: number;
  /** Menor preço promocional visto (informativo — não entra no total). */
  menorPromocional?: number;
}

export interface LojaComparacao {
  lojaCnpj: string;
  nome?: string;
  municipio?: string;
  /** Soma das medianas × quantidade dos itens COBERTOS. */
  total: number;
  /** Quantos itens da lista têm preço nesta loja (cobertura). */
  itensCobertos: number;
  itens: ItemComparacaoLoja[];
  /**
   * Total de observações que sustentam este total (soma dos itens cobertos). É a
   * evidência por trás do número: sem ela a tela mostra um total confiante sem
   * dizer se ele veio de 6 cupons ou de 600.
   */
  nObservacoes: number;
  /**
   * Data (ISO) do preço mais VELHO da conta — entre os itens cobertos, a mais
   * antiga das "observações mais recentes". É o elo fraco: de nada adianta o
   * arroz ter preço de ontem se o café que entrou no mesmo total é de abril.
   *
   * Ausente quando algum item coberto não tem data conhecida (linha anterior à
   * coluna `observado_em_max`) — leia como idade desconhecida, não como recente.
   */
  observadoEmMaisAntigo?: string;
  /**
   * Quantos itens cobertos têm promoção vista nesta loja. A promoção NÃO entra
   * no total (decisão travada nº6) — este número existe para a tela poder dizer
   * que há desconto fora da conta, em vez de deixar a loja parecer cara à toa.
   */
  itensComPromocao: number;
}

/** Lojas ordenadas por cobertura (desc) e total (asc). */
export interface ComparacaoListaResponse {
  itensTotal: number;
  lojas: LojaComparacao[];
}

// ─────────────── Busca de produtos no pool — catálogo regional (C4.4) ────────

/**
 * Busca no catálogo COMPARTILHADO, no recorte geográfico do usuário. Existe para
 * resolver o cold start (docs/20): quem ainda não escaneou cupom nenhum não tem
 * catálogo local, e sem isto não consegue montar lista nem comparar mercados.
 *
 * Anônima como as demais consultas — não recebe conta e não toca o mundo privado.
 * Sem `termo`, devolve os **populares da região** (mais observados); com `termo`,
 * ranqueia por similaridade de texto. Ordenação NUNCA é influenciada por
 * patrocínio (decisão travada nº8).
 */
export interface BuscaProdutosRequest {
  /** Texto digitado. Ausente/vazio = populares da região. */
  termo?: string;
  municipio?: string;
  uf?: string;
  /** Quantos produtos devolver. O servidor tem teto próprio. */
  limite?: number;
}

/** Um produto do catálogo regional, já com a faixa típica do recorte resolvido. */
export interface ProdutoEncontrado {
  produto: ProdutoResumo;
  /** Nível de fato usado (município → região → UF). A UI rotula com isto. */
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
}

export interface BuscaProdutosResponse {
  /** Vazia = a região ainda não tem preço para nada que case com o termo. */
  produtos: ProdutoEncontrado[];
}

// ─────────────────── Enriquecimento de produto — curadoria (C11.5) ───────────

/**
 * Aplica enriquecimento humano a um produto canônico (nome/marca/categoria/foto).
 * Alvo por `produtoCanonicoId` OU `ean`. Não altera `descricaoNormalizada` nem o
 * casamento — só o que a UI mostra. Endpoint privilegiado (curadoria).
 */
export interface EnriquecimentoProdutoRequest {
  produtoCanonicoId?: string;
  ean?: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
}

export interface EnriquecimentoProdutoResponse {
  produtoCanonicoId: string;
}

// ──────────────── Casamento por texto — sugestões (C3.5, curadoria) ──────────

/**
 * Pede sugestões de casamento por SIMILARIDADE para uma descrição sem EAN.
 * Regra travada (docs/06): similaridade nunca casa sozinha — a resposta é só
 * sugestão ordenada por confiança; confirmar (gravar `produto_alias`) é um passo
 * humano de curadoria. Endpoint privilegiado (token de curadoria).
 */
export interface CasamentoSugestoesRequest {
  descricao: string;
  /** Unidade-base dos candidatos (kg | L | un) — reduz falso positivo. */
  unidadeBase: UnidadeBase;
}

export interface CasamentoSugestaoDto {
  produtoCanonicoId: string;
  /** Score de similaridade 0..1 (vira `produto_alias.confianca` ao confirmar). */
  confianca: number;
}

export interface CasamentoSugestoesResponse {
  /** Vazia = nada plausível (provável produto novo). */
  sugestoes: CasamentoSugestaoDto[];
}

// ──────────────────── Lançamento manual de gôndola (C11.3) ───────────────────

/**
 * Lançamento MANUAL de preço (sem cupom): o usuário viu o preço na prateleira e
 * o informa. Exige conta (Bearer) — o `usuarioId` fica só no registro PRIVADO de
 * moderação (controle de abuso), NUNCA no pool. A geo é pela LOJA (CNPJ), nunca
 * pelo usuário (docs/04). v1 exige `ean` (o produto da prateleira escaneado).
 */
export interface LancamentoManualRequest {
  ean: string;
  descricao: string;
  /** Unidade de venda na prateleira (UN, KG, L…). Normalizada como num cupom. */
  unidade: string;
  /** Preço unitário visto na prateleira (R$). */
  valorUnitario: number;
  /** Loja onde o preço foi visto — chave da geo. */
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  /** Marca se o preço é promocional (entra como `emPromocao`, à parte do típico). */
  emPromocao?: boolean;
}

export interface LancamentoManualResponse {
  lancamentoId: string;
  status: StatusModeracao;
}

/** Item da fila de moderação, visto pela curadoria (C11.3). */
export interface LancamentoModeracaoResponse {
  id: string;
  ean: string;
  descricao: string;
  unidade: string;
  valorUnitario: number;
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  emPromocao: boolean;
  status: StatusModeracao;
  criadoEm: string;
}

/** Decisão da curadoria sobre um lançamento (aprovar publica no pool via gate). */
export interface DecisaoModeracaoRequest {
  decisao: 'aprovar' | 'rejeitar';
  /** Motivo (obrigatório ao rejeitar; ajuda auditoria). */
  motivo?: string;
}

export interface DecisaoModeracaoResponse {
  id: string;
  status: StatusModeracao;
}

// ───────────────────────────── Delta sync (C4.2) ───────────────────────

/** Baixa só o que mudou desde o cursor, no escopo da região/produtos. */
export interface DeltaSyncRequest {
  /**
   * Cursor OPACO devolvido pela chamada anterior; ausente = sync inicial. Não
   * interprete o conteúdo: por dentro é a posição keyset da última linha
   * entregue (`atualizado_em` + desempate), e o formato pode mudar.
   */
  cursor?: string;
  /**
   * Chaves de `escopo_id` do recorte geográfico do usuário. Apesar do nome,
   * aceita os DOIS níveis úteis ao fallback offline: `UF:MUNICIPIO` (chave
   * canônica de `chaveMunicipio`, normalizada) E o código de `UF`. Inclua ambos
   * (ex.: `["RJ:RIO DE JANEIRO", "RJ"]`) para o cache ter a linha de UF quando o
   * município tiver poucos dados.
   */
  municipios?: string[];
  /** Produtos do histórico para manter no cache. */
  produtoCanonicoIds?: string[];
}

export interface DeltaSyncResponse {
  estatisticas: PrecoEstatistica[];
  /** Novo cursor (opaco) para a próxima sincronização. */
  cursor: string;
  /**
   * A página encheu o teto do servidor: ainda há delta. O cliente deve chamar
   * de novo com o `cursor` recebido, em vez de esperar a próxima rodada — sem
   * isto, uma janela grande demorava ciclos para entrar no cache, calada.
   */
  temMais?: boolean;
}

// ─────────────────── Delta de catálogo — offline (C4.5) ────────────────

/**
 * Desce os dados de EXIBIÇÃO (nome/marca/categoria) dos produtos que o app já
 * tem em cache. Sem isto, o cache offline guarda estatística de ids que ele não
 * sabe nomear: o típico existe, mas a tela mostraria um UUID.
 *
 * Anônimo como o resto do sync — lê só o lado compartilhado (`produto_canonico`),
 * e o cliente só pergunta por ids que o próprio delta de estatística já lhe
 * entregou. Não é paginado por cursor: o cliente é quem sabe quais ids lhe
 * faltam, e pede em lotes.
 */
export interface SyncProdutosRequest {
  produtoCanonicoIds: string[];
}

export interface SyncProdutosResponse {
  /**
   * Um resumo por id ENCONTRADO. Id inexistente (ou já removido do catálogo)
   * simplesmente não volta — a ausência não é erro, e o cliente trata como
   * "ainda sem nome", nunca como falha de sincronização.
   */
  produtos: ProdutoResumo[];
}

// ───────────────────── Denúncia de preço (C12.5) ───────────────────────

/**
 * Denúncia de preço incorreto. O alvo é o PRODUTO + o recorte geográfico — o
 * que a tela mostra —, nunca uma `observacao_preco`: assim não há ponteiro de
 * usuário para linha do pool anônimo (decisão travada #3, docs/04). O autor vai
 * no header de auth e fica só no registro privado, para anti-abuso.
 */
export interface DenunciaPrecoRequest {
  produtoCanonicoId: string;
  motivo: MotivoDenuncia;
  /** Recorte geográfico em que o preço foi visto (o mesmo da consulta). */
  municipio?: string;
  uf?: string;
  /** Texto livre opcional (motivo "outro"). A UI não pede dado pessoal. */
  comentario?: string;
}

export interface DenunciaPrecoResponse {
  id: string;
  status: StatusModeracao;
  /** `true` quando já havia uma denúncia aberta desta pessoa para o produto. */
  jaRegistrada: boolean;
}

/** Denúncia vista pela CURADORIA — sem `usuarioId` (anti-abuso fica no banco). */
export interface DenunciaCuradoria {
  id: string;
  produtoCanonicoId: string;
  motivo: MotivoDenuncia;
  municipio?: string;
  uf?: string;
  comentario?: string;
  status: StatusModeracao;
  criadoEm: string;
  /** Quantas denúncias abertas o mesmo produto acumula (prioriza a fila). */
  abertasNoProduto: number;
}
