/**
 * C4.5 — E2E do delta de catálogo pela borda HTTP: rota ANÔNIMA (sem Bearer),
 * validação do corpo e o cenário que motiva a etapa (docs/05) — o app tem o
 * típico do produto em cache e precisa saber o NOME dele para exibir offline.
 */

import { describe, expect, it, afterAll, beforeAll } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoSync } from '../sync/servico-sync';
import { ServicoSyncCatalogo } from '../sync/servico-sync-catalogo';
import { construirServidor } from './servidor';

const repo = new RepositorioMemoria();
const registro = new RegistroParsers([]);
const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, fila, processador),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoSync: new ServicoSync(repo),
  servicoSyncCatalogo: new ServicoSyncCatalogo(repo),
  autenticacao: new Autenticador(repo),
});

let arroz = '';
let leite = '';

beforeAll(async () => {
  await app.ready();

  arroz = await repo.casarPorEan('111', {
    descricaoNormalizada: 'ARROZ TIPO 1 5KG',
    unidadeBase: 'kg',
  });
  leite = await repo.casarPorEan('222', {
    descricaoNormalizada: 'LEITE INTEGRAL 1L',
    unidadeBase: 'L',
  });
  // Só o arroz passou pela curadoria (C11.5) — o leite ainda é técnico.
  await repo.enriquecerProduto({
    produtoCanonicoId: arroz,
    nomeExibicao: 'Arroz Tio João Tipo 1 5kg',
    marca: 'Tio João',
    categoria: 'Mercearia',
  });
});
afterAll(async () => {
  await app.close();
});

describe('POST /sync/produtos (C4.5)', () => {
  it('é anônima e desce nome/marca/categoria dos ids em cache', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: [arroz] },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().produtos).toEqual([
      {
        produtoCanonicoId: arroz,
        nomeExibicao: 'Arroz Tio João Tipo 1 5kg',
        marca: 'Tio João',
        categoria: 'Mercearia',
        unidadeBase: 'kg',
      },
    ]);
  });

  /**
   * A `unidadeBase` vem SEMPRE, mesmo sem curadoria: é ela que deixa a tela
   * escrever "R$ 8,90/kg" offline. Sem nome, o app cai na descrição do cupom.
   */
  it('produto ainda não enriquecido volta só com a unidade base', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: [leite] },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().produtos).toEqual([{ produtoCanonicoId: leite, unidadeBase: 'L' }]);
  });

  it('id desconhecido não derruba o lote — apenas não volta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: ['id-que-nao-existe', arroz] },
    });

    expect(r.statusCode).toBe(200);
    expect(
      r.json().produtos.map((p: { produtoCanonicoId: string }) => p.produtoCanonicoId),
    ).toEqual([arroz]);
  });

  it('lote acima do teto do servidor é 400 (o cliente repagina)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: Array.from({ length: 201 }, (_, i) => `p-${i}`) },
    });

    expect(r.statusCode).toBe(400);
  });

  it('corpo inválido é 400 (sem ids, ou lista vazia)', async () => {
    const semCampo = await app.inject({ method: 'POST', url: '/sync/produtos', payload: {} });
    expect(semCampo.statusCode).toBe(400);

    const vazio = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: [] },
    });
    expect(vazio.statusCode).toBe(400);
  });

  /**
   * Guarda de privacidade (docs/04): o schema é fechado, então um campo que
   * tentasse identificar quem sincroniza é DESCARTADO antes de chegar ao
   * serviço — a rota não tem por onde receber conta.
   */
  it('ignora campo desconhecido no corpo', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: [arroz], usuarioId: 'não-existe-aqui' },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().produtos).toHaveLength(1);
  });
});

describe('POST /sync/produtos sem o serviço injetado', () => {
  it('não sobe a rota (nega fechado)', async () => {
    const semCatalogo = construirServidor({
      servicoIngestao: new ServicoIngestao(repo, fila, processador),
      servicoConsulta: new ServicoConsulta(repo, repo),
      servicoSync: new ServicoSync(repo),
      autenticacao: new Autenticador(repo),
    });
    await semCatalogo.ready();

    const r = await semCatalogo.inject({
      method: 'POST',
      url: '/sync/produtos',
      payload: { produtoCanonicoIds: [arroz] },
    });
    expect(r.statusCode).toBe(404);

    await semCatalogo.close();
  });
});
