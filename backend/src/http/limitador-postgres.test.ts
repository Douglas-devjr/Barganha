/**
 * Testes do limitador Postgres (C9.3.2).
 *
 * Rodam contra um cliente Supabase FALSO que reimplementa `consumir_rate_limit`
 * em memória, com a mesma semântica da migração. É de propósito: a versão
 * anterior destes testes só rodava com `SUPABASE_URL`/service role no ambiente,
 * ou seja, nunca no CI — e o defeito que eles precisam pegar (o contador
 * vazando, o escopo colidindo) é exatamente o que passou despercebido.
 *
 * O que fica de fora daqui é a atomicidade real do `on conflict`, que é
 * garantia do Postgres e não do TypeScript. O que estes testes garantem é o
 * contrato do lado do cliente: uma única chamada por requisição, a chave com
 * escopo, a poda pelo `janela_ms` da própria linha e a queda para memória
 * quando o banco recusa.
 */

import { describe, expect, it, vi } from 'vitest';

import { LimitadorJanelaFixaPostgres } from './limitador-postgres';

interface LinhaJanela {
  inicio: number;
  contagem: number;
  janelaMs: number;
}

/** Cliente Supabase falso: só as duas RPCs, com a semântica da migração. */
function bancoFalso() {
  const tabela = new Map<string, LinhaJanela>();
  const chamadas: string[] = [];
  let falhar = false;

  const rpc = vi.fn(async (nome: string, args: Record<string, unknown>) => {
    chamadas.push(nome);
    if (falhar) return { data: null, error: { message: 'connection refused' } };

    if (nome === 'podar_rate_limit') {
      const agora = args.p_agora as number;
      let apagadas = 0;
      for (const [chave, linha] of tabela) {
        if (agora - linha.inicio >= linha.janelaMs) {
          tabela.delete(chave);
          apagadas += 1;
        }
      }
      return { data: apagadas, error: null };
    }

    const chave = args.p_chave as string;
    const agora = args.p_agora as number;
    const janelaMs = args.p_janela_ms as number;
    const maximo = args.p_maximo as number;

    const linha = tabela.get(chave);
    if (!linha || agora - linha.inicio >= janelaMs) {
      tabela.set(chave, { inicio: agora, contagem: 1, janelaMs });
      return { data: 1 <= maximo, error: null };
    }
    linha.contagem += 1;
    linha.janelaMs = janelaMs;
    return { data: linha.contagem <= maximo, error: null };
  });

  return {
    cliente: { rpc } as never,
    tabela,
    chamadas,
    rpc,
    derrubar: () => {
      falhar = true;
    },
  };
}

describe('LimitadorJanelaFixaPostgres (C9.3.2)', () => {
  it('libera até o máximo e barra o excedente dentro da janela', async () => {
    const db = bancoFalso();
    const t = 1_000;
    const lim = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100,
      maximo: 2,
      agora: () => t,
    });

    expect(await lim.permitir('ip-1')).toBe(true);
    expect(await lim.permitir('ip-1')).toBe(true);
    expect(await lim.permitir('ip-1')).toBe(false);
  });

  it('zera a contagem quando a janela vira', async () => {
    const db = bancoFalso();
    let t = 1_000;
    const lim = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100,
      maximo: 1,
      agora: () => t,
    });

    expect(await lim.permitir('ip-1')).toBe(true);
    expect(await lim.permitir('ip-1')).toBe(false);
    t += 100;
    expect(await lim.permitir('ip-1')).toBe(true);
  });

  it('conta cada chave isoladamente', async () => {
    const db = bancoFalso();
    const lim = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100,
      maximo: 1,
      agora: () => 0,
    });

    expect(await lim.permitir('ip-1')).toBe(true);
    expect(await lim.permitir('ip-2')).toBe(true);
    expect(await lim.permitir('ip-1')).toBe(false);
  });

  it('gasta UMA ida ao banco por requisição', async () => {
    // Regressão: a versão anterior fazia select + update/upsert em chamadas
    // separadas, o que além de custar o dobro abria a janela de corrida onde
    // duas requisições liam a mesma contagem e o teto vazava.
    const db = bancoFalso();
    const lim = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100,
      maximo: 5,
      agora: () => 0,
    });

    await lim.permitir('ip-1');
    await lim.permitir('ip-1');

    expect(db.chamadas).toEqual(['consumir_rate_limit', 'consumir_rate_limit']);
  });

  it('REGRESSÃO: escopos diferentes não dividem o mesmo contador', async () => {
    // O bug: os quatro guardas do servidor chaveiam por `req.ip` e gravavam na
    // mesma tabela. O mesmo IP consultando preço e criando conta somava tudo
    // numa linha só — o teto de 20/h derrubava a leitura de 120/min.
    const db = bancoFalso();
    const opcoes = { janelaMs: 100, maximo: 1, agora: () => 0 };
    const leitura = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', opcoes);
    const conta = new LimitadorJanelaFixaPostgres(db.cliente, 'conta-ip', opcoes);

    expect(await leitura.permitir('ip-1')).toBe(true);
    expect(await leitura.permitir('ip-1')).toBe(false); // teto de leitura estourado

    // O MESMO IP ainda tem o orçamento de criação de conta intacto.
    expect(await conta.permitir('ip-1')).toBe(true);
  });

  it('REGRESSÃO: a poda de uma janela curta não apaga a janela longa', async () => {
    // O bug: a poda apagava toda linha mais velha que a janela de QUEM podava.
    // O limitador de leitura (1 min) varria, a cada minuto, o estado do
    // limitador de conta (1 h) — que voltava do zero. Na prática, o teto de 20
    // contas por HORA virava 20 contas por minuto.
    const db = bancoFalso();
    let t = 0;
    const relogio = () => t;

    const conta = new LimitadorJanelaFixaPostgres(db.cliente, 'conta-ip', {
      janelaMs: 10_000, // janela longa
      maximo: 1,
      agora: relogio,
    });
    const leitura = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100, // janela curta — é quem vai podar
      maximo: 50,
      agora: relogio,
    });

    expect(await conta.permitir('ip-1')).toBe(true);
    expect(await conta.permitir('ip-1')).toBe(false); // teto da hora estourado

    // Passa uma janela CURTA: a leitura poda, mas a janela longa segue viva.
    t += 200;
    await leitura.permitir('ip-1');

    expect(await conta.permitir('ip-1')).toBe(false);

    // Já passada a janela LONGA, aí sim o orçamento volta.
    t += 10_000;
    expect(await conta.permitir('ip-1')).toBe(true);
  });

  it('com o banco fora, cai para o contador em memória em vez de estourar', async () => {
    // O limitador roda no `onRequest`: uma exceção aqui viraria 500 em TODAS as
    // rotas. Uma instabilidade do Postgres não pode derrubar consulta e sync.
    const db = bancoFalso();
    const lim = new LimitadorJanelaFixaPostgres(db.cliente, 'leitura-ip', {
      janelaMs: 100,
      maximo: 2,
      agora: () => 0,
    });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      db.derrubar();

      // Não lança — e o teto continua valendo, agora por processo.
      expect(await lim.permitir('ip-1')).toBe(true);
      expect(await lim.permitir('ip-1')).toBe(true);
      expect(await lim.permitir('ip-1')).toBe(false);
      expect(erro).toHaveBeenCalled();
    } finally {
      erro.mockRestore();
    }
  });
});
