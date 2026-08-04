/**
 * Purga de contas INATIVAS (retenção por inatividade, docs/04).
 *
 * A política publicada promete: uma conta sem login por muito tempo (TTL, padrão
 * 24 meses) pode ser apagada — com AVISO por email antes. Este job implementa
 * exatamente isso, em duas fases:
 *
 *   1. AVISO — a conta cruzou o limiar (TTL − antecedência): mandamos o aviso e
 *      carimbamos `aviso_inatividade_em` no metadata (o "relógio da purga").
 *   2. PURGA — a conta passou do TTL, foi avisada e a CARÊNCIA desde o aviso já
 *      correu: apagamos a conta (cascata para todo o histórico privado, docs/04).
 *      O pool anônimo não é tocado — não há dado pessoal a remover lá.
 *
 * A partir da revisão de LGPD que endureceu este job, o aviso é em DUAS ETAPAS:
 * um primeiro aviso (na janela de antecedência) e um SEGUNDO aviso, mais perto
 * da purga (`reenvioDiasAntes`, padrão 7 dias antes da data prevista). A purga
 * só acontece com os DOIS aceitos pelo provedor — porque a API aceitar o envio
 * (`resposta.ok` da Resend) é só o aceite, não a entrega: a população deste job
 * é justamente quem está inativo há 24 meses, a de MAIOR taxa de e-mail morto.
 * Um hard bounce não invalidado por nada faria o relógio andar sem que ninguém
 * tivesse sido avisado de verdade — o segundo aviso é a rede de segurança disso.
 *
 * Três travas de segurança que fazem este job ser inofensivo por padrão:
 *   • **Sem aviso, sem purga.** Se `avisar`/`reenviar` não conseguirem notificar
 *     de fato (não há provedor de email configurado ⇒ devolve `false`), o
 *     relógio correspondente NÃO avança e a conta NUNCA é purgada. Ligar a purga
 *     de verdade depende de existir canal de email — antes disso o job só
 *     avisaria ninguém e nada apaga.
 *   • **Os DOIS avisos precisam estar carimbados.** Carência (`antecedenciaDias`)
 *     cumprida com só o primeiro aviso não basta — falta o segundo, mais perto
 *     da purga (ver acima). Sem os dois, a conta fica "aguardando", nunca purga.
 *   • **Aviso vale só se for mais novo que a última atividade.** Se a pessoa voltar
 *     a logar depois de avisada, `ultimaAtividadeEm > avisadoEm` (ou `reenviadoEm`)
 *     invalida o aviso correspondente e a purga é cancelada — sem precisar
 *     limpar o metadata.
 *
 * Modo RELATÓRIO (padrão) × APLICAR: por padrão o job só CONTA quem seria avisado
 * e purgado, sem efeito colateral. Só com `aplicar: true` ele manda avisos e
 * apaga. É o mesmo espírito "não derrube dado por engano" do resto do backend.
 *
 * Execução (workspace @barganha/backend):
 *   npm run job:purga-inativos            # relatório (dry-run), não apaga nada
 *   PURGA_APLICAR=true npm run job:purga-inativos   # aplica de fato
 */

import { fileURLToPath } from 'node:url';

import { GerenciadorContaSupabase } from '../auth/gerenciador-conta';
import { type ConfigBackend, lerConfig } from '../config/env';
import { enviarEmail } from '../observabilidade/email-transacional';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErroInesperado } from '../observabilidade/sanitizar';
import { criarClienteSupabase } from '../persistencia/supabase';

const DIA_MS = 24 * 60 * 60 * 1000;
/** ~24 meses. Em DIAS para a conta ser dias corridos, não meses de calendário. */
const TTL_DIAS_PADRAO = 730;
/** Quanto antes do TTL avisamos — e a carência entre o primeiro aviso e a purga. */
const ANTECEDENCIA_DIAS_PADRAO = 30;
/**
 * Quanto antes da purga PREVISTA mandamos o SEGUNDO aviso (ver cabeçalho: a
 * API aceitar o envio não é garantia de entrega). Precisa ser < antecedenciaDias.
 */
const REENVIO_DIAS_ANTES_PADRAO = 7;

