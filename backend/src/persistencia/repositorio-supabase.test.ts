/**
 * Contrato da escrita transacional (C9.3.1). Não sobe Postgres: usa um cliente
 * Supabase FALSO que só captura a chamada `rpc`. Trava o que importa —
 * `marcarProcessado` delega a UMA função SQL (`processar_cupom`) com o payload
 * no formato esperado — e que o gate LGPD em runtime (C9.2) barra dado pessoal
 * antes de qualquer escrita.
 */

import { extrairObservacoesAnonimas, type ObservacaoAnonima } from '@barganha/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';
import { criarCifra, gerarChaveEnv } from '../seguranca/cifra';
import { RepositorioSupabase } from './repositorio-supabase';
import type { DadosNotaProcessada } from './tipos';

// C9.2.2 (b6) — chave de teste fixa (não é segredo real): `marcarProcessado`
// agora cifra `descricaoOriginal` antes de montar o payload da RPC.
const CIFRA_TESTE = criarCifra({ chaveAtual: gerarChaveEnv('1') });

interface ChamadaRpc {
  fn: string;
  args: Record<string, unknown>;
}

function clienteFalso(resultado: { error: unknown } = { error: null }) {
  const chamadas: ChamadaRpc[] = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    chamadas.push({ fn, args });
    return Promise.resolve({ data: null, ...resultado });
  });
  return { db: { rpc } as unknown as SupabaseClient, chamadas };
}

const ITEM: ItemCupomNovo = {
  produtoCanonicoId: 'p-cafe',
  descricaoOriginal: 'CAFE PILAO 500G',
  ean: '7891234567890',
  quantidade: 1,
  unidade: 'UN',
  valorUnitario: 16.9,
  valorTotal: 16.9,
};

/** Item sem EAN, só com o código interno da loja preservado (ver docs/03). */
const ITEM_SEM_EAN: ItemCupomNovo = {
  descricaoOriginal: 'BANANA PRATA',
  codigoLoja: '2000123',
  quantidade: 1.235,
  unidade: 'KG',
  valorUnitario: 6.99,
  valorTotal: 8.63,
};

function dados(
  observacoes: ObservacaoAnonima[],
  itensPrivados: ItemCupomNovo[] = [ITEM],
): DadosNotaProcessada {
  return {
    loja: {
      cnpj: '12345678000199',
      razaoSocial: 'MERCADO X',
      endereco: 'RUA Y, 10',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
    },
    emitidoEm: '2026-06-20T18:30:00.000Z',
    uf: 'RJ',
    itensPrivados,
    observacoes,
  };
}

const observacoesValidas = (): ObservacaoAnonima[] =>
  extrairObservacoesAnonimas({
    loja: { cnpj: '12345678000199', municipio: 'Rio de Janeiro', uf: 'RJ' },
    observadoEm: '2026-06-20T18:30:00.000Z',
    usuarioId: 'user-1',
    cupomId: 'cupom-1',
    itens: [
      { produtoCanonicoId: 'p-cafe', precoNormalizado: 33.8, unidadeBase: 'kg', emPromocao: false },
    ],
  });

describe('RepositorioSupabase.marcarProcessado (C9.3.1)', () => {
  it('delega a UMA RPC processar_cupom com o payload em snake_case', async () => {
    const { db, chamadas } = clienteFalso();
    const repo = new RepositorioSupabase(db, CIFRA_TESTE);

    await repo.marcarProcessado('cupom-1', dados(observacoesValidas()));

    expect(chamadas).toHaveLength(1);
    const { fn, args } = chamadas[0]!;
    expect(fn).toBe('processar_cupom');
    expect(args.p_cupom_id).toBe('cupom-1');
    expect(args.p_uf).toBe('RJ');
    expect(args.p_loja).toMatchObject({ cnpj: '12345678000199', razao_social: 'MERCADO X' });

    const itens = args.p_itens as Record<string, unknown>[];
    expect(itens[0]).toMatchObject({ produto_canonico_id: 'p-cafe', valor_unitario: 16.9 });

    const obs = args.p_observacoes as Record<string, unknown>[];
    expect(obs[0]).toMatchObject({ loja_cnpj: '12345678000199', preco_normalizado: 33.8 });
  });

  it('cifra a descrição do item ANTES de montar o payload da RPC (C9.2.2/b6)', async () => {
    const { db, chamadas } = clienteFalso();
    const repo = new RepositorioSupabase(db, CIFRA_TESTE);

    await repo.marcarProcessado('cupom-1', dados(observacoesValidas()));

    const itens = chamadas[0]!.args.p_itens as Record<string, unknown>[];
    const blob = itens[0]!.descricao_cifrada as string;
    // A RPC nunca vê o texto em claro — só um blob opaco.
    expect(blob).not.toContain('CAFE');
    expect(itens[0]!.descricao_original).toBeUndefined();
    // ... mas é reversível com a mesma chave (decifra de volta ao original).
    expect(CIFRA_TESTE.decifrar(blob)).toBe('CAFE PILAO 500G');
  });

  it('repassa o código interno da loja (codigoLoja → codigo_loja) para a RPC', async () => {
    const { db, chamadas } = clienteFalso();
    const repo = new RepositorioSupabase(db, CIFRA_TESTE);

    await repo.marcarProcessado('cupom-1', dados(observacoesValidas(), [ITEM, ITEM_SEM_EAN]));

    const { args } = chamadas[0]!;
    const itens = args.p_itens as Record<string, unknown>[];
    // Item COM EAN não carrega codigo_loja (seria redundante).
    expect(itens[0]).toMatchObject({ ean: '7891234567890', codigo_loja: null });
    // Item SEM EAN leva o código interno preservado do parser.
    expect(itens[1]).toMatchObject({ ean: null, codigo_loja: '2000123' });
  });

  it('aborta ANTES de escrever se uma observação carregar dado pessoal (gate C9.2)', async () => {
    const { db, chamadas } = clienteFalso();
    const repo = new RepositorioSupabase(db, CIFRA_TESTE);
    // Simula um defeito a montante: observação contaminada com chave de acesso.
    const contaminada = [
      { ...observacoesValidas()[0], chaveAcesso: '332606...' } as unknown as ObservacaoAnonima,
    ];

    await expect(repo.marcarProcessado('cupom-1', dados(contaminada))).rejects.toThrow(/proibido/i);
    expect(chamadas).toHaveLength(0); // nada chegou ao banco
  });

  it('propaga erro do banco como falha (a fila trata como transitório)', async () => {
    const { db } = clienteFalso({ error: { message: 'deadlock', code: '40P01' } });
    const repo = new RepositorioSupabase(db, CIFRA_TESTE);
    await expect(repo.marcarProcessado('cupom-1', dados(observacoesValidas()))).rejects.toThrow(
      /processamento transacional/i,
    );
  });
});
