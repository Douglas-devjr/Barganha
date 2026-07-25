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
 * Duas travas de segurança que fazem este job ser inofensivo por padrão:
 *   • **Sem aviso, sem purga.** Se `avisar` não conseguir notificar de fato (não
 *     há provedor de email configurado ⇒ devolve `false`), o relógio NÃO avança e
 *     a conta NUNCA é purgada. Ligar a purga de verdade depende de existir canal
 *     de email — antes disso o job só avisaria ninguém e nada apaga.
 *   • **Aviso vale só se for mais novo que a última atividade.** Se a pessoa voltar
 *     a logar depois de avisada, `ultimaAtividadeEm > avisadoEm` invalida o aviso
 *     e a purga é cancelada — sem precisar limpar o metadata.
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
import { lerConfig } from '../config/env';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro } from '../observabilidade/sanitizar';
import { criarClienteSupabase } from '../persistencia/supabase';

const DIA_MS = 24 * 60 * 60 * 1000;
/** ~24 meses. Em DIAS para a conta ser dias corridos, não meses de calendário. */
const TTL_DIAS_PADRAO = 730;
/** Quanto antes do TTL avisamos — e a carência entre o aviso e a purga. */
const ANTECEDENCIA_DIAS_PADRAO = 30;

/**
 * Visão mínima de uma conta para o job — sem dado sensível além do email (usado
 * só para avisar). `ultimaAtividadeEm` = último login, ou a criação quando a
 * conta nunca logou (cadastro abandonado).
 */
export interface ContaInativa {
  id: string;
  email?: string;
  ultimaAtividadeEm: string;
  /** `aviso_inatividade_em` do metadata, se já avisamos alguma vez. */
  avisadoEm?: string;
}

/**
 * Efeitos colaterais do job, injetados para o núcleo ser testável e o wiring
 * real ficar isolado (Supabase). Nenhum é chamado em modo relatório.
 */
export interface AcoesPurga {
  /**
   * Avisa a pessoa por email que a conta será apagada em `purgaPrevistaEm`.
   * Devolve `true` SÓ se o aviso saiu de fato — `false` (sem canal de email)
   * impede a purga (ver cabeçalho: sem aviso, sem purga).
   */
  avisar(conta: ContaInativa, purgaPrevistaEm: string): Promise<boolean>;
  /** Carimba `aviso_inatividade_em` no metadata (o relógio da purga). */
  registrarAviso(id: string, avisadoEm: string): Promise<void>;
  /** Apaga a conta e, em cascata, todo o histórico privado (docs/04). */
  apagar(id: string): Promise<void>;
}

export interface OpcoesPurga {
  /** TTL de inatividade em dias (padrão 730 ≈ 24 meses). */
  ttlDias?: number;
  /** Antecedência do aviso e carência antes da purga, em dias (padrão 30). */
  antecedenciaDias?: number;
  /** `false` (padrão) = relatório: conta o que faria, sem avisar nem apagar. */
  aplicar?: boolean;
  /** Injeta o "agora" para o teste (padrão: relógio real). */
  agora?: Date;
}

export interface ResumoPurga {
  contasExaminadas: number;
  /** Avisadas nesta rodada (aviso enviado + carimbado). */
  avisadas: number;
  /** Elegíveis a aviso, mas o aviso não saiu (sem canal) — não avançaram. */
  semCanalDeAviso: number;
  /** Purgadas nesta rodada (TTL + aviso + carência cumpridos). */
  purgadas: number;
  /** Passaram do TTL e foram avisadas, mas ainda dentro da carência. */
  aguardandoCarencia: number;
  /** `false` = foi só relatório (nada foi avisado nem apagado). */
  aplicado: boolean;
}