/**
 * Visão mínima de uma conta para o job — sem dado sensível além do email (usado
 * só para avisar). `ultimaAtividadeEm` = último login, ou a criação quando a
 * conta nunca logou (cadastro abandonado).
 */
export interface ContaInativa {
  id: string;
  email?: string;
  ultimaAtividadeEm: string;
  /** `aviso_inatividade_em` do metadata — primeiro aviso, se já avisamos. */
  avisadoEm?: string;
  /** `aviso_inatividade_reenvio_em` do metadata — segundo aviso, se já saiu. */
  reenviadoEm?: string;
}

/**
 * Efeitos colaterais do job, injetados para o núcleo ser testável e o wiring
 * real ficar isolado (Supabase). Nenhum é chamado em modo relatório.
 */
export interface AcoesPurga {
  /**
   * Manda o PRIMEIRO aviso por email de que a conta será apagada a partir de
   * `purgaPrevistaEm`. Devolve `true` SÓ se o aviso saiu de fato — `false`
   * (sem canal de email) impede a purga (ver cabeçalho: sem aviso, sem purga).
   */
  avisar(conta: ContaInativa, purgaPrevistaEm: string): Promise<boolean>;
  /** Carimba `aviso_inatividade_em` no metadata (o relógio da purga). */
  registrarAviso(id: string, avisadoEm: string): Promise<void>;
  /**
   * Manda o SEGUNDO aviso, mais perto da purga — mesma semântica de `avisar`:
   * só `true` se o provedor aceitou o envio.
   */
  reenviar(conta: ContaInativa, purgaPrevistaEm: string): Promise<boolean>;
  /** Carimba `aviso_inatividade_reenvio_em` no metadata. */
  registrarReenvio(id: string, reenviadoEm: string): Promise<void>;
  /** Apaga a conta e, em cascata, todo o histórico privado (docs/04). */
  apagar(id: string): Promise<void>;
}

export interface OpcoesPurga {
  /** TTL de inatividade em dias (padrão 730 ≈ 24 meses). */
  ttlDias?: number;
  /** Antecedência do primeiro aviso e carência antes da purga, em dias (padrão 30). */
  antecedenciaDias?: number;
  /** Quanto antes da purga prevista sai o SEGUNDO aviso, em dias (padrão 7). */
  reenvioDiasAntes?: number;
  /** `false` (padrão) = relatório: conta o que faria, sem avisar nem apagar. */
  aplicar?: boolean;
  /** Injeta o "agora" para o teste (padrão: relógio real). */
  agora?: Date;
}

export interface ResumoPurga {
  contasExaminadas: number;
  /** Avisadas (primeiro aviso) nesta rodada (aviso enviado + carimbado). */
  avisadas: number;
  /** Elegíveis ao primeiro aviso, mas ele não saiu (sem canal) — não avançaram. */
  semCanalDeAviso: number;
  /** Reenviadas (segundo aviso) nesta rodada (aviso enviado + carimbado). */
  reenviadas: number;
  /** Elegíveis ao segundo aviso, mas ele não saiu (sem canal) — não avançaram. */
  semCanalDeReenvio: number;
  /** Purgadas nesta rodada (TTL + os DOIS avisos + carência cumpridos). */
  purgadas: number;
  /** Passaram do TTL e têm o primeiro aviso válido, mas ainda dentro da carência. */
  aguardandoCarencia: number;
  /** `false` = foi só relatório (nada foi avisado nem apagado). */
  aplicado: boolean;
}

/** Um aviso só conta se for MAIS NOVO que a última atividade (ver cabeçalho). */
function avisoValido(conta: ContaInativa): boolean {
  return conta.avisadoEm != null && conta.avisadoEm > conta.ultimaAtividadeEm;
}

/** Mesmo critério de validade do primeiro aviso, aplicado ao segundo. */
function reenvioValido(conta: ContaInativa): boolean {
  return conta.reenviadoEm != null && conta.reenviadoEm > conta.ultimaAtividadeEm;
}

/**
 * Núcleo testável: decide, para cada conta, entre nada / avisar / aguardar /
 * purgar, aplicando os efeitos só quando `aplicar` é `true`. Aceita iterável
 * SÍNCRONO (testes) ou ASSÍNCRONO (paginação real do Supabase).
 */
