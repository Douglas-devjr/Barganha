/**
 * C12.5 — e2e da denúncia de preço.
 *
 * O que estes testes protegem, além do caminho feliz: que a denúncia NÃO cria
 * caminho de escrita no pool e que a fila de curadoria NUNCA devolve o autor —
 * as duas garantias que fazem a feature caber na decisão travada #3 (docs/04).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { GuardaCuradoria } from '../auth/curadoria';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { ServicoDenuncia } from '../moderacao/servico-denuncia';
import { RegistroParsers } from '../parsers/registro';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoSync } from '../sync/servico-sync';

import { construirServidor } from './servidor';

const TOKEN = 'token-curador';
const curador = () => ({ authorization: `Bearer ${TOKEN}` });

const repo = new RepositorioMemoria();
// Ingestão é dependência obrigatória do servidor; aqui é só andaime — nenhum
// teste deste arquivo escaneia cupom.
const registro = new RegistroParsers([]);
const fila = new FilaMemoria(
  (t) => new ProcessadorCupom(repo, registro, new Anonimizador(repo)).processar(t.cupomId),
  { dormir: () => Promise.resolve() },
);
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, fila),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoSync: new ServicoSync(repo),
  servicoConta: new ServicoConta(repo),
  autenticacao: new Autenticador(repo),
  servicoDenuncia: new ServicoDenuncia(repo),
  autorizacaoCuradoria: new GuardaCuradoria([TOKEN]),
});

let usuarioId: string;
let produtoCanonicoId: string;
const comoUsuario = () => ({ 'x-usuario-id': usuarioId });

beforeAll(async () => {
  await app.ready();
  usuarioId = await repo.criarAnonimo();
  produtoCanonicoId = await repo.casarPorEan('7891234567890', {
    descricaoNormalizada: 'LEITE INTEGRAL 1L',
    unidadeBase: 'L',
  });
});

afterAll(async () => {
  await app.close();
});

describe('POST /denuncia (C12.5)', () => {
  it('exige conta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/denuncia',
      payload: { produtoCanonicoId, motivo: 'preco_divergente' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('aceita a denúncia e devolve 202 com status pendente', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/denuncia',
      headers: comoUsuario(),
      payload: {
        produtoCanonicoId,
        motivo: 'preco_divergente',
        municipio: 'Rio de Janeiro',
        uf: 'RJ',
      },
    });

    expect(r.statusCode).toBe(202);
    const corpo = r.json();
    expect(corpo.status).toBe('pendente');
    expect(corpo.jaRegistrada).toBe(false);
  });

  it('recusa motivo fora do enum no schema (400)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/denuncia',
      headers: comoUsuario(),
      payload: { produtoCanonicoId, motivo: 'nao_gostei' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('ignora usuarioId forjado no corpo — o autor vem do header', async () => {
    // O schema tem `additionalProperties: false`; o Fastify REMOVE o campo extra
    // em vez de recusar. O que importa é que o forjado não seja usado, então a
    // prova é a atribuição: a denúncia tem de cair na conta do header.
    const alvo = await repo.casarPorEan('7899999999999', {
      descricaoNormalizada: 'CAFE TORRADO 500G',
      unidadeBase: 'kg',
    });

    const comForja = await app.inject({
      method: 'POST',
      url: '/denuncia',
      headers: comoUsuario(),
      payload: { produtoCanonicoId: alvo, motivo: 'outro', usuarioId: 'forjado' },
    });
    expect(comForja.statusCode).toBe(202);
    expect(comForja.json().jaRegistrada).toBe(false);

    // Mesma conta (header), mesmo produto → o dedupe reconhece a aberta. Se o
    // `usuarioId` do corpo tivesse valido, seriam autores diferentes e esta
    // segunda denúncia nasceria nova.
    const segunda = await app.inject({
      method: 'POST',
      url: '/denuncia',
      headers: comoUsuario(),
      payload: { produtoCanonicoId: alvo, motivo: 'outro' },
    });
    expect(segunda.json().jaRegistrada).toBe(true);
    expect(segunda.json().id).toBe(comForja.json().id);
  });

  it('denunciar não escreve nada no pool anônimo', async () => {
    const antes = repo.observacoesDoPool().length;
    await app.inject({
      method: 'POST',
      url: '/denuncia',
      headers: comoUsuario(),
      payload: { produtoCanonicoId, motivo: 'unidade_errada' },
    });
    expect(repo.observacoesDoPool()).toHaveLength(antes);
  });
});

describe('GET /denuncia/fila (C12.5)', () => {
  it('nega sem token de curadoria', async () => {
    const r = await app.inject({ method: 'GET', url: '/denuncia/fila' });
    expect(r.statusCode).toBe(403);
  });

  it('lista as pendentes SEM expor o autor', async () => {
    const r = await app.inject({ method: 'GET', url: '/denuncia/fila', headers: curador() });

    expect(r.statusCode).toBe(200);
    const { denuncias } = r.json();
    expect(denuncias.length).toBeGreaterThan(0);
    for (const d of denuncias) {
      expect(d).not.toHaveProperty('usuarioId');
      expect(d).toHaveProperty('produtoCanonicoId');
      expect(d).toHaveProperty('abertasNoProduto');
    }
    // O corpo serializado inteiro não pode conter o id do autor.
    expect(r.body).not.toContain(usuarioId);
  });
});

describe('POST /denuncia/:id/decisao (C12.5)', () => {
  it('nega sem token e fecha com token', async () => {
    const fila = (
      await app.inject({ method: 'GET', url: '/denuncia/fila', headers: curador() })
    ).json();
    const alvo = fila.denuncias[0].id;

    const semToken = await app.inject({
      method: 'POST',
      url: `/denuncia/${alvo}/decisao`,
      payload: { procedente: true },
    });
    expect(semToken.statusCode).toBe(403);

    const comToken = await app.inject({
      method: 'POST',
      url: `/denuncia/${alvo}/decisao`,
      headers: curador(),
      payload: { procedente: true, resolucao: 'unidade corrigida' },
    });
    expect(comToken.statusCode).toBe(200);

    // Decidir de novo: já saiu da fila.
    const denovo = await app.inject({
      method: 'POST',
      url: `/denuncia/${alvo}/decisao`,
      headers: curador(),
      payload: { procedente: true },
    });
    expect(denovo.statusCode).toBe(404);
  });
});
