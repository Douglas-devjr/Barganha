/**
 * C2.6 — A máquina de recuperação do coletor do RJ, percorrida inteira sem
 * WebView. Este arquivo existe porque o caminho mais importante do coletor — a
 * insistência contra a recusa do reCAPTCHA — é justamente o que NÃO se observa
 * na tela: ele acontece sozinho, é intermitente por natureza (o mesmo aparelho
 * passa minutos depois) e termina em silêncio. Aqui cada teto é percorrido até
 * o limite e um passo além.
 */

import { describe, expect, it } from 'vitest';

import {
  ATRASO_RECARGA_MS,
  type AcaoColetor,
  type EstadoColetor,
  type EventoColetor,
  LIMITES,
  MOTIVO_BACKEND,
  MOTIVO_FECHOU,
  MOTIVO_PORTAL,
  TAMANHO_MINIMO_HTML,
  coletaVale,
  decidirColeta,
  estadoInicialColetor,
  navegacaoPermitida,
} from './coletor-regras';

/** Consulta real do RJ (a chave aqui é fictícia), já promovida a https. */
const CONSULTA =
  'https://consultadfe.fazenda.rj.gov.br/consultaDFe/paginas/consultaNFCe.faces?p=33260112345678000199650010000000011000000017|2|1|1|ABC';

const HTML = 'x'.repeat(TAMANHO_MINIMO_HTML);

/** Aplica os eventos em sequência e devolve o estado final e as ações geradas. */
function percorrer(
  eventos: readonly EventoColetor[],
  inicial: EstadoColetor = estadoInicialColetor(),
): { estado: EstadoColetor; acoes: AcaoColetor[] } {
  let estado = inicial;
  const acoes: AcaoColetor[] = [];
  for (const evento of eventos) {
    const decisao = decidirColeta(estado, evento, CONSULTA);
    estado = decisao.estado;
    acoes.push(decisao.acao);
  }
  return { estado, acoes };
}

/** Uma recusa do portal seguida da página nova carregando — um ciclo completo. */
const CICLO_RECUSA: readonly EventoColetor[] = [
  { tipo: 'resposta', resultado: 'erro_portal' },
  { tipo: 'carregou' },
];

const recusas = (n: number): EventoColetor[] =>
  Array.from({ length: n }, () => CICLO_RECUSA).flat();

describe('recusa do reCAPTCHA (erro_portal) — a recuperação que nunca rodou no device', () => {
  it('recarrega a CONSULTA ORIGINAL, não a página recusada', () => {
    const { acoes } = percorrer([{ tipo: 'resposta', resultado: 'erro_portal' }]);

    // `reload()` re-enviaria o postback que a SEFAZ acabou de recusar; só voltar
    // à consulta faz o reCAPTCHA emitir um token novo.
    expect(acoes).toEqual([
      {
        tipo: 'recarregar-consulta',
        uri: CONSULTA,
        aviso: expect.stringContaining('tentativa 1 de 4') as unknown as string,
      },
    ]);
  });

  it('insiste até o teto e só então desiste — com o cupom preservado', () => {
    const { estado, acoes } = percorrer([
      ...recusas(LIMITES.recargasPortal),
      { tipo: 'resposta', resultado: 'erro_portal' },
    ]);

    const recargas = acoes.filter((a) => a.tipo === 'recarregar-consulta');
    expect(recargas).toHaveLength(LIMITES.recargasPortal);
    expect(acoes.at(-1)).toEqual({ tipo: 'desistir', motivo: MOTIVO_PORTAL });
    expect(estado.concluido).toBe(true);
    // O motivo diz que o cupom fica guardado: desistir aqui NUNCA é marcar falha.
    expect(MOTIVO_PORTAL).toContain('fica guardado');
  });

  it('numera o aviso de 1 até o teto, sem passar dele', () => {
    const { acoes } = percorrer(recusas(LIMITES.recargasPortal));
    const avisos = acoes.flatMap((a) => (a.tipo === 'recarregar-consulta' ? [a.aviso] : []));

    expect(avisos.map((a) => a.match(/tentativa (\d+) de (\d+)/)?.slice(1, 3))).toEqual([
      ['1', '4'],
      ['2', '4'],
      ['3', '4'],
      ['4', '4'],
    ]);
  });

  it('não reenvia o HTML da página ANTIGA enquanto a recarga não chega', () => {
    const { estado } = percorrer([{ tipo: 'resposta', resultado: 'erro_portal' }]);

    // Sem este freio, o timer de 3s colheria a MESMA página de erro e contaria
    // uma segunda recusa que não aconteceu — o orçamento evaporaria em 12s.
    expect(estado.aguardandoRecarga).toBe(true);
    expect(coletaVale(estado, HTML)).toBe(false);

    const { estado: apos } = percorrer([{ tipo: 'carregou' }], estado);
    expect(coletaVale(apos, HTML)).toBe(true);
  });

  it('o tique fica quieto durante a recarga em vez de colher a página velha', () => {
    const { acoes } = percorrer([
      { tipo: 'resposta', resultado: 'erro_portal' },
      { tipo: 'tique' },
    ]);

    expect(acoes.at(-1)).toEqual({ tipo: 'nada' });
  });

  it('solta o freio se a recarga pedida nunca sinalizar carregamento', () => {
    // Sem esta saída o coletor fica MUDO para sempre: não colhe, não conta, não
    // desiste — e o usuário só vê "Aguardando a nota da SEFAZ…" até fechar na mão.
    const tiques: EventoColetor[] = Array.from({ length: LIMITES.tiquesAguardandoRecarga }, () => ({
      tipo: 'tique',
    }));
    const { estado, acoes } = percorrer([
      { tipo: 'resposta', resultado: 'erro_portal' },
      ...tiques,
    ]);

    expect(acoes.at(-1)).toEqual({ tipo: 'coletar' });
    expect(estado.aguardandoRecarga).toBe(false);
  });

  it('lê a nota quando uma das retentativas passa', () => {
    const { estado, acoes } = percorrer([
      ...recusas(2),
      { tipo: 'resposta', resultado: 'processado' },
    ]);

    expect(acoes.at(-1)).toEqual({ tipo: 'processar' });
    expect(estado.concluido).toBe(true);
  });

  it('a recusa do portal não consome o orçamento de erros do backend', () => {
    const { estado } = percorrer([
      { tipo: 'resposta', resultado: 'erro' },
      { tipo: 'resposta', resultado: 'erro' },
      { tipo: 'resposta', resultado: 'erro_portal' },
    ]);

    expect(estado.errosBackend).toBe(0);
  });
});

