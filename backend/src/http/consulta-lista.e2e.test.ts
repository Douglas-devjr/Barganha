/**
 * C12.1 — E2E da lista comparada pela borda HTTP: rota anônima (sem Bearer),
 * validação do corpo e ranking cobertura→total com dados semeados no pool.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoComparacaoLista } from '../consulta/servico-comparacao-lista';
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
  servicoComparacaoLista: new ServicoComparacaoLista(repo),
  servicoSync: new ServicoSync(repo),
  autenticacao: new Autenticador(repo),
});

beforeAll(async () => {
  await app.ready();

  // Duas lojas do Rio + uma de Niterói, com estatística no escopo `loja`.
  repo.semearLoja({
    cnpj: '11111111000101',
    nomeFantasia: 'Mercado A',
    municipio: 'Rio de Janeiro',
    uf: 'RJ',
  });
  repo.semearLoja({
    cnpj: '22222222000102',
    nomeFantasia: 'Mercado B',
    municipio: 'RIO DE JANEIRO',
    uf: 'RJ',
  });
  repo.semearLoja({
    cnpj: '33333333000103',
    nomeFantasia: 'Mercado C',
    municipio: 'Niterói',
    uf: 'RJ',
  });
  const base = { escopo: 'loja', unidadeBase: 'kg', p25: 0, p75: 0, minimo: 0, maximo: 0 } as const;
  await repo.upsertEstatisticas([
    {
      ...base,
      produtoCanonicoId: 'arroz',
      escopoId: '11111111000101',
      mediana: 10,
      nObservacoes: 8,
    },
    {
      ...base,
      produtoCanonicoId: 'feijao',
      escopoId: '11111111000101',
      mediana: 9,
      nObservacoes: 6,
    },
    {
      ...base,
      produtoCanonicoId: 'arroz',
      escopoId: '22222222000102',
      mediana: 7,
      nObservacoes: 5,
    },
    {
      ...base,
      produtoCanonicoId: 'arroz',
      escopoId: '33333333000103',
      mediana: 5,
      nObservacoes: 5,
    },
  ]);
});
afterAll(async () => {
  await app.close();
});

describe('POST /consulta/lista (C12.1)', () => {
  it('é anônima e ranqueia por cobertura e depois preço, no recorte do município', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/lista',
      payload: {
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
        municipio: 'rio de janeiro',
        uf: 'RJ',
      },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.itensTotal).toBe(2);
    // Mercado C (Niterói) fica fora; A cobre 2 itens e vence de B (1 item, mais barato).
    expect(corpo.lojas.map((l: { nome: string }) => l.nome)).toEqual(['Mercado A', 'Mercado B']);
    expect(corpo.lojas[0]).toMatchObject({ total: 19, itensCobertos: 2 });
    expect(corpo.lojas[1]).toMatchObject({ total: 7, itensCobertos: 1 });
  });

  it('valida o corpo: lista vazia é 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/consulta/lista', payload: { itens: [] } });
    expect(r.statusCode).toBe(400);
  });
});
