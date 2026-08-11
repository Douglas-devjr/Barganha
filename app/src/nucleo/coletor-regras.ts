/**
 * C2.6 — Regras PURAS do coletor da nota por WebView (testáveis sem React
 * Native). A orquestração (WebView, timers, Modal) fica em
 * `componentes/ColetorNotaWeb.tsx`, como em `alertas-regras.ts` / `alertas.ts`.
 *
 * POR QUE ISTO EXISTE SEPARADO: o coletor do RJ é uma máquina de RECUPERAÇÃO,
 * não um formulário. Ela decide, sem o usuário, quando insistir e quando parar
 * diante de três falhas que só aparecem no aparelho de verdade:
 *
 *  • RECUSA DO reCAPTCHA (`erro_portal`) — a SEFAZ pontua a sessão como robô e
 *    cai na página de erro. É INTERMITENTE: o mesmo aparelho passa minutos
 *    depois. Esperar não resolve (a página é um beco sem saída); recarregar a
 *    consulta emite um token novo e costuma passar.
 *  • REDIRECT EM `http://` — o portal do RJ gera URL absoluta em texto puro nos
 *    próprios redirects (JSF sem enxergar o `X-Forwarded-Proto`) e a porta 80
 *    está fechada: cada uma dessas navegações morre em `ERR_CONNECTION_REFUSED`.
 *  • RESET DE CONEXÃO — instabilidade normal do portal.
 *
 * Cada uma tem um TETO próprio, e nenhuma pode virar desistência prematura (o
 * cupom fica pendente, nunca `falha`) nem laço infinito. Essa combinação é
 * exatamente o que não se verifica olhando a tela: por isso mora aqui, onde o
 * `vitest` percorre a máquina inteira sem WebView.
 *
 * O que NÃO está aqui: parsing (decisão travada nº2 — o app só coleta HTML) e
 * qualquer log (o `log` do app depende de `__DEV__`, que não existe no vitest;
 * quem registra é o componente, a partir da ação devolvida).
 */

import { urlConsultaConfiavel, urlConsultaSegura } from '@barganha/shared';

/**
 * Resultado do envio do HTML ao backend, do ponto de vista do coletor.
 * `erro_portal` = a SEFAZ recusou a verificação (reCAPTCHA com pontuação baixa)
 * e caiu na página de erro; os demais 422 são o desafio normal em andamento.
 */
export type ResultadoColeta = 'processado' | 'desafio' | 'erro' | 'erro_portal';

/** Tetos de insistência. Exportados para o teste travar os números, não copiá-los. */
export const LIMITES = {
  /** Erros REAIS do backend (não o 422 de desafio) antes de desistir. */
  errosBackend: 8,
  /** Falhas de carregamento (`onError`) antes de desistir — reset é transitório. */
  errosRede: 4,
  /** Recargas da consulta após recusa do reCAPTCHA. */
  recargasPortal: 4,
  /** Promoções http→https, para o portal não nos prender num ping-pong. */
  upgradesHttps: 6,
  /** Tiques sem `carregou` depois de pedir recarga — solta o freio (ver `tique`). */
  tiquesAguardandoRecarga: 4,
} as const;

/** Período do timer de segurança que colhe o HTML mesmo sem novo `onLoadEnd`. */
export const INTERVALO_COLETA_MS = 3000;
/** Respiro antes de recarregar depois de um erro de rede. */
export const ATRASO_RECARGA_MS = 1500;
/** Abaixo disto a página ainda está vazia/carregando — não vale enviar. */
export const TAMANHO_MINIMO_HTML = 200;

export const MOTIVO_FECHOU = 'Confirmação fechada. Você pode tentar de novo quando quiser.';
export const MOTIVO_PORTAL =
  'A SEFAZ está recusando a verificação neste momento. Seu cupom fica guardado — abra-o de novo mais tarde para tentar outra vez.';