describe('desafio em andamento', () => {
  it('espera o humano indefinidamente, sem contar erro', () => {
    const desafios: EventoColetor[] = Array.from({ length: 50 }, () => ({
      tipo: 'resposta',
      resultado: 'desafio',
    }));
    const { estado, acoes } = percorrer(desafios);

    expect(acoes.every((a) => a.tipo === 'nada')).toBe(true);
    expect(estado.concluido).toBe(false);
  });

  it('zera erros acumulados do backend — é progresso, não falha', () => {
    const { estado } = percorrer([
      { tipo: 'resposta', resultado: 'erro' },
      { tipo: 'resposta', resultado: 'erro' },
      { tipo: 'resposta', resultado: 'desafio' },
    ]);

    expect(estado.errosBackend).toBe(0);
  });
});

describe('erro real do backend', () => {
  it('tolera até o teto e desiste no último', () => {
    const erros: EventoColetor[] = Array.from({ length: LIMITES.errosBackend - 1 }, () => ({
      tipo: 'resposta',
      resultado: 'erro',
    }));
    const { estado: antes, acoes: acoesAntes } = percorrer(erros);
    expect(acoesAntes.every((a) => a.tipo === 'nada')).toBe(true);
    expect(antes.concluido).toBe(false);

    const { estado, acoes } = percorrer([{ tipo: 'resposta', resultado: 'erro' }], antes);
    expect(acoes.at(-1)).toEqual({ tipo: 'desistir', motivo: MOTIVO_BACKEND });
    expect(estado.concluido).toBe(true);
  });
});

describe('erro de rede (onError)', () => {
  it('recarrega algumas vezes antes de culpar a rede do usuário', () => {
    const falha: EventoColetor = {
      tipo: 'erro-rede',
      url: CONSULTA,
      codigo: -6,
      descricao: 'reset',
    };
    const { acoes } = percorrer(Array.from({ length: LIMITES.errosRede - 1 }, () => falha));

    expect(acoes.every((a) => a.tipo === 'recarregar-pagina')).toBe(true);
    // O respiro entre as tentativas é do módulo, não do componente.
    expect(ATRASO_RECARGA_MS).toBeGreaterThan(0);
  });

  it('desiste no teto, dizendo o erro real do WebView', () => {
    const falha: EventoColetor = {
      tipo: 'erro-rede',
      url: CONSULTA,
      codigo: -6,
      descricao: 'net::ERR_CONNECTION_RESET',
    };
    const { estado, acoes } = percorrer(Array.from({ length: LIMITES.errosRede }, () => falha));

    const ultima = acoes.at(-1);
    expect(ultima?.tipo).toBe('desistir');
    expect(ultima?.tipo === 'desistir' && ultima.motivo).toContain('net::ERR_CONNECTION_RESET');
    expect(estado.concluido).toBe(true);
  });

  it('um redirect do portal em http não gasta o orçamento de rede', () => {
    // O JSF do RJ aponta para si mesmo em texto puro e a porta 80 está fechada:
    // isto é bug do portal, não falta de sinal do usuário.
    const emClaro = CONSULTA.replace('https://', 'http://');
    const { estado, acoes } = percorrer([
      { tipo: 'erro-rede', url: emClaro, codigo: -6, descricao: 'ERR_CONNECTION_REFUSED' },
    ]);

    expect(acoes).toEqual([{ tipo: 'ir-para', uri: CONSULTA }]);
    expect(estado.errosRede).toBe(0);
    expect(estado.upgradesHttps).toBe(1);
  });
});