export async function purgarContasInativas(
  contas: Iterable<ContaInativa> | AsyncIterable<ContaInativa>,
  acoes: AcoesPurga,
  opcoes: OpcoesPurga = {},
): Promise<ResumoPurga> {
  const ttlDias = opcoes.ttlDias ?? TTL_DIAS_PADRAO;
  const antecedenciaDias = opcoes.antecedenciaDias ?? ANTECEDENCIA_DIAS_PADRAO;
  const reenvioDiasAntes = opcoes.reenvioDiasAntes ?? REENVIO_DIAS_ANTES_PADRAO;
  const aplicar = opcoes.aplicar ?? false;
  const agora = opcoes.agora ?? new Date();

  const resumo: ResumoPurga = {
    contasExaminadas: 0,
    avisadas: 0,
    semCanalDeAviso: 0,
    reenviadas: 0,
    semCanalDeReenvio: 0,
    purgadas: 0,
    aguardandoCarencia: 0,
    aplicado: aplicar,
  };

  for await (const conta of contas) {
    resumo.contasExaminadas++;
    const diasInativa = (agora.getTime() - new Date(conta.ultimaAtividadeEm).getTime()) / DIA_MS;

    if (!avisoValido(conta)) {
      // Sem primeiro aviso válido (nunca avisado, ou aviso invalidado por novo
      // login): se já entramos na janela de antecedência do TTL (ou já passamos
      // dele), avisa agora; o resto do fluxo (reenvio, purga) vem em rodadas
      // futuras.
      if (diasInativa >= ttlDias - antecedenciaDias) {
        await tentarAvisar(conta, acoes, opcoes, agora, resumo, aplicar);
      }
      continue;
    }

    // Primeiro aviso válido: o relógio da purga está rodando desde `avisadoEm`.
    const diasDesdeAviso = (agora.getTime() - new Date(conta.avisadoEm!).getTime()) / DIA_MS;
    const carenciaCumprida = diasDesdeAviso >= antecedenciaDias;
    const passouTTL = diasInativa >= ttlDias;

    if (passouTTL && carenciaCumprida) {
      // TTL vencido e carência do primeiro aviso cumprida: falta só o SEGUNDO
      // aviso válido para purgar (ver cabeçalho: os dois avisos precisam estar
      // carimbados).
      if (reenvioValido(conta)) {
        if (aplicar) await acoes.apagar(conta.id);
        resumo.purgadas++;
      } else {
        await tentarReenviar(conta, acoes, opcoes, agora, resumo, aplicar);
      }
      continue;
    }

    // Ainda não é hora de purgar (falta TTL e/ou carência). Se já estamos na
    // janela final antes da purga prevista (`reenvioDiasAntes`) e o segundo
    // aviso ainda não é válido, manda-o agora — não espera a carência acabar.
    const janelaFinalDeReenvio = diasDesdeAviso >= antecedenciaDias - reenvioDiasAntes;
    if (janelaFinalDeReenvio && !reenvioValido(conta)) {
      await tentarReenviar(conta, acoes, opcoes, agora, resumo, aplicar);
    } else if (passouTTL) {
      resumo.aguardandoCarencia++;
    }
    // else: ainda abaixo do TTL, primeiro aviso válido, fora da janela do
    // segundo aviso — nada a fazer nesta rodada.
  }

  return resumo;
}

/**
 * Manda o PRIMEIRO aviso e carimba o relógio — só em `aplicar`. Se o aviso não
 * sair (sem canal de email), NÃO carimba: sem aviso não pode haver purga.
 */
async function tentarAvisar(
  conta: ContaInativa,
  acoes: AcoesPurga,
  opcoes: OpcoesPurga,
  agora: Date,
  resumo: ResumoPurga,
  aplicar: boolean,
): Promise<void> {
  if (!aplicar) {
    // Relatório: contamos como "seria avisada" sem prometer entrega.
    resumo.avisadas++;
    return;
  }
  // Data prevista da purga: o fim da carência a partir de agora (informa a pessoa).
  const antecedenciaDias = opcoes.antecedenciaDias ?? ANTECEDENCIA_DIAS_PADRAO;
  const purgaPrevistaEm = new Date(agora.getTime() + antecedenciaDias * DIA_MS).toISOString();

  const enviado = await acoes.avisar(conta, purgaPrevistaEm);
  if (!enviado) {
    resumo.semCanalDeAviso++;
    return;
  }
  await acoes.registrarAviso(conta.id, agora.toISOString());
  resumo.avisadas++;
}