export const MOTIVO_BACKEND = 'Não foi possível ler a nota agora. Tente de novo em instantes.';

/** Contadores da sessão de coleta. Imutável: cada decisão devolve o próximo. */
export interface EstadoColetor {
  readonly errosBackend: number;
  readonly errosRede: number;
  readonly recargasPortal: number;
  readonly upgradesHttps: number;
  /**
   * Pedimos uma recarga e a página nova ainda não chegou. Enquanto for `true`,
   * o HTML colhido é o da página ANTIGA — enviá-lo contaria a mesma recusa duas
   * vezes e queimaria o orçamento de recargas à toa.
   */
  readonly aguardandoRecarga: boolean;
  /** Tiques decorridos desde que `aguardandoRecarga` subiu. */
  readonly tiquesAguardando: number;
  /** Nota lida ou desistência: a partir daqui só o portão de navegação responde. */
  readonly concluido: boolean;
}

export function estadoInicialColetor(): EstadoColetor {
  return {
    errosBackend: 0,
    errosRede: 0,
    recargasPortal: 0,
    upgradesHttps: 0,
    aguardandoRecarga: false,
    tiquesAguardando: 0,
    concluido: false,
  };
}

export type EventoColetor =
  /** O backend respondeu ao HTML que enviamos. */
  | { tipo: 'resposta'; resultado: ResultadoColeta }
  /** `onError` do WebView — a página não carregou. */
  | { tipo: 'erro-rede'; url?: string; codigo?: number; descricao?: string }
  /** `onShouldStartLoadWithRequest` — o WebView quer navegar para algum lugar. */
  | { tipo: 'navegacao'; url: string; isTopFrame?: boolean }
  /** `onLoadEnd` — uma página terminou de carregar. */
  | { tipo: 'carregou' }
  /** Batida do timer de segurança. */
  | { tipo: 'tique' }
  /** O usuário fechou o coletor. */
  | { tipo: 'fechar' };

export type AcaoColetor =
  | { tipo: 'nada' }
  /** Injetar a coleta do HTML atual. */
  | { tipo: 'coletar' }
  /** A nota foi lida: avisar o pai. */
  | { tipo: 'processar' }
  /** Trocar a URL exibida (promoção http→https da navegação que ia falhar). */
  | { tipo: 'ir-para'; uri: string }
  /** Voltar à consulta original para o reCAPTCHA emitir um token novo. */
  | { tipo: 'recarregar-consulta'; uri: string; aviso: string }
  /** `reload()` depois de `ATRASO_RECARGA_MS`. */
  | { tipo: 'recarregar-pagina' }
  | { tipo: 'permitir-navegacao' }
  | { tipo: 'bloquear-navegacao' }
  | { tipo: 'desistir'; motivo: string };

export interface DecisaoColetor {
  readonly estado: EstadoColetor;
  readonly acao: AcaoColetor;
}

/**
 * Hosts que NÃO são da SEFAZ mas o portal precisa alcançar para o reCAPTCHA
 * renderizar. Sem eles o desafio nunca aparece e o usuário fica preso para
 * sempre na página de verificação — a porta de segurança teria quebrado a função.
 */
const HOSTS_APOIO = ['google.com', 'gstatic.com', 'recaptcha.net'];

const hostDeApoio = (host: string): boolean =>
  HOSTS_APOIO.some((base) => host === base || host.endsWith(`.${base}`));

/**
 * Portão de navegação do WebView. O `source` inicial vem do QR — entrada de
 * quem imprimiu o papel — e a página da SEFAZ pode mandar o WebView para
 * qualquer lugar depois. Sem este filtro, um QR colado na gôndola carrega o
 * site do atacante DENTRO do app: tela cheia, sem barra de endereço, sob o
 * título "Confirme sua nota" — o cenário perfeito para pedir a senha do
 * Barganha ou imitar a tela de login do Google.
 *
 * Só o documento PRINCIPAL é barrado. Subrecurso/iframe (`isTopFrame === false`,
 * que no iOS chega aqui) é o caso do próprio desafio do reCAPTCHA; barrá-lo
 * quebraria a verificação sem fechar nada — quem engana o usuário é a página
 * que ele VÊ na barra inexistente, não um iframe interno. Quando o campo não
 * vem preenchido, tratamos como principal (fecha por padrão).
 */
