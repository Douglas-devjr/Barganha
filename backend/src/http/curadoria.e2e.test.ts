import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { GuardaCuradoria } from '../auth/curadoria';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { ServicoCuradoria } from '../curadoria/servico-curadoria';
import { ServicoConfirmacaoCasamento } from '../curadoria/servico-confirmacao-casamento';
import { ServicoFilaCodigoLoja } from '../curadoria/servico-fila-codigo-loja';
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
    servicoConfirmacaoCasamento: new ServicoConfirmacaoCasamento(repo),
    servicoFilaCodigoLoja: new ServicoFilaCodigoLoja(repo),
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

  describe('Busca de produtos, paginada (C11.5)', () => {
    it('sem token → 403', async () => {
      const r = await app.inject({ method: 'GET', url: '/curadoria/produtos?q=leite' });
      expect(r.statusCode).toBe(403);
    });

    it('sem `q` → 400', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/curadoria/produtos',
        headers: curador(),
      });
      expect(r.statusCode).toBe(400);
    });

    it('acha o produto por nome (nome de exibição já enriquecido acima)', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/curadoria/produtos?q=Tirol',
        headers: curador(),
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as {
        itens: { produtoCanonicoId: string; ean?: string; nomeExibicao?: string }[];
        total: number;
        pagina: number;
        tamanhoPagina: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.itens.some((i) => i.ean === '7891234567890')).toBe(true);
      expect(body.pagina).toBe(1);
      expect(body.tamanhoPagina).toBe(20);
    });

    it('acha o produto por EAN', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/curadoria/produtos?q=7891234567890',
        headers: curador(),
      });
      expect(r.statusCode).toBe(200);
      const { itens } = r.json() as { itens: { ean?: string }[] };
      expect(itens.some((i) => i.ean === '7891234567890')).toBe(true);
    });

    it('página sem resultados → itens vazio, total zero', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/curadoria/produtos?q=produto-inexistente-zzz',
        headers: curador(),
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { itens: unknown[]; total: number };
      expect(body.itens).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('respeita pagina/tamanho da querystring', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/curadoria/produtos?q=Tirol&pagina=1&tamanho=1',
        headers: curador(),
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { itens: unknown[]; tamanhoPagina: number };
      expect(body.itens.length).toBeLessThanOrEqual(1);
      expect(body.tamanhoPagina).toBe(1);
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

  describe('Confirmação de casamento por texto (C3.5)', () => {
    it('sem token → 403', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/confirmar',
        payload: {
          produtoCanonicoId: '00000000-0000-0000-0000-000000000000',
          confianca: 0.9,
          textoOriginal: 'LEITE INTEGRAL 1L',
        },
      });
      expect(r.statusCode).toBe(403);
    });

    it('confianças inválidas → 400', async () => {
      const base = {
        produtoCanonicoId: '00000000-0000-0000-0000-000000000000',
        textoOriginal: 'LEITE INTEGRAL 1L',
      };
      for (const confianca of [-0.1, 1.1, 'abc']) {
        const r = await app.inject({
          method: 'POST',
          url: '/curadoria/casamento/confirmar',
          headers: curador(),
          payload: { ...base, confianca },
        });
        expect(r.statusCode).toBe(400);
      }
    });

    it('confirmação valida → 200 com aliasId', async () => {
      // Precisa de um produto existente primeiro.
      const sugestoes = await app.inject({
        method: 'POST',
        url: '/curadoria/casamento/sugestoes',
        headers: curador(),
        payload: { descricao: 'LEITE INTEGRL 1L', unidadeBase: 'L' },
      });
      const { sugestoes: lista } = sugestoes.json() as any;
      if (lista.length > 0) {
        const { produtoCanonicoId } = lista[0];
        const r = await app.inject({
          method: 'POST',
          url: '/curadoria/casamento/confirmar',
          headers: curador(),
          payload: {
            produtoCanonicoId,
            confianca: 0.85,
            textoOriginal: 'LEITE INTEGRL 1L',
          },
        });
        expect(r.statusCode).toBe(200);
        const { aliasId, confirmado } = r.json() as any;
        expect(aliasId).toBeDefined();
        expect(confirmado).toBe(true);
      }
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

  describe('Fila de códigos-loja suspeitos (C3.6.2)', () => {
    const LOJA_CNPJ_FILA = '31698759001780';

    it('sem token → 403 (GET e POSTs)', async () => {
      const get = await app.inject({ method: 'GET', url: '/curadoria/fila-codigo-loja' });
      expect(get.statusCode).toBe(403);
      const confirmar = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/confirmar',
        payload: { lojaCnpj: LOJA_CNPJ_FILA, codigo: 'X' },
      });
      expect(confirmar.statusCode).toBe(403);
      const reapontar = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/reapontar',
        payload: {
          lojaCnpj: LOJA_CNPJ_FILA,
          codigo: 'X',
          produtoCanonicoId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(reapontar.statusCode).toBe(403);
    });

    it('lista, confirma e reaponta uma linha suspeita', async () => {
      // Fixture: um mapeamento (loja, código) marcado suspeito pelo casamento —
      // o mesmo que `resolvedor-produto.ts` faz quando a descrição diverge.
      const produtoAtual = await repo.casarPorDescricao({
        descricaoNormalizada: 'CR LEITE X 200G',
        unidadeBase: 'un',
      });
      const produtoCorreto = await repo.casarPorDescricao({
        descricaoNormalizada: 'CREME DE LEITE X 200G',
        unidadeBase: 'un',
      });
      await repo.registrarMapeamento({
        lojaCnpj: LOJA_CNPJ_FILA,
        codigo: 'SKU-C3.6.2',
        produtoCanonicoId: produtoAtual,
        unidadeBase: 'un',
        descricaoReferencia: 'CR LEITE X 200G',
        origem: 'descricao_exata',
      });
      await repo.marcarMapeamentoSuspeito(LOJA_CNPJ_FILA, 'SKU-C3.6.2', 'descricao_divergente');

      const fila = await app.inject({
        method: 'GET',
        url: '/curadoria/fila-codigo-loja',
        headers: curador(),
      });
      expect(fila.statusCode).toBe(200);
      const { itens } = fila.json() as {
        itens: {
          lojaCnpj: string;
          codigo: string;
          status: string;
          produtoCanonico: { id: string };
        }[];
      };
      const item = itens.find((i) => i.codigo === 'SKU-C3.6.2');
      expect(item).toBeDefined();
      expect(item?.status).toBe('suspeito');
      expect(item?.produtoCanonico.id).toBe(produtoAtual);

      // Confirmar em par inexistente → 404.
      const confirmarInexistente = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/confirmar',
        headers: curador(),
        payload: { lojaCnpj: LOJA_CNPJ_FILA, codigo: 'nao-existe' },
      });
      expect(confirmarInexistente.statusCode).toBe(404);

      // Reapontar para produto inexistente → 400.
      const reapontarProdutoInexistente = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/reapontar',
        headers: curador(),
        payload: {
          lojaCnpj: LOJA_CNPJ_FILA,
          codigo: 'SKU-C3.6.2',
          produtoCanonicoId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(reapontarProdutoInexistente.statusCode).toBe(400);

      // Reaponta para o produto certo → 200, some da fila.
      const reapontar = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/reapontar',
        headers: curador(),
        payload: {
          lojaCnpj: LOJA_CNPJ_FILA,
          codigo: 'SKU-C3.6.2',
          produtoCanonicoId: produtoCorreto,
        },
      });
      expect(reapontar.statusCode).toBe(200);
      expect(reapontar.json().resultado).toBe('ok');

      const m = await repo.buscarMapeamento(LOJA_CNPJ_FILA, 'SKU-C3.6.2');
      expect(m?.status).toBe('ativo');
      expect(m?.produtoCanonicoId).toBe(produtoCorreto);

      const filaDepois = await app.inject({
        method: 'GET',
        url: '/curadoria/fila-codigo-loja',
        headers: curador(),
      });
      const itensDepois = filaDepois.json().itens as { codigo: string }[];
      expect(itensDepois.some((i) => i.codigo === 'SKU-C3.6.2')).toBe(false);
    });

    it('confirmar mantém o produto atual', async () => {
      const produtoId = await repo.casarPorDescricao({
        descricaoNormalizada: 'PAO FRANCES',
        unidadeBase: 'kg',
      });
      await repo.registrarMapeamento({
        lojaCnpj: LOJA_CNPJ_FILA,
        codigo: 'SKU-CONFIRMA',
        produtoCanonicoId: produtoId,
        unidadeBase: 'kg',
        descricaoReferencia: 'PAO FRANCES',
        origem: 'descricao_exata',
      });
      await repo.marcarMapeamentoSuspeito(LOJA_CNPJ_FILA, 'SKU-CONFIRMA', 'descricao_divergente');

      const r = await app.inject({
        method: 'POST',
        url: '/curadoria/fila-codigo-loja/confirmar',
        headers: curador(),
        payload: { lojaCnpj: LOJA_CNPJ_FILA, codigo: 'SKU-CONFIRMA' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().confirmado).toBe(true);

      const m = await repo.buscarMapeamento(LOJA_CNPJ_FILA, 'SKU-CONFIRMA');
      expect(m?.status).toBe('ativo');
      expect(m?.produtoCanonicoId).toBe(produtoId);
    });
  });
});