/**
 * Manda o SEGUNDO aviso e carimba o relógio correspondente — só em `aplicar`.
 * Mesma trava do primeiro: sem canal, não carimba, e a purga fica bloqueada.
 */
async function tentarReenviar(
  conta: ContaInativa,
  acoes: AcoesPurga,
  opcoes: OpcoesPurga,
  agora: Date,
  resumo: ResumoPurga,
  aplicar: boolean,
): Promise<void> {
  if (!aplicar) {
    resumo.reenviadas++;
    return;
  }
  // A purga prevista conta a partir do PRIMEIRO aviso (é o relógio real da
  // purga) — não a partir de agora, que é só o momento do segundo aviso.
  const antecedenciaDias = opcoes.antecedenciaDias ?? ANTECEDENCIA_DIAS_PADRAO;
  const purgaPrevistaEm = new Date(
    new Date(conta.avisadoEm!).getTime() + antecedenciaDias * DIA_MS,
  ).toISOString();

  const enviado = await acoes.reenviar(conta, purgaPrevistaEm);
  if (!enviado) {
    resumo.semCanalDeReenvio++;
    return;
  }
  await acoes.registrarReenvio(conta.id, agora.toISOString());
  resumo.reenviadas++;
}

// ────────────────────────────── Wiring (Supabase) ──────────────────────────────

/** Página da varredura de `auth.users` pela admin API. */
const PAGINA_USUARIOS = 1000;
const CHAVE_AVISO_METADATA = 'aviso_inatividade_em';
const CHAVE_REENVIO_METADATA = 'aviso_inatividade_reenvio_em';
/** Link público da política — citado no corpo do aviso (LGPD/B2). */
const LINK_POLITICA_PRIVACIDADE =
  'https://douglas-devjr.github.io/barganha-legal/politica-de-privacidade.html';

/**
 * Percorre `auth.users` (admin API, paginado) e projeta a visão mínima do job.
 * `last_sign_in_at` é a atividade; sem ele (nunca logou) cai para `created_at`.
 */
async function* listarContasSupabase(
  db: ReturnType<typeof criarClienteSupabase>,
): AsyncIterable<ContaInativa> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGINA_USUARIOS });
    if (error) throw new Error(`Falha ao listar contas: ${error.message}`);
    const usuarios = data.users;
    for (const u of usuarios) {
      const ultimaAtividadeEm = u.last_sign_in_at ?? u.created_at;
      if (!ultimaAtividadeEm) continue; // sem âncora temporal: não arrisca.
      const avisadoEm =
        (u.user_metadata?.[CHAVE_AVISO_METADATA] as string | undefined) ?? undefined;
      const reenviadoEm =
        (u.user_metadata?.[CHAVE_REENVIO_METADATA] as string | undefined) ?? undefined;
      yield {
        id: u.id,
        ...(u.email ? { email: u.email } : {}),
        ultimaAtividadeEm,
        ...(avisadoEm ? { avisadoEm } : {}),
        ...(reenviadoEm ? { reenviadoEm } : {}),
      };
    }
    if (usuarios.length < PAGINA_USUARIOS) break;
  }
}

/**
 * Formata `iso` como dd/mm/aaaa no fuso de São Paulo — SEM depender de dados
 * de locale `pt-BR` do runtime (A3). Builds Node "small-icu" só empacotam a
 * locale `en-US`; se usássemos `Intl.DateTimeFormat('pt-BR', …)` ou
 * `toLocaleDateString('pt-BR')`, a formatação ficaria à mercê de qual ICU o
 * processo em produção tem instalado — e falha CALADA (cai para outro
 * formato, não lança erro). Usar `'en-US'` só para separar os componentes da
 * data no fuso certo, e montar `dd/mm/aaaa` manualmente, é determinístico em
 * qualquer build.
 */