export function navegacaoPermitida(url: string, isTopFrame?: boolean): boolean {
  if (isTopFrame === false) return true;
  if (url === 'about:blank') return true;
  if (urlConsultaConfiavel(url)) return true;
  try {
    return hostDeApoio(new URL(url).hostname.replace(/\.$/, ''));
  } catch {
    return false; // Nem URL é — não navega.
  }
}

/**
 * O HTML colhido merece uma ida ao backend? Fica fora de `decidirColeta` porque
 * o componente ainda soma a esta resposta o seu próprio "já tem envio em voo".
 */
export function coletaVale(estado: EstadoColetor, html: string): boolean {
  if (estado.concluido || estado.aguardandoRecarga) return false;
  return html.length >= TAMANHO_MINIMO_HTML;
}

/** Texto do aviso enquanto insistimos contra a recusa do reCAPTCHA. */
export function avisoRecusaPortal(tentativa: number): string {
  return `A SEFAZ recusou a verificação (tentativa ${tentativa} de ${LIMITES.recargasPortal}). Recarregando — toque em “Consultar” quando a página voltar.`;
}

/**
 * Se `alvo` estiver em http, refaz a MESMA navegação em https. Trocar a URL
 * exibida — em vez de `reload()` — é o que garante sair do endereço errado: o
 * `reload` repetiria exatamente a URL que acabou de ser recusada. Devolve
 * `null` quando não há o que promover ou o orçamento acabou.
 */
function promoverHttps(estado: EstadoColetor, alvo: string): DecisaoColetor | null {
  const seguro = urlConsultaSegura(alvo);
  if (seguro === alvo) return null;
  if (estado.upgradesHttps >= LIMITES.upgradesHttps) return null;
  return {
    estado: {
      ...estado,
      upgradesHttps: estado.upgradesHttps + 1,
      aguardandoRecarga: true,
      tiquesAguardando: 0,
    },
    acao: { tipo: 'ir-para', uri: seguro },
  };
}

function responder(
  estado: EstadoColetor,
  resultado: ResultadoColeta,
  urlConsulta: string,
): DecisaoColetor {
  switch (resultado) {
    case 'processado':
      return { estado: { ...estado, concluido: true }, acao: { tipo: 'processar' } };

    case 'desafio':
      // Ainda no reCAPTCHA/JSF: o usuário está resolvendo. Isto é PROGRESSO, não
      // erro — zera o orçamento de erros do backend e segue esperando o humano.
      return { estado: { ...estado, errosBackend: 0 }, acao: { tipo: 'nada' } };

    case 'erro_portal': {
      // Beco sem saída: esperar não muda nada. Volta à consulta original para o
      // reCAPTCHA emitir um token novo — `reload()` re-enviaria o postback recusado.
      const recargas = estado.recargasPortal + 1;
      const base = { ...estado, errosBackend: 0, recargasPortal: recargas };
      if (recargas > LIMITES.recargasPortal) {
        return {
          estado: { ...base, concluido: true },
          acao: { tipo: 'desistir', motivo: MOTIVO_PORTAL },
        };
      }
      return {
        estado: { ...base, aguardandoRecarga: true, tiquesAguardando: 0 },
        acao: { tipo: 'recarregar-consulta', uri: urlConsulta, aviso: avisoRecusaPortal(recargas) },
      };
    }

    case 'erro': {
      // Falha real do backend (não 422). Tolera alguns e só então desiste — pode
      // ser um blip, ou o usuário pode ter carregado algo estranho.
      const erros = estado.errosBackend + 1;
      if (erros >= LIMITES.errosBackend) {
        return {
          estado: { ...estado, errosBackend: erros, concluido: true },
          acao: { tipo: 'desistir', motivo: MOTIVO_BACKEND },
        };
      }
      return { estado: { ...estado, errosBackend: erros }, acao: { tipo: 'nada' } };
    }
  }
}

