/**
 * C10.4 — Alertas CONFIGURÁVEIS sobre as anomalias que os blocos anteriores
 * passaram a medir.
 *
 * O `alerta-parsing.ts` (C10.2) vigia uma coisa só: a taxa de falha por UF. Ele
 * continua valendo — parser quebrado é a falha mais provável deste sistema — mas
 * não enxerga nada do que agora existe: latência subindo, cache que parou de
 * acertar, memória encostando no teto do free tier, serviço degradado.
 *
 * A decisão pura vive aqui e recebe os DOIS snapshots já prontos (`/saude` e
 * `/metricas`). Nenhuma rede, nenhum relógio, nenhum `process` — o que torna
 * cada limiar testável com um objeto literal, que é a única forma de ter
 * confiança em regra de alerta antes de ela disparar em produção.
 *
 * POR QUE LIMIAR CONFIGURÁVEL E NÃO CONSTANTE: o número certo só aparece depois
 * de o serviço rodar com tráfego real. Limiar cravado no código significa um
 * deploy para calibrar — e, na prática, significa que ninguém calibra e o
 * alerta é desligado por ruído. Aqui todos vêm do ambiente, com padrão sensato.
 *
 * AMOSTRA MÍNIMA, o mesmo princípio do alerta de parsing: p95 de três
 * requisições não é p95 de nada. Sem esse piso, a primeira chamada lenta depois
 * de a instância acordar (cold start do free tier, 30–60s) viraria alerta —
 * todo dia, até alguém desligar o alerta inteiro.
 */

import type { SnapshotMetricas } from './metricas';
import type { EstadoSaude, RelatorioSaude } from './saude';

export type Severidade = 'aviso' | 'critico';

export interface Anomalia {
  /** Chave estável da regra — agrupa ocorrências repetidas no destino. */
  regra: string;
  severidade: Severidade;
  /** Frase pronta para humano. Sem PII: só nomes de rota/cache e números. */
  mensagem: string;
}

export interface LimiaresAnomalia {
  /** p95 de resposta HTTP, por rota, em ms. */
  latenciaHttpP95Ms: number;
  /** p95 de uma operação de banco, em ms. */
  latenciaBancoP95Ms: number;
  /** Taxa de 5xx (0–1) por rota. */
  taxaErroHttp: number;
  /** Piso da taxa de acerto de cache (0–1) — abaixo disso ele custa sem servir. */
  taxaAcertoCacheMin: number;
  /** RSS do processo em MB. O free tier do Render dá 512MB. */
  memoriaRssMb: number;
  /** Uso médio de CPU (%) na janela entre coletas. */
  cpuPercentual: number;
  /** Chamadas mínimas para uma taxa/percentil ter significado. */
  amostraMinima: number;
}

export const LIMIARES_ANOMALIA_PADRAO: LimiaresAnomalia = {
  // Generoso de propósito: o backend fala com portais da SEFAZ e com o Supabase
  // pela rede pública, do Virginia para o Brasil. 2s de p95 é lento, mas 500ms
  // dispararia o tempo todo sem indicar problema nenhum.
  latenciaHttpP95Ms: 2_000,
  latenciaBancoP95Ms: 1_000,
  // 5% de 5xx já é muito: erro de servidor é bug, não uso incorreto (o 4xx, que
  // é uso incorreto, nem entra nesta conta — ver `metricas.ts`).
  taxaErroHttp: 0.05,
  // O cache de token existe porque o app faz polling; abaixo de 50% ele não
  // está cumprindo o que prometeu e vale investigar em vez de pagar a memória.
  taxaAcertoCacheMin: 0.5,
  // 400 de 512MB: espaço para agir antes de o Render matar o processo.
  memoriaRssMb: 400,
  cpuPercentual: 85,
  amostraMinima: 30,
};

/**
 * Lê os limiares do ambiente. Variável ausente ou inválida cai no padrão — o
 * alerta nunca deve sumir por causa de um número mal digitado.
 */
export function lerLimiares(env: NodeJS.ProcessEnv = process.env): LimiaresAnomalia {
  const num = (bruto: string | undefined, padrao: number): number => {
    const n = Number(bruto);
    return bruto != null && bruto.trim() !== '' && Number.isFinite(n) ? n : padrao;
  };
  const p = LIMIARES_ANOMALIA_PADRAO;
  return {
    latenciaHttpP95Ms: num(env.ALERTA_LATENCIA_HTTP_P95_MS, p.latenciaHttpP95Ms),
    latenciaBancoP95Ms: num(env.ALERTA_LATENCIA_BANCO_P95_MS, p.latenciaBancoP95Ms),
    taxaErroHttp: num(env.ALERTA_TAXA_ERRO_HTTP, p.taxaErroHttp),
    taxaAcertoCacheMin: num(env.ALERTA_TAXA_ACERTO_CACHE_MIN, p.taxaAcertoCacheMin),
    memoriaRssMb: num(env.ALERTA_MEMORIA_RSS_MB, p.memoriaRssMb),
    cpuPercentual: num(env.ALERTA_CPU_PERCENTUAL, p.cpuPercentual),
    amostraMinima: num(env.ALERTA_AMOSTRA_MINIMA, p.amostraMinima),
  };
}