function formatarDataBR(iso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${pegar('day')}/${pegar('month')}/${pegar('year')}`;
}

/**
 * Monta assunto/corpo do aviso de retenção (B2 — revisão LGPD). O mesmo texto
 * serve para o primeiro aviso e, com `ultimoAviso: true`, para o segundo
 * (reenvio) — só o tom de urgência muda. A data é sempre "a partir de", nunca
 * uma data fixa: a purga real só roda na próxima execução do cron após a
 * carência, que pode ser dias depois da data anunciada.
 */
function montarEmailAviso(
  purgaPrevistaEm: string,
  ultimoAviso: boolean,
): { assunto: string; corpoTexto: string } {
  const data = formatarDataBR(purgaPrevistaEm);

  const assunto = ultimoAviso
    ? 'Último aviso: sua conta no Barganha será apagada em breve'
    : 'Sua conta no Barganha será apagada por inatividade';

  const abertura = ultimoAviso
    ? 'Este é o ÚLTIMO aviso: sua conta no Barganha continua inativa. Pela nossa ' +
      'política de retenção, contas sem login por 24 meses são apagadas.'
    : 'Sua conta no Barganha está inativa há muito tempo. Pela nossa política de ' +
      'retenção, contas sem login por 24 meses são apagadas.';

  const corpoTexto = [
    abertura,
    '',
    'O QUE SERÁ APAGADO',
    'Sua conta e todo o histórico de notas e compras registradas nela — de forma ' +
      'DEFINITIVA e IRREVERSÍVEL. Não há como recuperar depois.',
    '',
    'O QUE NÃO É AFETADO',
    'Os preços que você ajudou a registrar já são anônimos desde a origem — nunca ' +
      'tiveram ligação com sua conta — e continuam na base coletiva do Barganha, ' +
      'ajudando outras pessoas a comparar preços.',
    '',
    'A PARTIR DE QUANDO',
    `A partir de ${data}, se nada mudar.`,
    '',
    'COMO CANCELAR',
    'Basta abrir o app e fazer login antes dessa data. Nenhuma outra ação é necessária.',
    '',
    'Nunca pedimos senha, CPF ou qualquer dado por e-mail. Este aviso não tem link ' +
      'de login — abra o app diretamente, pelo ícone no seu celular.',
    '',
    'Se você discorda deste apagamento, quer manter a conta sem fazer login, ou ' +
      'quer exercer qualquer direito garantido pela LGPD (acesso, correção, ' +
      'portabilidade, oposição), é só responder este e-mail — a caixa é monitorada.',
    '',
    `Política de privacidade completa:\n${LINK_POLITICA_PRIVACIDADE}`,
  ].join('\n');

  return { assunto, corpoTexto };
}

/**
 * Ações reais no Supabase. `avisar`/`reenviar` mandam o email via
 * `enviarEmail` (Resend, C9.2) — mas SÓ se `emailApiKey`/`emailRemetente`
 * estiverem configurados (`lerConfig`) e a conta tiver `email`. Faltando
 * qualquer um dos dois, `enviarEmail` devolve `false` e a purga fica travada
 * por segurança (ver cabeçalho: sem aviso, sem purga). `registrarAviso`/
 * `registrarReenvio` fazem merge no metadata para não apagar o `nome` de
 * exibição.
 */
function acoesSupabase(
  db: ReturnType<typeof criarClienteSupabase>,
  log: ReturnType<typeof logDeJob>,
  emailConfig: Pick<ConfigBackend, 'emailApiKey' | 'emailRemetente'>,
): AcoesPurga {
  const gerenciador = new GerenciadorContaSupabase(db);

  /** `avisar`/`reenviar` só diferem no rótulo do log e no tom do texto. */
  async function enviarAvisoRetencao(
    conta: ContaInativa,
    purgaPrevistaEm: string,
    ultimoAviso: boolean,
  ): Promise<boolean> {
    const acao = ultimoAviso ? 'purga.reenvio' : 'purga.aviso';
    if (!conta.email) {
      // Sem email não há como avisar — a conta não avança para a purga.
      log.warn(
        { action: `${acao}_sem_email`, contaId: conta.id },
        `Aviso de inatividade (${ultimoAviso ? 'segundo' : 'primeiro'}) não enviado: conta sem email`,
      );
      return false;
    }

    const { assunto, corpoTexto } = montarEmailAviso(purgaPrevistaEm, ultimoAviso);
    const enviado = await enviarEmail(
      { destinatario: conta.email, assunto, corpoTexto, referencia: conta.id },
      { apiKey: emailConfig.emailApiKey, remetente: emailConfig.emailRemetente },
    );

    if (!enviado) {
      log.warn(
        { action: `${acao}_sem_canal`, contaId: conta.id },
        `Aviso de inatividade (${ultimoAviso ? 'segundo' : 'primeiro'}) não enviado: canal de email indisponível ou não configurado`,
      );
    }
    return enviado;
  }

  /** Merge de uma chave no `user_metadata`, sem apagar o resto (ex.: `nome`). */
  async function carimbarMetadata(id: string, chave: string, valor: string): Promise<void> {
    const atual = await db.auth.admin.getUserById(id);
    if (atual.error) throw new Error(`Falha ao ler conta ${id}: ${atual.error.message}`);
    const metadata = { ...(atual.data.user?.user_metadata ?? {}), [chave]: valor };
    const r = await db.auth.admin.updateUserById(id, { user_metadata: metadata });
    if (r.error) throw new Error(`Falha ao carimbar aviso em ${id}: ${r.error.message}`);
  }

  return {
    avisar: (conta, purgaPrevistaEm) => enviarAvisoRetencao(conta, purgaPrevistaEm, false),
    registrarAviso: (id, avisadoEm) => carimbarMetadata(id, CHAVE_AVISO_METADATA, avisadoEm),
    reenviar: (conta, purgaPrevistaEm) => enviarAvisoRetencao(conta, purgaPrevistaEm, true),
    registrarReenvio: (id, reenviadoEm) =>
      carimbarMetadata(id, CHAVE_REENVIO_METADATA, reenviadoEm),
    apagar: (id) => gerenciador.apagar(id),
  };
}

/** Monta as peças reais, roda a purga e loga um resumo. */
export async function rodarJobPurga(env: NodeJS.ProcessEnv = process.env): Promise<ResumoPurga> {
  const config = lerConfig(env);
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);
  const log = logDeJob('purga-inatividade');

  const aplicar = env.PURGA_APLICAR === 'true';
  const ttlDias = numeroOuPadrao(env.PURGA_TTL_DIAS, TTL_DIAS_PADRAO);
  const antecedenciaDias = numeroOuPadrao(env.PURGA_ANTECEDENCIA_DIAS, ANTECEDENCIA_DIAS_PADRAO);
  const reenvioDiasAntes = numeroOuPadrao(env.PURGA_REENVIO_DIAS_ANTES, REENVIO_DIAS_ANTES_PADRAO);

  const inicio = Date.now();
  const acoes = acoesSupabase(db, log, {
    emailApiKey: config.emailApiKey,
    emailRemetente: config.emailRemetente,
  });
  const resumo = await purgarContasInativas(listarContasSupabase(db), acoes, {
    ttlDias,
    antecedenciaDias,
    reenvioDiasAntes,
    aplicar,
  });

  log.info(
    {
      action: 'purga.concluida',
      aplicado: resumo.aplicado,
      contasExaminadas: resumo.contasExaminadas,
      avisadas: resumo.avisadas,
      semCanalDeAviso: resumo.semCanalDeAviso,
      reenviadas: resumo.reenviadas,
      semCanalDeReenvio: resumo.semCanalDeReenvio,
      purgadas: resumo.purgadas,
      aguardandoCarencia: resumo.aguardandoCarencia,
      ttlDias,
      antecedenciaDias,
      reenvioDiasAntes,
      duracaoMs: Date.now() - inicio,
    },
    aplicar
      ? 'Purga por inatividade concluída'
      : 'Purga por inatividade (relatório, nada aplicado)',
  );
  return resumo;
}

function numeroOuPadrao(bruto: string | undefined, padrao: number): number {
  if (bruto == null || bruto.trim() === '') return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

// Executado direto (não quando importado por um teste).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobPurga().catch((erro) => {
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('purga-inatividade').error(
      { erro: sanitizarErroInesperado(erro) },
      'Job de purga falhou',
    );
    process.exitCode = 1;
  });
}
