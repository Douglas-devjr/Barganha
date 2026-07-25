import { describe, expect, it, vi } from 'vitest';

import { type AcoesPurga, type ContaInativa, purgarContasInativas } from './purga-inatividade';

const REF = new Date('2026-07-24T12:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

/** ISO de `n` dias antes de REF. */
function diasAtras(n: number): string {
  return new Date(REF.getTime() - n * DIA_MS).toISOString();
}

/** Ações fake; por padrão `avisar` tem sucesso (há canal). */
function acoesFake(avisarSucesso = true): {
  acoes: AcoesPurga;
  avisar: ReturnType<typeof vi.fn>;
  registrarAviso: ReturnType<typeof vi.fn>;
  apagar: ReturnType<typeof vi.fn>;
} {
  const avisar = vi.fn(() => Promise.resolve(avisarSucesso));
  const registrarAviso = vi.fn(() => Promise.resolve());
  const apagar = vi.fn(() => Promise.resolve());
  return { acoes: { avisar, registrarAviso, apagar }, avisar, registrarAviso, apagar };
}

const OPCOES = { ttlDias: 730, antecedenciaDias: 30, agora: REF, aplicar: true };

describe('purgarContasInativas (retenção por inatividade, docs/04)', () => {
  it('conta ativa o suficiente: nada acontece', async () => {
    const { acoes, avisar, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'a', ultimaAtividadeEm: diasAtras(10) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ avisadas: 0, purgadas: 0, aguardandoCarencia: 0 });
  });

  it('na janela de aviso (antes do TTL) e sem aviso: avisa e carimba', async () => {
    const { acoes, avisar, registrarAviso, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'b', email: 'b@x', ultimaAtividadeEm: diasAtras(710) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledWith('b', REF.toISOString());
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('passou do TTL, avisado e carência cumprida: PURGA', async () => {
    const { acoes, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      { id: 'c', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(40) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(apagar).toHaveBeenCalledWith('c');
    expect(r.purgadas).toBe(1);
  });

  it('passou do TTL, avisado mas ainda na carência: aguarda, não apaga', async () => {
    const { acoes, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      { id: 'd', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(10) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(apagar).not.toHaveBeenCalled();
    expect(r.aguardandoCarencia).toBe(1);
    expect(r.purgadas).toBe(0);
  });

  it('passou do TTL mas nunca avisado: avisa agora, purga fica para depois', async () => {
    const { acoes, avisar, registrarAviso, apagar } = acoesFake();
    const contas: ContaInativa[] = [{ id: 'e', ultimaAtividadeEm: diasAtras(900) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledTimes(1);
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('SEM canal de email (avisar devolve false): não carimba nem purga', async () => {
    const { acoes, registrarAviso, apagar } = acoesFake(false);
    const contas: ContaInativa[] = [{ id: 'f', ultimaAtividadeEm: diasAtras(900) }];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(registrarAviso).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r.semCanalDeAviso).toBe(1);
    expect(r.avisadas).toBe(0);
  });

  it('voltou a logar depois de avisado (aviso mais VELHO que a atividade): re-avisa, não purga', async () => {
    const { acoes, avisar, apagar } = acoesFake();
    // Inativa há 760d, mas o aviso é de 900d atrás — anterior à última atividade,
    // logo inválido: a pessoa esteve ativa depois dele.
    const contas: ContaInativa[] = [
      { id: 'g', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(900) },
    ];

    const r = await purgarContasInativas(contas, acoes, OPCOES);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(apagar).not.toHaveBeenCalled();
    expect(r.avisadas).toBe(1);
  });

  it('modo RELATÓRIO (aplicar=false): conta o que faria, sem efeito colateral', async () => {
    const { acoes, avisar, registrarAviso, apagar } = acoesFake();
    const contas: ContaInativa[] = [
      { id: 'ativa', ultimaAtividadeEm: diasAtras(10) },
      { id: 'avisar', ultimaAtividadeEm: diasAtras(710) },
      { id: 'purgar', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(40) },
      { id: 'carencia', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(10) },
    ];

    const r = await purgarContasInativas(contas, acoes, { ...OPCOES, aplicar: false });

    expect(avisar).not.toHaveBeenCalled();
    expect(registrarAviso).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      aplicado: false,
      contasExaminadas: 4,
      avisadas: 1,
      purgadas: 1,
      aguardandoCarencia: 1,
    });
  });

  it('percorre um iterável ASSÍNCRONO (paginação real)', async () => {
    const { acoes, apagar } = acoesFake();
    async function* fonte(): AsyncIterable<ContaInativa> {
      yield { id: 'h', ultimaAtividadeEm: diasAtras(760), avisadoEm: diasAtras(40) };
    }

    const r = await purgarContasInativas(fonte(), acoes, OPCOES);

    expect(apagar).toHaveBeenCalledWith('h');
    expect(r.purgadas).toBe(1);
  });
});
