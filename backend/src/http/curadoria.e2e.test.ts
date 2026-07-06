import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { GuardaCuradoria } from '../auth/curadoria';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { ServicoCuradoria } from '../curadoria/servico-curadoria';
import { MatcherTexto } from '../estatistica/casamento-texto';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { ServicoModeracao } from '../moderacao/servico-moderacao';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ReprocessadorRetroativo } from '../processamento/reprocessamento';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

const fix = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../parsers/__fixtures__/${n}`, import.meta.url)), 'utf8');

const TOKEN = 'token-curador';

function montarApp() {
  const repo = new RepositorioMemoria();
  const cliente = new ClienteSefazMemoria({ RJ: fix('rj-nota-1.html') });
  const registro = new RegistroParsers([new ParserRj(cliente)]);
  const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
    dormir: () => Promise.resolve(),
  });
  const app = construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    servicoConta: new ServicoConta(repo),
    autenticacao: new Autenticador(repo),
    servicoModeracao: new ServicoModeracao(repo, repo),
    servicoCuradoria: new ServicoCuradoria(repo),
    matcherTexto: new MatcherTexto(repo),
    autorizacaoCuradoria: new GuardaCuradoria([TOKEN]),
    reprocessador: new ReprocessadorRetroativo(repo, registro, fila),
  });
  return { app, repo };
}

const { app, repo } = montarApp();
let usuarioId: string;
const curador = () => ({ authorization: `Bearer ${TOKEN}` });

const LANCAMENTO = {
  ean: '7891234567890',
  descricao: 'Leite Integral 1L',
  unidade: 'L',
  valorUnitario: 5.49,
  lojaCnpj: '12345678000199',
  municipio: 'Rio de Janeiro',
  uf: 'RJ',
};

beforeAll(async () => {
  await app.ready();
  const r = await app.inject({ method: 'POST', url: '/conta/anonima' });
  usuarioId = r.json().usuarioId;
});
afterAll(async () => {
  await app.close();
});

describe('Curadoria & moderação (C11) — HTTP', () => {
  describe('Lançamento manual (C11.3)', () => {
    it('rejeita sem credencial (401)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/lancamento-manual',
        payload: LANCAMENTO,
      });
      expect(r.statusCode).toBe(401);
    });

    it('aceita lançamento com conta (202, pendente)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/lancamento-manual',
        headers: { authorization: `Bearer ${usuarioId}` },
        payload: LANCAMENTO,
      });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('pendente');
    });

    it('rejeita unidade não comparável (400)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/lancamento-manual',
        headers: { authorization: `Bearer ${usuarioId}` },
        payload: { ...LANCAMENTO, unidade: 'CX' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('Fila e decisão (C11.3) — só curadoria', () => {
    it('GET /moderacao/fila sem token → 403', async () => {
      const r = await app.inject({ method: 'GET', url: '/moderacao/fila' });
      expect(r.statusCode).toBe(403);
    });

    it('curadoria aprova → publica no pool e some da fila', async () => {
      const fila = await app.inject({ method: 'GET', url: '/moderacao/fila', headers: curador() });
      expect(fila.statusCode).toBe(200);
      const pendentes = fila.json().lancamentos as { id: string }[];
      expect(pendentes.length).toBeGreaterThanOrEqual(1);
      const id = pendentes[0]!.id;

      const dec = await app.inject({
        method: 'POST',
        url: `/moderacao/${id}/decisao`,
        headers: curador(),
        payload: { decisao: 'aprovar' },
      });
      expect(dec.statusCode).toBe(200);
      expect(dec.json().status).toBe('aprovado');
      expect(repo.observacoesDoPool().length).toBeGreaterThanOrEqual(1);
    });

    it('decisão sem token → 403', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/moderacao/qualquer/decisao',
        payload: { decisao: 'rejeitar', motivo: 'x' },
      });
      expect(r.statusCode).toBe(403);
    });

    it('decisão de id inexistente (com token) → 404', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/moderacao/00000000-0000-0000-0000-000000000000/decisao',
        headers: curador(),
        payload: { decisao: 'aprovar' },
      });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('Enriquecimento de produto (C11.5)', () => {
    it('curadoria enriquece o produto por EAN', async () => {
      // O produto já existe (criado na aprovação acima).
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/produto',
        headers: curador(),
        payload: { ean: '7891234567890', nomeExibicao: 'Leite Tirol 1L', categoria: 'Laticínios' },
      });
      expect(r.statusCode).toBe(200);
      const pid = r.json().produtoCanonicoId as string;
      const resumo = await repo.obterResumoProduto(pid);
      expect(resumo?.nomeExibicao).toBe('Leite Tirol 1L');
      expect(resumo?.categoria).toBe('Laticínios');
    });

    it('produto inexistente → 404', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/produto',
        headers: curador(),
        payload: { ean: '0000000000000', nomeExibicao: 'X' },
      });
      expect(r.statusCode).toBe(404);
    });

    it('sem token → 403', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/produto',
        payload: { ean: '7891234567890', nomeExibicao: 'X' },
      });
      expect(r.statusCode).toBe(403);
    });
  });

  describe('Sugestões de casamento por texto (C3.5)', () => {
    it('sem token → 403', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/sugestoes',
        payload: { descricao: 'Leite Integral 1L', unidadeBase: 'L' },
      });
      expect(r.statusCode).toBe(403);
    });

    it('unidade-base inválida → 400', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/sugestoes',
        headers: curador(),
        payload: { descricao: 'Leite Integral 1L', unidadeBase: 'CX' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('curadoria recebe sugestões ordenadas por confiança', async () => {
      // O produto "LEITE INTEGRAL 1L" (unidade L) existe — criado na aprovação
      // do lançamento manual acima. Uma variação com typo deve encontrá-lo.
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/sugestoes',
        headers: curador(),
        payload: { descricao: 'LEITE INTEGRL 1L', unidadeBase: 'L' },
      });
      expect(r.statusCode).toBe(200);
      const { sugestoes } = r.json() as {
        sugestoes: { produtoCanonicoId: string; confianca: number }[];
      };
      expect(sugestoes.length).toBeGreaterThanOrEqual(1);
      expect(sugestoes[0]!.confianca).toBeGreaterThan(0.45);
      // Nunca casa sozinho: a resposta é sugestão; confirmar é passo humano.
    });

    it('nada plausível → lista vazia (provável produto novo)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/sugestoes',
        headers: curador(),
        payload: { descricao: 'PARAFUSO SEXTAVADO 8MM', unidadeBase: 'L' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().sugestoes).toEqual([]);
    });
  });

  describe('Reprocessamento retroativo (C11.1)', () => {
    it('sem token → 403', async () => {
      const r = await app.inject({ method: 'POST', url: '/curadoria/reprocessar', payload: {} });
      expect(r.statusCode).toBe(403);
    });

    it('curadoria dispara o reprocesso → 200 com contador', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/reprocessar',
        headers: curador(),
        payload: { uf: 'RJ' },
      });
      expect(r.statusCode).toBe(200);
      expect(typeof r.json().reenfileirados).toBe('number');
    });
  });
});