/**
 * O passo da máquina: dado o estado e o que aconteceu, o próximo estado e o que
 * o componente deve fazer. `urlConsulta` é a consulta do QR já promovida a https
 * (`urlConsultaConfiavel`) — o único destino para onde recarregamos.
 */
export function decidirColeta(
  estado: EstadoColetor,
  evento: EventoColetor,
  urlConsulta: string,
): DecisaoColetor {
  // Navegação é decidida SEMPRE, inclusive depois de concluir: o portão de
  // segurança não pode abrir só porque a leitura terminou — o WebView ainda
  // está montado durante a desmontagem e uma página hostil navegaria livre.
  if (evento.tipo === 'navegacao') {
    if (!navegacaoPermitida(evento.url, evento.isTopFrame)) {
      return { estado, acao: { tipo: 'bloquear-navegacao' } };
    }
    // Um host permitido em http continua sendo promovido: `navegacaoPermitida`
    // avalia a forma https, então chegar aqui não significa que o endereço
    // pedido funciona.
    return promoverHttps(estado, evento.url) ?? { estado, acao: { tipo: 'permitir-navegacao' } };
  }

  if (estado.concluido) return { estado, acao: { tipo: 'nada' } };

  switch (evento.tipo) {
    case 'fechar':
      return {
        estado: { ...estado, concluido: true },
        acao: { tipo: 'desistir', motivo: MOTIVO_FECHOU },
      };

    case 'carregou':
      return {
        estado: { ...estado, aguardandoRecarga: false, tiquesAguardando: 0 },
        acao: { tipo: 'coletar' },
      };

    case 'tique': {
      if (!estado.aguardandoRecarga) return { estado, acao: { tipo: 'coletar' } };
      const tiques = estado.tiquesAguardando + 1;
      if (tiques < LIMITES.tiquesAguardandoRecarga) {
        return { estado: { ...estado, tiquesAguardando: tiques }, acao: { tipo: 'nada' } };
      }
      // A recarga que pedimos nunca sinalizou `carregou`. Sem esta saída o
      // coletor fica MUDO para sempre — sem coletar, sem contar, sem desistir —
      // e o usuário só vê "Aguardando a nota da SEFAZ…" até fechar na mão.
      // Soltar o freio devolve o fluxo aos tetos, que terminam em desistência
      // explícita com o cupom preservado.
      return {
        estado: { ...estado, aguardandoRecarga: false, tiquesAguardando: 0 },
        acao: { tipo: 'coletar' },
      };
    }

    case 'erro-rede': {
      // Se a que falhou era http, refaz em https: isto não é falha de rede do
      // usuário, então não gasta o orçamento de `errosRede`. Rede de segurança
      // para o Android, onde um redirect do SERVIDOR nem sempre passa pelo
      // `onShouldStartLoadWithRequest`.
      const promovido = evento.url ? promoverHttps(estado, evento.url) : null;
      if (promovido) return promovido;

      const erros = estado.errosRede + 1;
      if (erros < LIMITES.errosRede) {
        return { estado: { ...estado, errosRede: erros }, acao: { tipo: 'recarregar-pagina' } };
      }
      return {
        estado: { ...estado, errosRede: erros, concluido: true },
        acao: {
          tipo: 'desistir',
          motivo: `Não foi possível abrir a página da SEFAZ. Verifique a rede. [${evento.codigo}: ${evento.descricao}]`,
        },
      };
    }

    case 'resposta':
      return responder(estado, evento.resultado, urlConsulta);
  }
}
