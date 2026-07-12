/**
 * C9.1 — Teste e2e da JORNADA (topo da pirâmide de testes).
 *
 * Costura ponta a ponta as camadas C2→C3→C4 num único processo, pela borda
 * HTTP: conta anônima → ingestão do QR (RJ) → parsing/anonimização → pipeline
 * estatístico → consulta na gôndola → delta sync.
 *
 * Faz às vezes do "gate LGPD automatizado" (C9.2): depois de toda a jornada,
 * audita o pool compartilhado e prova que NÃO há dado pessoal nem como
 * reconstruir a cesta (re-identificação) — a garantia de docs/04, verificada
 * sobre dados que percorreram o sistema inteiro, não só o gate unitário.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CHAVES_PROIBIDAS_POOL } from '@barganha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { PipelineEstatistica } from '../estatistica/pipeline';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { digitoVerificadorChave } from '../parsers/chave-acesso';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { ParserSp } from '../parsers/sp';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

const fix = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../parsers/__fixtures__/${n}`, import.meta.url)), 'utf8');

// Um QR por usuário (nNF varia; DV recalculado): cupons FÍSICOS distintos.
// Mesmo QR entre contas não acumularia mais — o dedup global (C9.2.1) retém
// a segunda publicação da MESMA chave.
function qrRj(numeroNota: number): string {
  const nNF = String(numeroNota).padStart(9, '0');
  // cUF(33) AAMM(2606) CNPJ(12345678000199) mod(65) série(001) nNF(9) tpEmis(1) cNF(8)
  const chave43 = `3326061234567800019965001${nNF}100000001`;
  return `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${chave43}${digitoVerificadorChave(chave43)}|2|1`;
}
const EAN_CAFE = '7890000000017';
const CHAVES_PERMITIDAS_POOL = [
  'produtoCanonicoId',
  'lojaCnpj',
  'municipio',
  'uf',
  'precoNormalizado',
  'unidadeBase',
  'emPromocao',
  'observadoEm',
].sort();

const repo = new RepositorioMemoria();
const cliente = new ClienteSefazMemoria({ RJ: fix('rj-nota-1.html'), SP: fix('sp-nota-1.html') });
const registro = new RegistroParsers([new ParserRj(cliente), new ParserSp(cliente)]);
const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
  dormir: () => Promise.resolve(),
});
const pipeline = new PipelineEstatistica(repo, repo);
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, fila),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoSync: new ServicoSync(repo),
  servicoConta: new ServicoConta(repo),
  autenticacao: new Autenticador(repo),
});

const N_USUARIOS = 3; // ≥ MIN_OBSERVACOES_FALLBACK para a consulta ter base
const cupons: string[] = [];

beforeAll(async () => {
  await app.ready();
  // Três usuários distintos compram CUPONS distintos dos mesmos produtos →
  // o pool acumula 3 observações por produto (cada chave publica uma vez).
  for (let i = 0; i < N_USUARIOS; i++) {
    const conta = await app.inject({ method: 'POST', url: '/conta/anonima' });
    const usuarioId = conta.json().usuarioId as string;
    const ing = await app.inject({
      method: 'POST',
      url: '/ingestao/qr',
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { qrPayload: qrRj(i + 1), capturadoEm: '2026-06-27T12:00:00.000Z' },
    });
    cupons.push(ing.json().cupomId as string);
    await fila.ociosa();
  }
  await pipeline.recalcularTodos();
});
afterAll(async () => {
  await app.close();
});

describe('Jornada e2e (C2→C3→C4)', () => {
  it('processa os cupons e popula o pool (3 produtos × 3 usuários)', () => {
    // 2 produtos casados por EAN + a banana (sem EAN) casada pela descrição.
    for (const id of cupons) expect(repo.statusDoCupom(id)).toBe('processado');
    expect(repo.observacoesDoPool()).toHaveLength(3 * N_USUARIOS);
  });

  it('a consulta na gôndola devolve a faixa típica com base suficiente', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/preco',
      payload: { ean: EAN_CAFE, municipio: 'Rio de Janeiro', uf: 'RJ' },
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.escopoResolvido).toBeTruthy();
    expect(corpo.estatistica.nObservacoes).toBe(N_USUARIOS);
    expect(corpo.estatistica.mediana).toBeGreaterThan(0);
  });

  it('o delta sync devolve as estatísticas do município + cursor', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/sync/estatisticas',
      payload: { municipios: ['RJ:RIO DE JANEIRO', 'RJ'] },
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.estatisticas.length).toBeGreaterThanOrEqual(1);
    expect(corpo.cursor).toBeTruthy();
  });
});

describe('Gate LGPD sobre o pool após a jornada (C9.2)', () => {
  const pool = () => repo.observacoesDoPool();

  it('nenhuma observação carrega dado pessoal nem vínculo de cupom/usuário', () => {
    for (const o of pool()) {
      for (const proibida of CHAVES_PROIBIDAS_POOL) {
        expect(o).not.toHaveProperty(proibida);
      }
      expect(Object.keys(o).sort()).toEqual(CHAVES_PERMITIDAS_POOL);
    }
  });

  it('observadoEm é granular ao DIA — não dá para ordenar a cesta por horário', () => {
    for (const o of pool()) {
      expect(o.observadoEm).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('cesta dissolvida: o contexto (loja, dia) não é único por cupom', () => {
    // Reconstruir "estes itens juntos, deste cupom" exigiria um discriminador
    // por cesta. Como ele não existe, 3 cupons colapsam no MESMO contexto.
    const contextos = new Set(pool().map((o) => `${o.lojaCnpj}|${o.observadoEm}`));
    expect(contextos.size).toBeLessThan(cupons.length);
  });
});
