import { describe, expect, it, vi } from 'vitest';

import { type AcoesPurga, type ContaInativa, purgarContasInativas } from './purga-inatividade';

const REF = new Date('2026-07-24T12:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

/** ISO de `n` dias antes de REF. */
function diasAtras(n: number): string {
  return new Date(REF.getTime() - n * DIA_MS).toISOString();
}

/**
 * Ações fake; por padrão `avisar`/`reenviar` têm sucesso (há canal). Os dois
 * podem ser controlados de forma independente — é assim que testamos "o
 * primeiro aviso saiu mas o segundo falhou" (B3).
 */
function acoesFake(opcoes: { avisarSucesso?: boolean; reenviarSucesso?: boolean } = {}): {
  acoes: AcoesPurga;
  avisar: ReturnType<typeof vi.fn>;
  registrarAviso: ReturnType<typeof vi.fn>;
  reenviar: ReturnType<typeof vi.fn>;
  registrarReenvio: ReturnType<typeof vi.fn>;
  apagar: ReturnType<typeof vi.fn>;
} {
  const { avisarSucesso = true, reenviarSucesso = true } = opcoes;
  const avisar = vi.fn(() => Promise.resolve(avisarSucesso));
  const registrarAviso = vi.fn(() => Promise.resolve());
  const reenviar = vi.fn(() => Promise.resolve(reenviarSucesso));
  const registrarReenvio = vi.fn(() => Promise.resolve());
  const apagar = vi.fn(() => Promise.resolve());
  return {
    acoes: { avisar, registrarAviso, reenviar, registrarReenvio, apagar },
    avisar,
    registrarAviso,
    reenviar,
    registrarReenvio,
    apagar,
  };
}

const OPCOES = {
  ttlDias: 730,
  antecedenciaDias: 30,
  reenvioDiasAntes: 7,
  agora: REF,
  aplicar: true,
};

describe('purgarContasInativas (retenção por inatividade, docs/04 — dois avisos, B3)', () => {
  it('conta ativa o suficiente: nada acontece', async () => {
    const { acoes, avisar, reenviar, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'a', ultimaAtividadeEm: diasAtras(10) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ avisadas: 0, reenviadas: 0, purgadas: 0, aguardandoCarencia: 0 });
  });

  it('na janela de aviso (antes do TTL) e sem aviso: manda o PRIMEIRO aviso e carimba', async () => {
    const { acoes, avisar, registrarAviso, reenviar, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'b', email: 'b@x', ultimaAtividadeEm: diasAtras(710) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledWith('b', REF.toISOString());
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('primeiro aviso válido, mas ainda longe da janela do segundo aviso: aguarda sem mandar nada', async () => {
    const { acoes, avisar, reenviar, apagar } = acoesFake();
    // Passou do TTL, avisada há 10 dias — carência (30d) não cumprida e ainda
    // fora da janela final do segundo aviso (>= 30-7=23 dias desde o aviso).
    const contas: ContaInativa[] = [
      { id: 'd', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(10) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.aguardandoCarencia).toBe(1);
    expect(r.purgadas).toBe(0);
  });

  it('entrou na janela final antes da purga (carência ainda não cumprida): manda o SEGUNDO aviso, não purga', async () => {
    const { acoes, avisar, reenviar, registrarReenvio, apagar } = acoesFake();
    // Avisada há 25 dias: já dentro da janela do segundo aviso (>=23d), mas
    // ainda não cumpriu a carência de 30d do primeiro aviso.
    const contas: ContaInativa[] = [
      { id: 'e', email: 'e@x', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(25) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(registrarReenvio).toHaveBeenCalledWith('e', REF.toISOString());
    expect(apagar).not.toHaveBeenCalled();
    expect(r.reenviadas).toBe(1);
    expect(r.purgadas).toBe(0);
  });

  it('TTL vencido, carência cumprida, mas SEGUNDO aviso ainda não válido: manda-o agora, não purga', async () => {
    const { acoes, reenviar, registrarReenvio, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      { id: 'f', email: 'f@x', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(35) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(registrarReenvio).toHaveBeenCalledTimes(1);
    expect(apagar).not.toHaveBeenCalled();
    expect(r.reenviadas).toBe(1);
    expect(r.purgadas).toBe(0);
  });

  it('SEGUNDO aviso SEM canal (reenviar devolve false): não carimba reenvio nem purga', async () => {
    const { acoes, reenviar, registrarReenvio, apagar } = acoesFake({ reenviarSucesso: false });
    const contas: ContaInativa[] = [
      { id: 'g', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(35) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(registrarReenvio).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.semCanalDeReenvio).toBe(1);
    expect(r.reenviadas).toBe(0);
    expect(r.purgadas).toBe(0);
  });

  it('OS DOIS avisos válidos, TTL vencido e carência cumprida: PURGA', async () => {
    const { acoes, avisar, reenviar, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      {
        id: 'h',
        ultimaAtividadeEm: diasAtras(760),
        avisadoEm: diasAtras(40),
        reenviadoEm: diasAtras(5),
      },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).toHaveBeenCalledWith('h');
    expect(r.purgadas).toBe(1);
  });

  it('passou do TTL mas nunca avisado: manda o PRIMEIRO aviso agora, purga fica para depois', async () => {
    const { acoes, avisar, registrarAviso, reenviar, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'i', ultimaAtividadeEm: diasAtras(900) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledTimes(1);
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('SEM canal no PRIMEIRO aviso (avisar devolve false): não carimba nem avança para o reenvio', async () => {
    const { acoes, registrarAviso, reenviar, apagar } = acoesFake({ avisarSucesso: false });
    const contas: ContaInativa[] = [{ id: 'j', ultimaAtividadeEm: diasAtras(900) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(registrarAviso).not.toHaveBeenCalled();
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.semCanalDeAviso).toBe(1);
    expect(r.avisadas).toBe(0);
  });

  it('voltou a logar depois do primeiro aviso (aviso mais VELHO que a atividade): re-avisa, não purga', async () => {
    const { acoes, avisar, reenviar, apagar } = acoesFake();
    // Inativa há 760d, mas o aviso é de 900d atrás — anterior à última
    // atividade, logo inválido: a pessoa esteve ativa depois dele.
    const contas: ContaInativa[] = [
      { id: 'k', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(900) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(reenviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('voltou a logar depois do SEGUNDO aviso (reenvio mais VELHO que a atividade): reenvia de novo, não purga', async () => {
    const { acoes, avisar, reenviar, apagar } = acoesFake();
    // Primeiro aviso ainda válido (40d atrás, depois da atividade de 760d),
    // mas o reenvio é de 900d atrás — mais velho que a atividade: inválido.
    const contas: ContaInativa[] = [
      {
        id: 'l',
        ultimaAtividadeEm: diasAtras(760),
        avisadoEm: diasAtras(40),
        reenviadoEm: diasAtras(900),
      },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(apagar).not.toHaveBeenCalled();
    expect(r.reenviadas).toBe(1);
  });

  it('modo RELATÓRIO (aplicar=false): conta o que faria, sem efeito colateral', async () => {
    const { acoes, avisar, registrarAviso, reenviar, registrarReenvio, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      { id: 'ativa', ultimaAtividadeEm: diasAtras(10) },
      { id: 'avisar', ultimaAtividadeEm: diasAtras(710) },
      { id: 'reenviar', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(35) },
      {
        id: 'purgar',
        ultimaAtividadeEm: diasAtras(760),
        avisadoEm: diasAtras(40),
        reenviadoEm: diasAtras(5),
      },
      { id: 'carencia', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(10) },
    ];

    const r = await purgarContasInativas(contas, acoes, { ...OPCOES, aplicar: false });

    expect(avisar).not.toHaveBeenCalled();
    expect(registrarAviso).not.toHaveBeenCalled();
    expect(reenviar).not.toHaveBeenCalled();
    expect(registrarReenvio).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      aplicado: false,
      contasExaminadas: 5,
      avisadas: 1,
      reenviadas: 1,
      purgadas: 1,
      aguardandoCarencia: 1,
    });
  });

  it('percorre um iterável ASSÍNCRONO (paginação real)', async () => {
    const { acoes, apagar } = acoesFake();
    async function* fonte(): AsyncIterable<ContaInativa> {
      yield {
        id: 'm',
        ultimaAtividadeEm: diasAtras(760),
        avisadoEm: diasAtras(40),
        reenviadoEm: diasAtras(5),
      };
    }

    const r = await purgarContasInativas(fonte(), acoes, OPCOES);

    expect(apagar).toHaveBeenCalledWith('m');
    expect(r.purgadas).toBe(1);
  });
});
