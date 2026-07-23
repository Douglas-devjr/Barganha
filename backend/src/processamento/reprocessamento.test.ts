import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FilaMemoria } from '../fila/fila-memoria';
import type { TarefaProcessamento } from '../fila/tipos';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { ReprocessadorRetroativo } from './reprocessamento';

const fix = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../parsers/__fixtures__/${n}`, import.meta.url)), 'utf8');

/** Fila que só registra o que foi enfileirado (não processa nada). */
class FilaEspia {
  readonly enfileiradas: TarefaProcessamento[] = [];
  enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    this.enfileiradas.push(tarefa);
    return Promise.resolve();
  }
}

async function cupomEm(
  repo: RepositorioMemoria,
  usuarioId: string,
  chaveAcesso: string,
): Promise<string> {
  const { cupomId } = await repo.criarOuObterPorChave({
    usuarioId,
    chaveAcesso,
    uf: 'RJ',
    qrPayload: `qr-${chaveAcesso}`,
    capturadoEm: new Date().toISOString(),
  });
  return cupomId;
}

function montar() {
  const repo = new RepositorioMemoria();
  const registro = new RegistroParsers([
    new ParserRj(new ClienteSefazMemoria({ RJ: fix('rj-nota-1.html') })),
  ]);
  const fila = new FilaEspia();
  return { repo, fila, reprocessador: new ReprocessadorRetroativo(repo, registro, fila) };
}

describe('ReprocessadorRetroativo.recuperarPendentes (recuperação de boot)', () => {
  it('re-enfileira o que ficou preso em qr_capturado', async () => {
    // A fila vive na memória do processo: um restart (deploy, ou a instância do
    // free tier acordando) evaporava o pendente e o cupom ficava eternamente
    // em "processando" na tela do usuário, sem ninguém para retomá-lo.
    const { repo, fila, reprocessador } = montar();
    await cupomEm(repo, 'u1', 'chave-1');
    await cupomEm(repo, 'u1', 'chave-2');

    const n = await reprocessador.recuperarPendentes();

    expect(n).toBe(2);
    expect(fila.enfileiradas.map((t) => t.uf)).toEqual(['RJ', 'RJ']);
  });

  it('NÃO re-enfileira cupom em falha (evita laço a cada boot)', async () => {
    // `falha` é permanente (QR inválido). Re-tentar a cada subida seria um laço
    // infinito; para esses existe o reprocessamento explícito por UF.
    const { repo, fila, reprocessador } = montar();
    const cupomId = await cupomEm(repo, 'u1', 'chave-ruim');
    await repo.marcarFalha(cupomId, 'QR inválido');

    expect(await reprocessador.recuperarPendentes()).toBe(0);
    expect(fila.enfileiradas).toHaveLength(0);
  });

  it('respeita o limite por UF', async () => {
    const { repo, fila, reprocessador } = montar();
    for (let i = 0; i < 5; i++) await cupomEm(repo, 'u1', `chave-${i}`);

    const n = await reprocessador.recuperarPendentes({ limite: 3 });

    expect(n).toBe(3);
    expect(fila.enfileiradas).toHaveLength(3);
  });

  it('a fila real aceita o lote recuperado e o drena', async () => {
    const { repo, registro } = {
      repo: new RepositorioMemoria(),
      registro: new RegistroParsers([
        new ParserRj(new ClienteSefazMemoria({ RJ: fix('rj-nota-1.html') })),
      ]),
    };
    const processados: string[] = [];
    const fila = new FilaMemoria(
      (t) => {
        processados.push(t.cupomId);
        return Promise.resolve();
      },
      { dormir: () => Promise.resolve() },
    );
    const reprocessador = new ReprocessadorRetroativo(repo, registro, fila);
    await cupomEm(repo, 'u1', 'chave-1');
    await cupomEm(repo, 'u1', 'chave-2');

    await reprocessador.recuperarPendentes();
    await fila.ociosa();

    expect(processados).toHaveLength(2);
  });
});