/** Severidade derivada do estado de saúde — `degradado` avisa, `falho` acorda. */
const severidadeDaSaude = (estado: EstadoSaude): Severidade =>
  estado === 'falho' ? 'critico' : 'aviso';

/**
 * Decisão pura: quais anomalias este par de snapshots contém.
 *
 * `metricas` é opcional porque `/metricas` exige token de curadoria e pode não
 * estar configurado — nesse caso as regras de saúde ainda valem. Meio alerta é
 * melhor que nenhum.
 */
export function avaliarAnomalias(
  saude: RelatorioSaude,
  metricas?: SnapshotMetricas,
  limiares: LimiaresAnomalia = LIMIARES_ANOMALIA_PADRAO,
): Anomalia[] {
  const anomalias: Anomalia[] = [];

  if (saude.status !== 'ok') {
    const quebradas = saude.verificacoes.filter((v) => v.estado !== 'ok');
    anomalias.push({
      regra: 'saude',
      severidade: severidadeDaSaude(saude.status),
      mensagem:
        `serviço ${saude.status} (versão ${saude.versao}): ` +
        quebradas.map((v) => `${v.nome}=${v.estado}${detalhe(v.detalhe)}`).join('; '),
    });
  }

  if (!metricas) return ordenar(anomalias);

  for (const [rota, r] of Object.entries(metricas.http)) {
    if (r.chamadas < limiares.amostraMinima) continue;

    if (r.p95 > limiares.latenciaHttpP95Ms) {
      anomalias.push({
        regra: 'latencia-http',
        severidade: 'aviso',
        mensagem: `${rota}: p95 ${r.p95}ms (limiar ${limiares.latenciaHttpP95Ms}ms, ${r.chamadas} chamadas)`,
      });
    }

    const taxaErro = r.erros / r.chamadas;
    if (taxaErro > limiares.taxaErroHttp) {
      anomalias.push({
        regra: 'erro-http',
        // Crítico: 5xx é bug nosso e o usuário está sendo afetado agora.
        severidade: 'critico',
        mensagem: `${rota}: ${(taxaErro * 100).toFixed(0)}% de 5xx (${r.erros}/${r.chamadas})`,
      });
    }
  }

  for (const [operacao, r] of Object.entries(metricas.banco)) {
    if (r.chamadas < limiares.amostraMinima) continue;
    if (r.p95 > limiares.latenciaBancoP95Ms) {
      anomalias.push({
        regra: 'latencia-banco',
        severidade: 'aviso',
        mensagem: `${operacao}: p95 ${r.p95}ms (limiar ${limiares.latenciaBancoP95Ms}ms, ${r.chamadas} chamadas)`,
      });
    }
  }

  for (const [cache, r] of Object.entries(metricas.cache)) {
    const total = r.hits + r.misses;
    if (total < limiares.amostraMinima) continue;
    if (r.taxaAcerto < limiares.taxaAcertoCacheMin) {
      anomalias.push({
        regra: 'cache-frio',
        severidade: 'aviso',
        mensagem: `cache ${cache}: ${(r.taxaAcerto * 100).toFixed(0)}% de acerto em ${total} consultas`,
      });
    }
  }

  const { memoria, cpu } = metricas.processo;
  if (memoria.rssMb > limiares.memoriaRssMb) {
    anomalias.push({
      regra: 'memoria',
      severidade: 'critico',
      mensagem: `memória ${memoria.rssMb}MB (limiar ${limiares.memoriaRssMb}MB) — o Render mata o processo em 512MB`,
    });
  }
  if (cpu.percentual > limiares.cpuPercentual) {
    anomalias.push({
      regra: 'cpu',
      severidade: 'aviso',
      mensagem: `CPU em ${cpu.percentual}% (limiar ${limiares.cpuPercentual}%)`,
    });
  }

  return ordenar(anomalias);
}

const detalhe = (texto?: string): string => (texto ? ` (${texto})` : '');

/** Críticas primeiro: quem lê o alerta age pela primeira linha. */
const ordenar = (anomalias: Anomalia[]): Anomalia[] =>
  [...anomalias].sort(
    (a, b) => Number(b.severidade === 'critico') - Number(a.severidade === 'critico'),
  );

/** Mensagem humana. Sem PII: nomes de rota/cache e números agregados. */
export function formatarAnomalias(anomalias: Anomalia[]): string {
  const critico = anomalias.some((a) => a.severidade === 'critico');
  const titulo = critico ? '🔴 Barganha — anomalia crítica' : '🟡 Barganha — degradação';
  const linhas = anomalias.map((a) => `• [${a.regra}] ${a.mensagem}`);
  return [titulo, ...linhas].join('\n');
}
