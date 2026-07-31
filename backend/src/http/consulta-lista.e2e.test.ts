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

/** Datas do pool semeado — relativas a "agora" para o frescor não expirar. */
const DIA_MS = 86_400_000;
const ARROZ_A_EM = new Date(Date.now() - 2 * DIA_MS).toISOString();
const FEIJAO_A_EM = new Date(Date.now() - 9 * DIA_MS).toISOString();

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
      observadoEmMaisRecente: ARROZ_A_EM,
    },
    {
      ...base,
      produtoCanonicoId: 'feijao',
      escopoId: '11111111000101',
      mediana: 9,
      nObservacoes: 6,
      // Mais velho que o arroz — é ele que define a idade do Mercado A.
      observadoEmMaisRecente: FEIJAO_A_EM,
      menorPromocional: 7,
    },
    {
      ...base,
      produtoCanonicoId: 'arroz',
      escopoId: '22222222000102',
      mediana: 7,
      nObservacoes: 5,
      observadoEmMaisRecente: ARROZ_A_EM,
    },
    {
      ...base,
      produtoCanonicoId: 'arroz',
      escopoId: '33333333000103',
      mediana: 5,
      nObservacoes: 5,
      observadoEmMaisRecente: ARROZ_A_EM,
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

  it('devolve a evidência do total: nº de preços, idade do elo fraco e promoções fora', async () => {
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
    expect(r.json().lojas[0]).toMatchObject({
      nome: 'Mercado A',
      nObservacoes: 14, // 8 do arroz + 6 do feijão
      observadoEmMaisAntigo: FEIJAO_A_EM,
      itensComPromocao: 1, // o feijão — desconto que NÃO entrou no total
    });
  });

  it('honra a quantidade de cada item — cesta real não é "1 de cada"', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/lista',
      payload: {
        itens: [
          { produtoCanonicoId: 'arroz', quantidade: 5 },
          { produtoCanonicoId: 'feijao', quantidade: 2 },
        ],
        municipio: 'rio de janeiro',
        uf: 'RJ',
      },
    });

    expect(r.statusCode).toBe(200);
    // 10×5 + 9×2 = 68 (com quantidade 1 daria 19 e o ranking mudaria de sentido).
    expect(r.json().lojas[0]).toMatchObject({ nome: 'Mercado A', total: 68 });
  });

  it('valida o corpo: lista vazia é 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/consulta/lista', payload: { itens: [] } });
    expect(r.statusCode).toBe(400);
  });
});