describe('promoção http→https', () => {
  it('refaz a navegação em https e aborta a original', () => {
    const emClaro = CONSULTA.replace('https://', 'http://');
    const { acoes } = percorrer([{ tipo: 'navegacao', url: emClaro, isTopFrame: true }]);

    expect(acoes).toEqual([{ tipo: 'ir-para', uri: CONSULTA }]);
  });

  it('tem teto: um portal que insista em http não vira ping-pong sem fim', () => {
    const emClaro = CONSULTA.replace('https://', 'http://');
    const nav: EventoColetor = { tipo: 'navegacao', url: emClaro, isTopFrame: true };
    const { estado, acoes } = percorrer(
      Array.from({ length: LIMITES.upgradesHttps + 1 }, () => nav),
    );

    expect(acoes.filter((a) => a.tipo === 'ir-para')).toHaveLength(LIMITES.upgradesHttps);
    expect(acoes.at(-1)).toEqual({ tipo: 'permitir-navegacao' });
    expect(estado.upgradesHttps).toBe(LIMITES.upgradesHttps);
  });

  it('deixa passar sem mexer o que já está em https', () => {
    const { estado, acoes } = percorrer([{ tipo: 'navegacao', url: CONSULTA, isTopFrame: true }]);

    expect(acoes).toEqual([{ tipo: 'permitir-navegacao' }]);
    expect(estado.upgradesHttps).toBe(0);
  });
});

describe('portão de navegação (anti-phishing)', () => {
  it('deixa passar o portal público e o apoio do reCAPTCHA', () => {
    expect(navegacaoPermitida(CONSULTA, true)).toBe(true);
    expect(navegacaoPermitida('https://www.google.com/recaptcha/api2/anchor', true)).toBe(true);
    expect(navegacaoPermitida('https://www.gstatic.com/recaptcha/releases/x.js', true)).toBe(true);
    expect(navegacaoPermitida('https://recaptcha.net/recaptcha/api.js', true)).toBe(true);
    expect(navegacaoPermitida('about:blank', true)).toBe(true);
  });

  it('barra o que abriria uma janela de phishing dentro do app', () => {
    // Tela cheia, sem barra de endereço, sob o título "Confirme sua nota".
    expect(navegacaoPermitida('https://atacante.com/login', true)).toBe(false);
    expect(navegacaoPermitida('https://fazenda.rj.gov.br.atacante.com/', true)).toBe(false);
    expect(navegacaoPermitida('https://fazenda.rj.gov.br@atacante.com/', true)).toBe(false);
    expect(navegacaoPermitida('javascript:alert(1)', true)).toBe(false);
    expect(navegacaoPermitida('file:///etc/passwd', true)).toBe(false);
    expect(navegacaoPermitida('nem-url', true)).toBe(false);
    // Sem o campo preenchido, tratamos como documento principal: fecha por padrão.
    expect(navegacaoPermitida('https://atacante.com/login')).toBe(false);
  });

  it('não barra subrecurso/iframe — é assim que o desafio renderiza', () => {
    expect(navegacaoPermitida('https://qualquer-cdn.example/frame', false)).toBe(true);
  });

  it('continua avaliando navegação depois de concluído', () => {
    // O WebView ainda está montado durante a desmontagem: o portão não pode
    // abrir só porque a leitura terminou.
    const { estado } = percorrer([{ tipo: 'resposta', resultado: 'processado' }]);
    const { acoes } = percorrer(
      [{ tipo: 'navegacao', url: 'https://atacante.com/login', isTopFrame: true }],
      estado,
    );

    expect(acoes).toEqual([{ tipo: 'bloquear-navegacao' }]);
  });
});

describe('encerramento', () => {
  it('fechar desiste com o recado de que dá para tentar de novo', () => {
    const { estado, acoes } = percorrer([{ tipo: 'fechar' }]);

    expect(acoes).toEqual([{ tipo: 'desistir', motivo: MOTIVO_FECHOU }]);
    expect(estado.concluido).toBe(true);
  });

  it('depois de concluído, nenhum evento tardio dispara ação', () => {
    const { estado } = percorrer([{ tipo: 'resposta', resultado: 'processado' }]);
    const { acoes } = percorrer(
      [
        { tipo: 'tique' },
        { tipo: 'carregou' },
        { tipo: 'resposta', resultado: 'erro' },
        { tipo: 'erro-rede', url: CONSULTA, codigo: -6, descricao: 'reset' },
        { tipo: 'fechar' },
      ],
      estado,
    );

    expect(acoes.every((a) => a.tipo === 'nada')).toBe(true);
  });
});

describe('coletaVale', () => {
  it('ignora a página ainda vazia', () => {
    expect(coletaVale(estadoInicialColetor(), '<html>')).toBe(false);
    expect(coletaVale(estadoInicialColetor(), HTML)).toBe(true);
  });
});
