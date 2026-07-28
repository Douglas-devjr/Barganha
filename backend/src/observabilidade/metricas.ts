/**
 * C10.4 — Métricas de performance: latência de banco, acerto de cache, tempo de
 * resposta HTTP e o custo do processo (memória e CPU).
 *
 * O que existia até aqui contava DESFECHOS de parsing por UF (`telemetria.ts`):
 * quantos cupons processaram, quantos falharam. Isso responde "o parser do RJ
 * quebrou?" e não responde nenhuma das perguntas de operação: por que a consulta
 * de preço demorou, se o cache de token está servindo para alguma coisa, se a
 * instância está perto do teto de memória do free tier. Este módulo cobre isso.
 *
 * TRÊS DECISÕES QUE MOLDAM O ARQUIVO:
 *
 * 1. **Percentil, não média.** Média de latência esconde exatamente o caso que
 *    importa: 95 requisições em 40ms e 5 em 8s dão uma média tranquila de 440ms.
 *    O usuário que esperou 8s é real. (É o mesmo raciocínio da decisão travada
 *    nº6 sobre o veredito de preço — média mente sobre a cauda.)
 *
 * 2. **Amostra circular, não histórico.** Guardar toda medição faria a memória
 *    crescer sem limite num processo que fica dias no ar. Ficam as últimas N
 *    medições por chave; o percentil é da JANELA RECENTE, que é o que a operação
 *    quer saber. `chamadas`, `erros` e `maxMs` seguem acumulando desde o boot.
 *
 * 3. **Teto de chaves.** Se um dia alguém instrumentar com um id no nome
 *    ("consulta:produto-abc123"), a cardinalidade explode e o coletor vira o
 *    vazamento de memória que deveria denunciar. Passou do teto, novas chaves
 *    caem em `outros`.
 *
 * Tudo vive em memória e MORRE no restart — de propósito. No free tier a
 * instância dorme várias vezes ao dia; o que precisa sobreviver é o histórico
 * de parsing, que já tem tabela própria. Estes números são o "agora".
 */

export type ResultadoCache = 'hit' | 'miss';

/** Porta de ESCRITA — o domínio só registra, sem saber para onde vai. */
export interface Metricas {
  /** `operacao` é o nome do método do repositório (ex.: `obterDoUsuario`). */
  observarBanco(operacao: string, duracaoMs: number, ok: boolean): void;
  observarCache(cache: string, resultado: ResultadoCache): void;
  /** `rota` deve ser o template (`/cupom/:id`), nunca a URL concreta. */
  observarHttp(rota: string, duracaoMs: number, status: number): void;
}

export interface ResumoLatencia {
  chamadas: number;
  /** Erros do banco / respostas HTTP 5xx. */
  erros: number;
  p50: number;
  p95: number;
  maxMs: number;
}

export interface ResumoCache {
  hits: number;
  misses: number;
  /** 0–1. Cache com taxa baixa custa memória sem devolver nada. */
  taxaAcerto: number;
}

export interface ResumoProcesso {
  uptimeS: number;
  memoria: { rssMb: number; heapUsadoMb: number; heapTotalMb: number };
  /** `percentual` é o uso médio de CPU desde o snapshot anterior. */
  cpu: { percentual: number; usuarioMs: number; sistemaMs: number };
}

export interface SnapshotMetricas {
  geradoEm: string;
  processo: ResumoProcesso;
  banco: Record<string, ResumoLatencia>;
  cache: Record<string, ResumoCache>;
  http: Record<string, ResumoLatencia>;
}

export interface FonteResumoMetricas {
  resumo(): SnapshotMetricas;
}

/** Métricas no-op — padrão para testes e caminhos que não observam. */
export const metricasNulas: Metricas = {
  observarBanco: () => {},
  observarCache: () => {},
  observarHttp: () => {},
};

/** Medições guardadas por chave para o cálculo de percentil. */
const TAMANHO_AMOSTRA = 256;

/** Teto de chaves distintas por família — ver decisão 3 no topo. */
const MAX_CHAVES = 100;

const CHAVE_EXCEDENTE = 'outros';

const MB = 1024 * 1024;

/** Histograma de uma chave: amostra circular + acumulados desde o boot. */
class Histograma {
  private readonly amostras = new Array<number>(TAMANHO_AMOSTRA).fill(0);
  private proxima = 0;
  private preenchidas = 0;

  chamadas = 0;
  erros = 0;
  maxMs = 0;

  observar(duracaoMs: number, ok: boolean): void {
    this.chamadas++;
    if (!ok) this.erros++;
    if (duracaoMs > this.maxMs) this.maxMs = duracaoMs;

    this.amostras[this.proxima] = duracaoMs;
    this.proxima = (this.proxima + 1) % TAMANHO_AMOSTRA;
    if (this.preenchidas < TAMANHO_AMOSTRA) this.preenchidas++;
  }

