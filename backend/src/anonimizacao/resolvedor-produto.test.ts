import { describe, expect, it, vi } from 'vitest';

import type {
  CatalogoProdutos,
  FonteAliasTexto,
  MapaCodigoLoja,
  MapeamentoCodigoLoja,
  MapeamentoNovo,
} from './casamento';
import {
  avaliarMapeamento,
  type EntradaResolucao,
  LIMIARES_CODIGO_LOJA,
  proximaAncoraPreco,
  raizCnpj,
  ResolvedorProduto,
} from './resolvedor-produto';

const CNPJ = '31698759001780';

function catalogoFake(): CatalogoProdutos {
  return {
    casarPorEan: vi.fn((ean: string) => Promise.resolve(`canon-ean-${ean}`)),
    casarPorDescricao: vi.fn((s: { descricaoNormalizada: string }) =>
      Promise.resolve(`canon-desc-${s.descricaoNormalizada}`),
    ),
  };
}

/** Mapa em memória com espiões — espelha o adaptador real sem banco. */
function mapaFake(inicial: MapeamentoCodigoLoja[] = []) {
  const linhas = new Map(inicial.map((m) => [`${m.lojaCnpj}|${m.codigo}`, m]));
  const mapa: MapaCodigoLoja = {
    buscarMapeamento: vi.fn((cnpj: string, codigo: string) =>
      Promise.resolve(linhas.get(`${cnpj}|${codigo}`)),
    ),
    buscarMapeamentoDaRede: vi.fn((raiz: string, codigo: string) =>
      Promise.resolve(
        [...linhas.values()].find(
          (m) => m.codigo === codigo && raizCnpj(m.lojaCnpj) === raiz && m.status === 'ativo',
        ),
      ),
    ),
    registrarMapeamento: vi.fn((d: MapeamentoNovo) => {
      linhas.set(`${d.lojaCnpj}|${d.codigo}`, {
        ...d,
        status: 'ativo',
        ultimoVisto: '2026-08-05',
      } as MapeamentoCodigoLoja);
      return Promise.resolve();
    }),
    registrarUsoMapeamento: vi.fn(() => Promise.resolve()),
    marcarMapeamentoSuspeito: vi.fn(() => Promise.resolve()),
  };
  return { mapa, linhas };
}

function mapeamento(over: Partial<MapeamentoCodigoLoja> = {}): MapeamentoCodigoLoja {
  return {
    lojaCnpj: CNPJ,
    codigo: '214184',
    produtoCanonicoId: 'canon-morango',
    unidadeBase: 'kg',
    descricaoReferencia: 'MORANGO CAPTAIN FOODS 1,02KG CONG',
    precoReferencia: 30,
    status: 'ativo',
    origem: 'descricao_exata',
    ultimoVisto: '2026-08-01',
    ...over,
  };
}

function entrada(over: Partial<EntradaResolucao> = {}): EntradaResolucao {
  return {
    descricaoNormalizada: 'MORANGO CAPTAIN FOODS 1,02KG CONG',
    unidadeBase: 'kg',
    lojaCnpj: CNPJ,
    codigoLoja: '214184',
    precoNormalizado: 30,
    ...over,
  };
}

const AGORA = new Date('2026-08-05T12:00:00.000Z');

describe('avaliarMapeamento — guardas da chave (loja, código)', () => {
  it('aceita quando a descrição é a mesma', () => {
    const a = avaliarMapeamento(mapeamento(), entrada(), { agora: AGORA });
    expect(a.aceito).toBe(true);
    expect(a.saltoPreco).toBe(false);
  });

  it('aceita variação leve de escrita — é o motivo de a chave existir', () => {
    // O PDV abreviou a descrição. Sem a chave, isto criaria um canônico NOVO e
    // partiria a série de preço em duas, em silêncio.
    const a = avaliarMapeamento(
      mapeamento(),
      entrada({ descricaoNormalizada: 'MORANGO CAPTAIN FOODS 1,02KG CONGELADO' }),
      { agora: AGORA },
    );
    expect(a.aceito).toBe(true);
  });

  it('VETA quando a unidade-base diverge, por mais parecida que seja a descrição', () => {
    const a = avaliarMapeamento(mapeamento(), entrada({ unidadeBase: 'un' }), { agora: AGORA });
    expect(a.aceito).toBe(false);
    expect(a.motivo).toBe('unidade_divergente');
  });

  it('recusa descrição sem relação nenhuma', () => {
    const a = avaliarMapeamento(
      mapeamento(),
      entrada({ descricaoNormalizada: 'DETERGENTE NEUTRO 500ML' }),
      { agora: AGORA },
    );
    expect(a.aceito).toBe(false);
    expect(a.motivo).toBe('descricao_incompativel');
  });

  it('salto de preço NÃO veta sozinho — promoção e inflação existem', () => {
    const a = avaliarMapeamento(mapeamento(), entrada({ precoNormalizado: 4 }), { agora: AGORA });
    expect(a.aceito).toBe(true);
    expect(a.saltoPreco).toBe(true);
  });

  it('descrição na faixa de dúvida + salto de preço = reuso provável de SKU', () => {
    // A assinatura do reuso: a loja descontinuou o item e reciclou o código.
    // Nenhum dos dois sinais sozinho basta; juntos, qualificam a recusa.
    const a = avaliarMapeamento(
      mapeamento(),
      entrada({ descricaoNormalizada: 'MORANGO CONG PACOTE', precoNormalizado: 200 }),
      { agora: AGORA },
    );
    expect(a.aceito).toBe(false);
    expect(a.motivo).toBe('reuso_provavel');
  });

  it('linha dormente exige limiar mais estrito para voltar a valer', () => {
    const antiga = mapeamento({ ultimoVisto: '2024-01-01' });
    // Similaridade ~0,62: passa no limiar de linha ativa (0,55) e não no
    // estrito (0,65). É exatamente a faixa em que a dormência decide.
    const parcial = entrada({ descricaoNormalizada: 'MORANGO FOODS CONG' });
    // A mesma descrição passaria numa linha ativa...
    expect(avaliarMapeamento(mapeamento(), parcial, { agora: AGORA }).aceito).toBe(true);
    // ...mas não numa linha parada há mais de 18 meses.
    expect(avaliarMapeamento(antiga, parcial, { agora: AGORA }).aceito).toBe(false);
  });

  it('linha suspeita se recupera sozinha quando a descrição volta ao normal', () => {
    const suspeita = mapeamento({ status: 'suspeito' });
    const a = avaliarMapeamento(suspeita, entrada(), { agora: AGORA });
    expect(a.aceito).toBe(true);
  });
});