/** Um aviso só conta se for MAIS NOVO que a última atividade (ver cabeçalho). */
function avisoValido(conta: ContaInativa): boolean {
  return conta.avisadoEm != null && conta.avisadoEm > conta.ultimaAtividadeEm;
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
  const aplicar = opcoes.aplicar ?? false;
  const agora = opcoes.agora ?? new Date();

  const resumo: ResumoPurga = {
    contasExaminadas: 0,
    avisadas: 0,
    semCanalDeAviso: 0,
    purgadas: 0,
    aguardandoCarencia: 0,
    aplicado: aplicar,
  };

  for await (const conta of contas) {
    resumo.contasExaminadas++;
    const diasInativa = (agora.getTime() - new Date(conta.ultimaAtividadeEm).getTime()) / DIA_MS;

    if (diasInativa >= ttlDias) {
      // Passou do TTL. Purga só com aviso válido + carência cumprida.
      if (avisoValido(conta)) {
        const diasDesdeAviso = (agora.getTime() - new Date(conta.avisadoEm!).getTime()) / DIA_MS;
        if (diasDesdeAviso >= antecedenciaDias) {
          if (aplicar) await acoes.apagar(conta.id);
          resumo.purgadas++;
        } else {
          resumo.aguardandoCarencia++;
        }
      } else {
        // Passou do TTL mas nunca avisado (ou aviso invalidado por novo login):
        // avisa agora; a purga vem numa rodada futura, após a carência.
        await tentarAvisar(conta, acoes, opcoes, agora, resumo, aplicar);
      }
      continue;
    }

    // Janela de aviso: entrou nos últimos `antecedencia` dias antes do TTL.
    if (diasInativa >= ttlDias - antecedenciaDias && !avisoValido(conta)) {
      await tentarAvisar(conta, acoes, opcoes, agora, resumo, aplicar);
    }
    // Abaixo do limiar de aviso: conta ativa o bastante, nada a fazer.
  }

  return resumo;
}

/**
 * Manda o aviso e carimba o relógio — só em `aplicar`. Se o aviso não sair (sem
 * canal de email), NÃO carimba: sem aviso não pode haver purga (docs/04).
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

// ────────────────────────────── Wiring (Supabase) ──────────────────────────────

/** Página da varredura de `auth.users` pela admin API. */
const PAGINA_USUARIOS = 1000;
const CHAVE_AVISO_METADATA = 'aviso_inatividade_em';

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
      yield {
        id: u.id,
        ...(u.email ? { email: u.email } : {}),
        ultimaAtividadeEm,
        ...(avisadoEm ? { avisadoEm } : {}),
      };
    }
    if (usuarios.length < PAGINA_USUARIOS) break;
  }
}

/**
 * Ações reais no Supabase. O `avisar` HOJE não tem provedor de email transacional
 * (docs/16) — então só LOGA e devolve `false`, o que mantém a purga travada por
 * segurança. Quando o canal existir, é aqui que ele entra (e a purga passa a
 * fluir sozinha). O `registrarAviso` faz merge no metadata para não apagar o
 * `nome` de exibição.
 */
function acoesSupabase(
  db: ReturnType<typeof criarClienteSupabase>,
  log: ReturnType<typeof logDeJob>,
): AcoesPurga {
  const gerenciador = new GerenciadorContaSupabase(db);
  return {
    async avisar(conta, purgaPrevistaEm) {
      // Sem provedor de email transacional ainda: registramos a intenção e
      // devolvemos false — a conta não avança para a purga (ver cabeçalho).
      log.warn(
        { action: 'purga.aviso_sem_canal', contaId: conta.id, purgaPrevistaEm },
        'Aviso de inatividade não enviado: sem canal de email configurado',
      );
      return false;
    },
    async registrarAviso(id, avisadoEm) {
      const atual = await db.auth.admin.getUserById(id);
      if (atual.error) throw new Error(`Falha ao ler conta ${id}: ${atual.error.message}`);
      const metadata = {
        ...(atual.data.user?.user_metadata ?? {}),
        [CHAVE_AVISO_METADATA]: avisadoEm,
      };
      const r = await db.auth.admin.updateUserById(id, { user_metadata: metadata });
      if (r.error) throw new Error(`Falha ao carimbar aviso em ${id}: ${r.error.message}`);
    },
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

  const inicio = Date.now();
  const resumo = await purgarContasInativas(listarContasSupabase(db), acoesSupabase(db, log), {
    ttlDias,
    antecedenciaDias,
    aplicar,
  });

  log.info(
    {
      action: 'purga.concluida',
      aplicado: resumo.aplicado,
      contasExaminadas: resumo.contasExaminadas,
      avisadas: resumo.avisadas,
      semCanalDeAviso: resumo.semCanalDeAviso,
      purgadas: resumo.purgadas,
      aguardandoCarencia: resumo.aguardandoCarencia,
      ttlDias,
      antecedenciaDias,
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
    logDeJob('purga-inatividade').error({ erro: sanitizarErro(erro) }, 'Job de purga falhou');
    process.exitCode = 1;
  });
}
