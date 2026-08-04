import { describe, expect, it } from 'vitest';

import { avaliarSaudeParsing, formatarAlerta, LIMIARES_PADRAO } from './alerta-parsing';
import type { SnapshotTelemetria } from './telemetria';

function snapshot(porUf: SnapshotTelemetria['porUf'], saude?: SnapshotTelemetria['saude']) {
  return {
    geradoEm: '2026-07-23T12:00:00.000Z',
    totais: {},
    porUf,
    unidadesRecusadas: {},
    ...(saude ? { saude } : {}),
  } satisfies SnapshotTelemetria;
}

describe('avaliarSaudeParsing', () => {
  it('não alerta quando a UF está saudável', () => {
    const r = avaliarSaudeParsing(snapshot({ RJ: { processado: 100, falha_permanente: 2 } }));
    expect(r.degradadas).toEqual([]);
  });

  it('alerta quando a taxa de falha passa do limiar', () => {
    const r = avaliarSaudeParsing(snapshot({ SP: { processado: 10, falha_permanente: 40 } }));
    expect(r.degradadas).toHaveLength(1);
    expect(r.degradadas[0]).toMatchObject({ uf: 'SP', falhas: 40, tentativas: 50 });
    expect(r.degradadas[0]!.taxa).toBeCloseTo(0.8);
  });

  it('ignora UF com amostra pequena — 1 de 2 não é sinal', () => {
    const r = avaliarSaudeParsing(snapshot({ MG: { processado: 1, falha_permanente: 1 } }));
    expect(r.degradadas).toEqual([]);
    expect(LIMIARES_PADRAO.amostraMinima).toBeGreaterThan(2);
  });

  it('aponta o motivo predominante para orientar a investigação', () => {
    // reCAPTCHA endurecido (erro_portal) pede reação diferente de layout mudado.
    const r = avaliarSaudeParsing(
      snapshot({ RJ: { processado: 10, erro_portal: 30, falha_permanente: 2 } }),
    );
    expect(r.degradadas[0]?.principalMotivo).toBe('erro_portal');
  });

  it('ordena da UF mais degradada para a menos', () => {
    const r = avaliarSaudeParsing(
      snapshot({
        RJ: { processado: 60, falha_permanente: 40 },
        SP: { processado: 5, falha_permanente: 45 },
      }),
    );
    expect(r.degradadas.map((d) => d.uf)).toEqual(['SP', 'RJ']);
  });

  it('não conta eventos que não são falha nossa como falha', () => {
    // `sem_parser`/`uf_nao_habilitada` são estados ESPERADOS do rollout (C10.3):
    // o cupom fica represado de propósito, ninguém precisa ser acordado por isso.
    const r = avaliarSaudeParsing(snapshot({ BA: { sem_parser: 100, uf_nao_habilitada: 50 } }));
    expect(r.degradadas).toEqual([]);
  });

  it('propaga falha de persistência da própria telemetria', () => {
    const r = avaliarSaudeParsing(snapshot({}, { falhasPersistencia: 3 }));
    expect(r.falhasPersistencia).toBe(3);
    expect(formatarAlerta(r)).toContain('telemetria: 3');
  });
});