describe('proximaAncoraPreco', () => {
  it('adota a primeira observação quando não há âncora', () => {
    expect(proximaAncoraPreco(undefined, 12)).toBe(12);
  });

  it('é LENTA: uma promoção isolada não desloca a âncora', () => {
    // 30 → observação de 10 com peso 0,25 = 25. A âncora continua perto do
    // preço regular, que é o que a torna útil para detectar troca de item.
    expect(proximaAncoraPreco(30, 10)).toBeCloseTo(25, 5);
  });

  it('preserva a âncora quando não há preço novo', () => {
    expect(proximaAncoraPreco(30, undefined)).toBe(30);
  });
});

describe('ResolvedorProduto — ordem de resolução', () => {
  it('EAN real vence tudo', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake([mapeamento()]);
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(
      entrada({ ean: '7898967580542' }),
    );
    expect(r.via).toBe('ean');
    expect(r.produtoCanonicoId).toBe('canon-ean-7898967580542');
    expect(mapa.buscarMapeamento).not.toHaveBeenCalled();
  });

  it('registra a ponte EAN ↔ código quando a loja declara os dois', async () => {
    const { mapa } = mapaFake();
    await new ResolvedorProduto(catalogoFake(), { mapaCodigoLoja: mapa }).resolver(
      entrada({ ean: '7898967580542' }),
    );
    expect(mapa.registrarMapeamento).toHaveBeenCalledWith(
      expect.objectContaining({ origem: 'ean', eanVisto: '7898967580542' }),
    );
  });

  it('sem EAN, o código da loja resolve sem tocar no casamento por descrição', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake([mapeamento()]);
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(entrada());
    expect(r.via).toBe('codigo_loja');
    expect(r.produtoCanonicoId).toBe('canon-morango');
    expect(catalogo.casarPorDescricao).not.toHaveBeenCalled();
    expect(mapa.registrarUsoMapeamento).toHaveBeenCalled();
  });

  it('a chave sobrevive à deriva de descrição — a série de preço não se parte', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake([mapeamento()]);
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(
      entrada({ descricaoNormalizada: 'MORANGO CAPTAIN FOODS 1,02KG CONGELADO PROMO' }),
    );
    expect(r.produtoCanonicoId).toBe('canon-morango');
    expect(catalogo.casarPorDescricao).not.toHaveBeenCalled();
  });

  it('mapeamento recusado NÃO reaponta o canônico — marca e cai para o passo seguinte', async () => {
    const catalogo = catalogoFake();
    const { mapa, linhas } = mapaFake([mapeamento()]);
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(
      entrada({ descricaoNormalizada: 'DETERGENTE NEUTRO 500ML' }),
    );
    expect(mapa.marcarMapeamentoSuspeito).toHaveBeenCalled();
    expect(mapa.registrarUsoMapeamento).not.toHaveBeenCalled();
    expect(r.via).toBe('descricao');
    expect(r.recusa).toBe('descricao_incompativel');
    expect(r.produtoCanonicoId).toBe('canon-desc-DETERGENTE NEUTRO 500ML');

    // O ponto da guarda: a linha continua apontando para o produto ANTIGO e
    // esperando um humano. Se o passo 3 a reescrevesse (upsert), a suspeita
    // seria desfeita em silêncio no mesmo cupom que a levantou — a guarda
    // inteira viraria enfeite.
    expect(mapa.registrarMapeamento).not.toHaveBeenCalled();
    expect(linhas.get(`${CNPJ}|214184`)?.produtoCanonicoId).toBe('canon-morango');
  });

  it('recusa por unidade divergente também não reescreve o mapeamento', async () => {
    const { mapa, linhas } = mapaFake([mapeamento()]);
    await new ResolvedorProduto(catalogoFake(), { mapaCodigoLoja: mapa }).resolver(
      entrada({ unidadeBase: 'un' }),
    );
    expect(mapa.registrarMapeamento).not.toHaveBeenCalled();
    expect(linhas.get(`${CNPJ}|214184`)?.unidadeBase).toBe('kg');
  });

  it('alias CONFIRMADO vence o acha-ou-cria por descrição', async () => {
    // O bug que a C3.6.1 fecha: antes, a confirmação da curadoria era gravada e
    // nunca lida, então o cupom seguinte recriava o fragmento.
    const catalogo = catalogoFake();
    const aliasTexto: FonteAliasTexto = {
      buscarAliasConfirmado: vi.fn(() => Promise.resolve('canon-creme-de-leite')),
    };
    const r = await new ResolvedorProduto(catalogo, { aliasTexto }).resolver(
      entrada({ descricaoNormalizada: 'CR LEITE X 200G', codigoLoja: undefined }),
    );
    expect(r.via).toBe('alias');
    expect(r.produtoCanonicoId).toBe('canon-creme-de-leite');
    expect(catalogo.casarPorDescricao).not.toHaveBeenCalled();
  });

  it('sem alias e sem código, cai na descrição exata (comportamento de sempre)', async () => {
    const catalogo = catalogoFake();
    const r = await new ResolvedorProduto(catalogo).resolver(entrada({ codigoLoja: undefined }));
    expect(r.via).toBe('descricao');
    expect(catalogo.casarPorDescricao).toHaveBeenCalledOnce();
  });

  it('a chave NUNCA cria canônico: código desconhecido cai para a descrição', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake();
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(entrada());
    expect(r.via).toBe('descricao');
    expect(catalogo.casarPorDescricao).toHaveBeenCalledOnce();
    // ...e o mapeamento nasce do resultado do caminho FORTE, nunca ao contrário.
    expect(mapa.registrarMapeamento).toHaveBeenCalledWith(
      expect.objectContaining({ origem: 'descricao_exata' }),
    );
  });

  it('o mesmo código em outra rede não vaza: a chave inclui o CNPJ', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake([mapeamento()]);
    const r = await new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa }).resolver(
      entrada({ lojaCnpj: '99888777000166' }),
    );
    expect(r.produtoCanonicoId).not.toBe('canon-morango');
    expect(r.via).toBe('descricao');
  });

  it('herança entre filiais da mesma rede só acontece com a flag ligada', async () => {
    const outraFilial = mapeamento({ lojaCnpj: '31698759002099' });
    const semFlag = mapaFake([outraFilial]);
    const r1 = await new ResolvedorProduto(catalogoFake(), {
      mapaCodigoLoja: semFlag.mapa,
    }).resolver(entrada());
    expect(r1.via).toBe('descricao');

    const comFlag = mapaFake([outraFilial]);
    const r2 = await new ResolvedorProduto(
      catalogoFake(),
      { mapaCodigoLoja: comFlag.mapa },
      { alargarPorRede: true },
    ).resolver(entrada());
    expect(r2.via).toBe('codigo_rede');
    expect(r2.produtoCanonicoId).toBe('canon-morango');
    // Materializa a linha da filial para a próxima compra não depender da hipótese.
    expect(comFlag.mapa.registrarMapeamento).toHaveBeenCalledWith(
      expect.objectContaining({ lojaCnpj: CNPJ }),
    );
  });

  it('a recusa de um item não vaza para o item seguinte (resolvedor é compartilhado)', async () => {
    const catalogo = catalogoFake();
    const { mapa } = mapaFake([mapeamento()]);
    const resolvedor = new ResolvedorProduto(catalogo, { mapaCodigoLoja: mapa });
    const comRecusa = await resolvedor.resolver(
      entrada({ descricaoNormalizada: 'DETERGENTE NEUTRO 500ML' }),
    );
    expect(comRecusa.recusa).toBe('descricao_incompativel');
    const limpo = await resolvedor.resolver(
      entrada({ codigoLoja: undefined, descricaoNormalizada: 'ARROZ TIPO 1 5KG' }),
    );
    expect(limpo.recusa).toBeUndefined();
  });
});

describe('raizCnpj', () => {
  it('extrai os 8 dígitos que as filiais de uma rede compartilham', () => {
    expect(raizCnpj('31698759001780')).toBe('31698759');
    expect(raizCnpj('31.698.759/0020-99')).toBe('31698759');
  });
});

describe('LIMIARES_CODIGO_LOJA', () => {
  it('mantém a ordem duvida < aceita < estrita (a calibrar com dados reais)', () => {
    expect(LIMIARES_CODIGO_LOJA.duvida).toBeLessThan(LIMIARES_CODIGO_LOJA.aceita);
    expect(LIMIARES_CODIGO_LOJA.aceita).toBeLessThan(LIMIARES_CODIGO_LOJA.estrita);
  });
});
