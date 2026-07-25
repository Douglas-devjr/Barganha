/**
 * C4.4 — E2E do catálogo regional pela borda HTTP: rota ANÔNIMA (sem Bearer),
 * validação do corpo e o cenário que motivou a etapa (docs/20) — uma conta nova,
 * sem cupom nenhum, encontrando produtos para montar a lista.
 */

import { chaveMunicipio } from '@barganha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoBuscaProdutos } from '../consulta/servico-busca-produtos';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

const repo = new RepositorioMemoria();
const registro = new RegistroParsers([]);
const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, fila, processador),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoBuscaProdutos: new ServicoBuscaProdutos(repo, repo),
  servicoSync: new ServicoSync(repo),
  autenticacao: new Autenticador(repo),
});

const RIO = chaveMunicipio('RJ', 'Rio de Janeiro');

beforeAll(async () => {
  await app.ready();

  const arroz = await repo.casarPorEan('111', {
    descricaoNormalizada: 'ARROZ TIPO 1 5KG',
    unidadeBase: 'kg',
  });
  const leite = await repo.casarPorEan('222', {
    descricaoNormalizada: 'LEITE INTEGRAL 1L',
    unidadeBase: 'L',
  });
  const base = {
    p25: 0,
    p75: 0,
    minimo: 0,
    maximo: 0,
    escopo: 'municipio',
    escopoId: RIO,
  } as const;
  await repo.upsertEstatisticas([
    { ...base, produtoCanonicoId: arroz, unidadeBase: 'kg', mediana: 8, nObservacoes: 40 },
    { ...base, produtoCanonicoId: leite, unidadeBase: 'L', mediana: 5, nObservacoes: 12 },
  ]);
});
afterAll(async () => {
  await app.close();
});

describe('POST /consulta/produtos (C4.4)', () => {
  it('é anônima e devolve os populares da região sem termo nenhum', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/produtos',
      payload: { municipio: 'rio de janeiro', uf: 'RJ' },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.produtos).toHaveLength(2);
    // Mais observado primeiro — a única regra de ordenação (decisão travada nº8).
    expect(corpo.produtos[0].estatistica.nObservacoes).toBe(40);
    expect(corpo.produtos[0].escopoResolvido).toBe('municipio');
  });

  it('filtra pelo termo digitado', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/produtos',
      payload: { termo: 'leite', municipio: 'Rio de Janeiro', uf: 'RJ' },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.produtos).toHaveLength(1);
    expect(corpo.produtos[0].produto.unidadeBase).toBe('L');
  });

  it('região sem dado devolve lista vazia, não erro', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/produtos',
      payload: { municipio: 'Manaus', uf: 'AM' },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().produtos).toEqual([]);
  });

  it('valida o corpo: tipo errado é 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/produtos',
      payload: { termo: 'arroz', limite: 'muitos' },
    });

    expect(r.statusCode).toBe(400);
  });

  /**
   * Guarda de privacidade (docs/04): o schema é fechado, então um campo que
   * tentasse identificar quem busca é DESCARTADO antes de chegar ao serviço — a
   * rota não tem por onde receber conta.
   */
  it('ignora campo desconhecido no corpo', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/produtos',
      payload: { municipio: 'Rio de Janeiro', uf: 'RJ', usuarioId: 'não-existe-aqui' },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().produtos).toHaveLength(2);
  });
});