  resumo(): ResumoLatencia {
    const janela = this.amostras.slice(0, this.preenchidas).sort((a, b) => a - b);
    return {
      chamadas: this.chamadas,
      erros: this.erros,
      p50: percentil(janela, 0.5),
      p95: percentil(janela, 0.95),
      maxMs: arredondar(this.maxMs),
    };
  }
}

/** Percentil por índice mais próximo — janela pequena não pede interpolação. */
function percentil(ordenadas: number[], fracao: number): number {
  if (ordenadas.length === 0) return 0;
  const i = Math.min(ordenadas.length - 1, Math.floor(fracao * ordenadas.length));
  return arredondar(ordenadas[i] ?? 0);
}

const arredondar = (n: number): number => Math.round(n * 100) / 100;

export class MetricasMemoria implements Metricas, FonteResumoMetricas {
  private readonly banco = new Map<string, Histograma>();
  private readonly http = new Map<string, Histograma>();
  private readonly cache = new Map<string, { hits: number; misses: number }>();

  /**
   * Leitura anterior de CPU. O `process.cpuUsage()` é ACUMULADO desde o boot —
   * exibi-lo cru diria "o processo já gastou 40s de CPU", que não responde se
   * ele está sob carga AGORA. O que interessa é a fatia entre dois snapshots.
   */
  private cpuAnterior = process.cpuUsage();
  private cpuMarcadoEm: number;

  constructor(
    private readonly agora: () => number = Date.now,
    private readonly uptimeS: () => number = () => Math.round(process.uptime()),
    private readonly usoMemoria: () => NodeJS.MemoryUsage = () => process.memoryUsage(),
    private readonly usoCpu: (anterior?: NodeJS.CpuUsage) => NodeJS.CpuUsage = process.cpuUsage,
  ) {
    this.cpuMarcadoEm = agora();
  }

  observarBanco(operacao: string, duracaoMs: number, ok: boolean): void {
    obter(this.banco, operacao).observar(duracaoMs, ok);
  }

  observarHttp(rota: string, duracaoMs: number, status: number): void {
    // Só 5xx conta como erro: 400/401/429 são o sistema FUNCIONANDO — recusar
    // requisição inválida ou acima do teto é o comportamento correto, e contá-la
    // como erro faria o alerta disparar com um usuário digitando errado.
    obter(this.http, rota).observar(duracaoMs, status < 500);
  }

  observarCache(cache: string, resultado: ResultadoCache): void {
    const chave = limitar(this.cache, cache);
    const atual = this.cache.get(chave) ?? { hits: 0, misses: 0 };
    if (resultado === 'hit') atual.hits++;
    else atual.misses++;
    this.cache.set(chave, atual);
  }

  resumo(): SnapshotMetricas {
    return {
      geradoEm: new Date(this.agora()).toISOString(),
      processo: this.processo(),
      banco: mapear(this.banco),
      http: mapear(this.http),
      cache: Object.fromEntries(
        [...this.cache].map(([nome, { hits, misses }]) => {
          const total = hits + misses;
          return [nome, { hits, misses, taxaAcerto: total === 0 ? 0 : arredondar(hits / total) }];
        }),
      ),
    };
  }

  private processo(): ResumoProcesso {
    const memoria = this.usoMemoria();
    const delta = this.usoCpu(this.cpuAnterior);
    const agora = this.agora();
    const janelaMs = Math.max(1, agora - this.cpuMarcadoEm);

    // `cpuUsage` vem em MICROssegundos; a janela, em milissegundos.
    const cpuMs = (delta.user + delta.system) / 1000;

    this.cpuAnterior = this.usoCpu();
    this.cpuMarcadoEm = agora;

    return {
      uptimeS: this.uptimeS(),
      memoria: {
        rssMb: arredondar(memoria.rss / MB),
        heapUsadoMb: arredondar(memoria.heapUsed / MB),
        heapTotalMb: arredondar(memoria.heapTotal / MB),
      },
      cpu: {
        percentual: arredondar((cpuMs / janelaMs) * 100),
        usuarioMs: arredondar(delta.user / 1000),
        sistemaMs: arredondar(delta.system / 1000),
      },
    };
  }
}

function obter(mapa: Map<string, Histograma>, chave: string): Histograma {
  const efetiva = limitar(mapa, chave);
  let h = mapa.get(efetiva);
  if (!h) {
    h = new Histograma();
    mapa.set(efetiva, h);
  }
  return h;
}

/** Devolve a chave, ou `outros` quando o teto de cardinalidade foi atingido. */
function limitar(mapa: Map<string, unknown>, chave: string): string {
  if (mapa.has(chave) || mapa.size < MAX_CHAVES) return chave;
  return CHAVE_EXCEDENTE;
}

const mapear = (mapa: Map<string, Histograma>): Record<string, ResumoLatencia> =>
  Object.fromEntries([...mapa].map(([nome, h]) => [nome, h.resumo()]));
