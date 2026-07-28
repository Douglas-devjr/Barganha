/**
 * C10.4 — Health check com status DETALHADO.
 *
 * Antes daqui `/saude` respondia `{ ok: true }` — o pior tipo de instrumento:
 * responde saudável enquanto o Postgres está fora, a telemetria não grava e uma
 * UF habilitada não tem parser. Pior ainda, é ele que o Render usa como
 * `healthCheckPath`, então um deploy com o esquema fora de sincronia PASSAVA no
 * gate e ia ao ar.
 *
 * TRÊS ESTADOS, e a distinção entre eles é a decisão de design importante:
 *  • `ok`        — tudo respondendo.
 *  • `degradado` — algo está ruim mas REIMPLANTAR NÃO RESOLVERIA (Supabase
 *                  oscilando, fila represada, telemetria não gravando).
 *  • `falho`     — esta VERSÃO do código não serve (esquema fora de sincronia,
 *                  UF habilitada sem parser). Voltar à versão anterior resolve.
 *
 * É por isso que só `falho` derruba a prontidão (`/saude/pronto` → 503) e,
 * portanto, o deploy. Se uma queda do Supabase reprovasse o gate, o rollback
 * automático reverteria uma versão inocente E, pior, travaria a subida do
 * hotfix justamente durante o incidente. Degradação avisa (bloco 5) e deixa
 * passar; só regressão da versão bloqueia.
 *
 * O relatório é CACHEADO por alguns segundos porque `/saude` é a rota mais
 * chamada da operação — sonda do Render, cron `manter-api-acordada` e verificação
 * pós-deploy batem nela. Sem cache, cada ping viraria uma consulta ao banco.
 */

export type EstadoSaude = 'ok' | 'degradado' | 'falho';

export interface ResultadoSonda {
  estado: EstadoSaude;
  /** Motivo legível, já sanitizado. Ausente quando `ok`. */
  detalhe?: string;
}

export interface Sonda {
  /** Identificador estável — vira chave de painel e de alerta. */
  nome: string;
  /**
   * `true` → um `falho` aqui reprova a PRONTIDÃO e derruba o deploy. Reserve
   * para o que uma reimplantação da versão anterior de fato conserta.
   */
  critica: boolean;
  verificar(): Promise<ResultadoSonda>;
}

export interface VerificacaoRelatada extends ResultadoSonda {
  nome: string;
  critica: boolean;
  /** Quanto a sonda levou — uma sonda lenta já é sinal, mesmo respondendo `ok`. */
  duracaoMs: number;
}

export interface RelatorioSaude {
  status: EstadoSaude;
  geradoEm: string;
  /** SHA do commit em produção — sem isto não dá para saber O QUE está no ar. */
  versao: string;
  ambiente: string;
  /** Segundos desde o boot. Reinício em massa aparece aqui antes de qualquer log. */
  uptimeS: number;
  verificacoes: VerificacaoRelatada[];
}

export interface OpcoesMonitor {
  versao: string;
  ambiente: string;
  /** Validade do relatório em cache. Padrão 5s. `0` desliga o cache (testes). */
  cacheMs?: number;
  /** Teto por sonda. Estourou → `degradado`: a sonda travada não pode travar a rota. */
  timeoutSondaMs?: number;
  agora?: () => number;
  uptimeS?: () => number;
}

/** Pior estado vence — `ok` < `degradado` < `falho`. */
const SEVERIDADE: Record<EstadoSaude, number> = { ok: 0, degradado: 1, falho: 2 };

const pior = (a: EstadoSaude, b: EstadoSaude): EstadoSaude =>
  SEVERIDADE[a] >= SEVERIDADE[b] ? a : b;

export class MonitorSaude {
  private readonly cacheMs: number;
  private readonly timeoutSondaMs: number;
  private readonly agora: () => number;
  private readonly uptimeS: () => number;

  /** Última resposta e quando foi produzida — ver nota de cache no topo. */
  private cache?: { em: number; relatorio: RelatorioSaude };
  /** Coleta em andamento: rajada de pings compartilha UMA execução das sondas. */
  private emCurso?: Promise<RelatorioSaude>;

  constructor(
    private readonly sondas: Sonda[],
    private readonly opcoes: OpcoesMonitor,
  ) {
    this.cacheMs = opcoes.cacheMs ?? 5_000;
    this.timeoutSondaMs = opcoes.timeoutSondaMs ?? 3_000;
    this.agora = opcoes.agora ?? Date.now;
    this.uptimeS = opcoes.uptimeS ?? (() => Math.round(process.uptime()));
  }

  async relatorio(): Promise<RelatorioSaude> {
    const cache = this.cache;
    if (cache && this.agora() - cache.em < this.cacheMs) return cache.relatorio;
    // Sem isto, dez pings simultâneos após o cache vencer disparariam dez
    // rodadas de sondas — e a sonda de banco é uma consulta cada.
    this.emCurso ??= this.coletar().finally(() => {
      this.emCurso = undefined;
    });
    return this.emCurso;
  }

  private async coletar(): Promise<RelatorioSaude> {
    const verificacoes = await Promise.all(this.sondas.map((s) => this.rodar(s)));

    // Um `falho` de sonda NÃO crítica vale como `degradado`: ele diz que algo
    // está quebrado, mas não que ESTA versão do código é a culpada.
    const status = verificacoes.reduce<EstadoSaude>((acc, v) => {
      const efetivo = v.critica ? v.estado : v.estado === 'falho' ? 'degradado' : v.estado;
      return pior(acc, efetivo);
    }, 'ok');

    const relatorio: RelatorioSaude = {
      status,
      geradoEm: new Date(this.agora()).toISOString(),
      versao: this.opcoes.versao,
      ambiente: this.opcoes.ambiente,
      uptimeS: this.uptimeS(),
      verificacoes,
    };
    this.cache = { em: this.agora(), relatorio };
    return relatorio;
  }

  private async rodar(sonda: Sonda): Promise<VerificacaoRelatada> {
    const inicio = this.agora();
    const base = { nome: sonda.nome, critica: sonda.critica };
    try {
      const resultado = await comTimeout(sonda.verificar(), this.timeoutSondaMs);
      return { ...base, ...resultado, duracaoMs: this.agora() - inicio };
    } catch {
      // A sonda em si quebrou (ou estourou o tempo). `degradado`, nunca `falho`:
      // um instrumento cego não é prova de que a versão está ruim, e transformar
      // isso em rollback automático seria reverter por causa do termômetro.
      return {
        ...base,
        estado: 'degradado',
        detalhe: `sonda não respondeu em ${this.timeoutSondaMs}ms`,
        duracaoMs: this.agora() - inicio,
      };
    }
  }
}

/** Rejeita quando o tempo estoura — o timer não segura o processo (`unref`). */
function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref?.();
    promessa.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}
