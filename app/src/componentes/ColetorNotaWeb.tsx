/**
 * C2.6 — Coletor da nota via WebView, EM TELA CHEIA e INTERATIVO. Alguns portais
 * da SEFAZ (ex.: RJ) só entregam a nota a um NAVEGADOR real (reCAPTCHA v3 +
 * postback JSF) e barram robôs/IP de servidor — e um WebView "escondido" ainda é
 * pontuado como bot (trava em `grecaptcha-error`). Por isso mostramos a página em
 * tela cheia e deixamos o PRÓPRIO usuário interagir (tocar "Consultar", resolver
 * um eventual desafio visível): é o caminho confiável contra reCAPTCHA. Assim que
 * a nota renderiza, colhemos o HTML e o entregamos ao backend, que PARSEIA
 * (decisão travada nº2: parsing nunca no app — aqui só coletamos o HTML).
 *
 * A cada carregamento (e num timer de segurança) injetamos um script que devolve
 * `document.documentElement.outerHTML`. Enviamos ao backend: se ainda for a
 * página de desafio, ele responde 422 e SEGUIMOS aguardando o usuário (não
 * desistimos); quando vier a nota, ele processa e encerramos.
 *
 * `react-native-webview` é módulo NATIVO: carregamos de forma preguiçosa e
 * tolerante para um dev build ANTIGO (ainda sem o módulo) não derrubar o app —
 * nesse caso avisamos o pai (`aoDesistir`) para pedir um novo build.
 *
 * SEGURANÇA: a `url` vem do QR, que é ENTRADA NÃO CONFIÁVEL (qualquer pessoa
 * imprime um QR e cola na gôndola). Só carregamos portal público, e só ele pode
 * navegar — ver `urlConsultaConfiavel` e `navegacaoPermitida`. Sem isso, este
 * componente é uma janela de phishing: tela cheia, sem barra de endereço e com o
 * título "Confirme sua nota" acima do site do atacante.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';

import { redigirTexto, urlConsultaConfiavel, urlConsultaSegura } from '@barganha/shared';

import { log } from '@/nucleo/log';
import { claro as paletaClara, espaco, raio, useTema } from '@/tema';

import { Texto } from './Texto';

type ModuloWebView = typeof import('react-native-webview');
type WebViewClasse = ModuloWebView['WebView'];
type WebViewInstancia = InstanceType<WebViewClasse>;

/** Carrega o WebView só se o módulo nativo existir no binário (build atualizado). */
function carregarWebView(): WebViewClasse | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native-webview') as ModuloWebView).WebView;
  } catch {
    return null;
  }
}

const WebViewNativo = carregarWebView();

/**
 * Resultado do envio do HTML ao backend, do ponto de vista do coletor.
 * `erro_portal` = a SEFAZ recusou a verificação (reCAPTCHA com pontuação baixa)
 * e caiu na página de erro — beco sem saída: esperar não resolve, mas recarregar
 * a consulta (token novo) costuma passar. O coletor recarrega sozinho.
 */
export type ResultadoColeta = 'processado' | 'desafio' | 'erro' | 'erro_portal';

export interface ColetorNotaWebProps {
  /** URL do QR da NFC-e (o payload capturado) — a página a renderizar. */
  url: string;
  /** Envia o HTML colhido ao backend e diz o que aconteceu. */
  enviarHtml: (html: string) => Promise<ResultadoColeta>;
  /** Nota lida com sucesso — o pai recarrega e desmonta o coletor. */
  aoProcessar: () => void;
  /** Usuário fechou, módulo ausente, ou erros seguidos do backend sem ler a nota. */
  aoDesistir: (motivo: string) => void;
}

// Injeta a coleta do HTML atual da página (roda no contexto do WebView).
const COLETAR_JS = `(function(){try{var h=document.documentElement?document.documentElement.outerHTML:'';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(h);}catch(e){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('');}})();true;`;

const INTERVALO_COLETA_MS = 3000;
// Só erros REAIS do backend (não o "desafio", que é normal enquanto o usuário
// resolve). Enquanto for desafio, NÃO desistimos — o humano está no comando.
const MAX_ERROS_BACKEND = 8;
// Erros de CARREGAMENTO (onError) costumam ser transitórios no portal da SEFAZ —
// tipicamente `net::ERR_CONNECTION_RESET`. Recarregamos algumas vezes antes de
// desistir em vez de estourar no primeiro tropeço de rede.
const MAX_ERROS_REDE = 4;
const ATRASO_RECARGA_MS = 1500;
// Recusas do reCAPTCHA (`erro_portal`) são intermitentes: o MESMO aparelho passa
// minutos depois. Cada recarga da consulta gera um token novo — vale re-tentar
// algumas vezes antes de devolver o cupom (que segue pendente, nunca `falha`).
const MAX_RECARGAS_PORTAL = 4;
// O portal do RJ está atrás de TLS mas gera URL ABSOLUTA em `http://` nos seus
// próprios redirects (JSF sem enxergar o `X-Forwarded-Proto`). Como a porta 80
// está fechada, cada uma dessas navegações morre em `ERR_CONNECTION_REFUSED`.
// Reescrevemos para https — com teto, porque se o portal insistir em devolver
// http a cada volta isto viraria um ping-pong sem fim.
const MAX_UPGRADES_HTTPS = 6;
// UA de Chrome mobile REAL (sem o marcador "; wv" do WebView). O reCAPTCHA v3 do
// portal do RJ penaliza User-Agent de WebView e trava no desafio (`grecaptcha-error`);
// apresentar-se como Chrome comum melhora a pontuação e a chance de render a nota.
const UA_CHROME_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
function navegacaoPermitida(url: string, isTopFrame?: boolean): boolean {
  if (isTopFrame === false) return true;
  if (url === 'about:blank') return true;
  if (urlConsultaConfiavel(url)) return true;
  try {
    return hostDeApoio(new URL(url).hostname.replace(/\.$/, ''));
  } catch {
    return false; // Nem URL é — não navega.
  }
}

export function ColetorNotaWeb({ url, enviarHtml, aoProcessar, aoDesistir }: ColetorNotaWebProps) {
  const { c } = useTema();
  // O QR do cupom vem com `http://` e o portal do RJ fechou a porta 80 — carregar
  // o payload cru dá `ERR_CONNECTION_REFUSED` na primeira tentativa. Ver
  // `urlConsultaSegura`. O `qrPayload` guardado segue cru.
  //
  // `null` = o payload não aponta para um portal público. O pai já filtra, mas
  // este componente NÃO confia em quem o chama: é ele que monta o WebView, e uma
  // regressão na tela não pode virar phishing dentro do app.
  const urlSegura = urlConsultaConfiavel(url);
  const webRef = useRef<WebViewInstancia>(null);
  const enviando = useRef(false);
  const concluido = useRef(false);
  const errosBackend = useRef(0);
  const errosRede = useRef(0);
  const recargasPortal = useRef(0);
  const upgradesHttps = useRef(0);
  // Entre disparar a recarga e a página nova carregar, o timer ainda colheria a
  // MESMA página de erro e contaria recargas a mais — silencia até o onLoadEnd.
  const aguardandoRecarga = useRef(false);
  const [lendoNota, setLendoNota] = useState(false);
  const [avisoPortal, setAvisoPortal] = useState<string | null>(null);
  // Página EXIBIDA no WebView. Começa na consulta do QR, mas muda sempre que
  // precisamos refazer em https uma navegação que o portal mandou em http.
  const [uri, setUri] = useState(urlSegura ?? '');

  useEffect(() => {
    setUri(urlConsultaConfiavel(url) ?? '');
  }, [url]);

  /**
   * Se `alvo` estiver em http, refaz a MESMA navegação em https e devolve
   * `true` (quem chamou deve abortar a original). Trocar a `uri` — em vez de
   * `reload()` — é o que garante sair do endereço errado: o `reload` repetiria
   * exatamente a URL que acabou de ser recusada.
   */
  const forcarHttps = useCallback((alvo: string): boolean => {
    const seguro = urlConsultaSegura(alvo);
    if (seguro === alvo) return false;
    if (upgradesHttps.current >= MAX_UPGRADES_HTTPS) return false;
    upgradesHttps.current += 1;
    aguardandoRecarga.current = true;
    setUri(seguro);
    return true;
  }, []);

  const coletar = useCallback(() => {
    if (concluido.current) return;
    webRef.current?.injectJavaScript(COLETAR_JS);
  }, []);

  // Timer de segurança: mesmo sem novo `onLoadEnd` (ex.: atualização via AJAX do
  // portal, ou o postback do reCAPTCHA), tenta colher o HTML periodicamente até
  // processar/desistir.
  useEffect(() => {
    if (!WebViewNativo) return;
    const t = setInterval(coletar, INTERVALO_COLETA_MS);
    return () => clearInterval(t);
  }, [coletar]);

  // Dev build antigo, sem o módulo nativo: avisa o pai uma vez em vez de quebrar.
  useEffect(() => {
    if (!WebViewNativo) {
      aoDesistir(
        'Este recurso é novo. Gere um novo build de desenvolvimento do app para ler esta nota.',
      );
    }
  }, [aoDesistir]);

  // Payload fora dos portais públicos: não abre nada. Pode ser um QR de outro
  // formato (offline, só a chave) ou um QR forjado — nos dois casos o caminho é
  // devolver o controle ao pai, nunca carregar o endereço.
  useEffect(() => {
    if (WebViewNativo && !urlSegura) {
      log.warn(
        { action: 'coletor.url_recusada', url: redigirTexto(url) },
        'QR não aponta para um portal público da SEFAZ — coletor não abriu',
      );
      aoDesistir('Este QR não aponta para o portal da SEFAZ. Tente escanear a nota de novo.');
    }
  }, [urlSegura, url, aoDesistir]);

  const encerrar = useCallback((fn: () => void) => {
    concluido.current = true;
    fn();
  }, []);

  const cancelar = useCallback(() => {
    encerrar(() => aoDesistir('Confirmação fechada. Você pode tentar de novo quando quiser.'));
  }, [aoDesistir, encerrar]);

  const aoMensagem = useCallback(
    async (evento: WebViewMessageEvent) => {
      if (concluido.current || enviando.current || aguardandoRecarga.current) return;
      const html = evento.nativeEvent.data;
      if (!html || html.length < 200) return; // página ainda vazia/carregando.

      enviando.current = true;
      try {
        const resultado = await enviarHtml(html);
        if (resultado === 'processado') {
          setLendoNota(true);
          encerrar(aoProcessar);
          return;
        }
        if (resultado === 'desafio') {
          // Ainda no reCAPTCHA/JSF: o usuário está resolvendo. Zera o contador de
          // erros de backend (estamos progredindo, só não é a nota ainda).
          errosBackend.current = 0;
          return;
        }
        if (resultado === 'erro_portal') {
          // A SEFAZ recusou a verificação e caiu na página de erro (beco sem
          // saída). Recarrega a CONSULTA ORIGINAL — `reload()` re-enviaria o
          // postback recusado — para o reCAPTCHA emitir um token novo.
          errosBackend.current = 0;
          recargasPortal.current += 1;
          if (recargasPortal.current > MAX_RECARGAS_PORTAL) {
            encerrar(() =>
              aoDesistir(
                'A SEFAZ está recusando a verificação neste momento. Seu cupom fica guardado — abra-o de novo mais tarde para tentar outra vez.',
              ),
            );
            return;
          }
          aguardandoRecarga.current = true;
          setAvisoPortal(
            `A SEFAZ recusou a verificação (tentativa ${recargasPortal.current} de ${MAX_RECARGAS_PORTAL}). Recarregando — toque em “Consultar” quando a página voltar.`,
          );
          // `urlSegura` só é nula quando o componente nem renderizou o WebView
          // (early return abaixo), mas o destino de um `location.replace` é o
          // último lugar onde vale confiar num valor sem olhar.
          if (urlSegura) {
            webRef.current?.injectJavaScript(
              `window.location.replace(${JSON.stringify(urlSegura)});true;`,
            );
          }
          return;
        }
        // 'erro' = falha real do backend (não 422). Tolera alguns e só então
        // desiste — pode ser um blip; o usuário pode ter carregado algo estranho.
        errosBackend.current += 1;
        if (errosBackend.current >= MAX_ERROS_BACKEND) {
          encerrar(() =>
            aoDesistir('Não foi possível ler a nota agora. Tente de novo em instantes.'),
          );
        }
      } finally {
        enviando.current = false;
      }
    },
    [enviarHtml, aoProcessar, aoDesistir, encerrar, urlSegura],
  );

  // Sem módulo nativo, ou payload fora dos portais públicos: o pai mostra a
  // mensagem via `aoDesistir` (efeitos acima). Nada de WebView nos dois casos.
  if (!WebViewNativo || !urlSegura) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={cancelar}>
      <SafeAreaView style={[estilos.raiz, { backgroundColor: c.cartao }]} edges={['top', 'bottom']}>
        <View style={estilos.topo}>
          <View style={estilos.topoTexto}>
            <Texto peso="bold" tamanho="lg" numberOfLines={1}>
              Confirme sua nota
            </Texto>
            <Texto cor="fraco" tamanho="sm">
              Toque em “Consultar” e resolva a verificação se ela aparecer.
            </Texto>
          </View>
          <Pressable
            onPress={cancelar}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            hitSlop={8}
            style={[estilos.fechar, { backgroundColor: c.linha }]}
          >
            <Texto peso="bold" cor="suave">
              Fechar
            </Texto>
          </Pressable>
        </View>

        <View style={estilos.dica}>
          <Texto tamanho="sm" cor="suave">
            {avisoPortal ??
              'Assim que a nota da SEFAZ aparecer, a gente lê os itens e fecha sozinho.'}
          </Texto>
        </View>

        <View style={[estilos.molduraWeb, { borderColor: c.borda }]}>
          <WebViewNativo
            ref={webRef}
            source={{ uri }}
            // Portão ÚNICO de navegação, com dois trabalhos, nesta ordem:
            //  1. host fora dos portais públicos → recusa (`navegacaoPermitida`);
            //  2. http → refaz a MESMA navegação em https e aborta a original (o
            //     portal aponta para si mesmo em texto puro e a porta 80 está
            //     fechada).
            //
            // O host vem PRIMEIRO de propósito: o item 2 promove qualquer http a
            // https e mexe na `uri`, então deixá-lo na frente faria uma URL
            // hostil gastar orçamento de upgrade e virar estado do componente
            // antes de ser recusada na volta. Um host permitido em http continua
            // sendo promovido — `navegacaoPermitida` avalia a forma https.
            onShouldStartLoadWithRequest={(req) => {
              if (!navegacaoPermitida(req.url, req.isTopFrame)) {
                log.warn(
                  { action: 'coletor.navegacao_recusada', url: redigirTexto(req.url) },
                  'WebView tentou sair para um host que não é portal público',
                );
                return false;
              }
              return !forcarHttps(req.url);
            }}
            // `['*']` é DELIBERADO, não desleixo: no `react-native-webview` a
            // whitelist é avaliada ANTES do `onShouldStartLoadWithRequest`, e o
            // que ela recusa vai para o navegador do sistema via `Linking.openURL`
            // (ver `WebViewShared`). Apertar aqui, então, faria o OPOSTO do que
            // parece — mandaria a URL recusada para FORA do app, levando a chave
            // de acesso na query (docs/04), e ainda pularia o item 1 acima.
            // Quem filtra é o handler; a whitelist precisa deixar tudo chegar nele.
            originWhitelist={['*']}
            userAgent={UA_CHROME_MOBILE}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            // Desafios do reCAPTCHA às vezes abrem em nova janela: mantém no mesmo
            // WebView para o usuário conseguir resolver.
            setSupportMultipleWindows={false}
            onLoadEnd={() => {
              aguardandoRecarga.current = false;
              coletar();
            }}
            onError={(e) => {
              if (concluido.current) return;
              const { code, description, url: falhaUrl } = e.nativeEvent;
              // Rede de segurança: no Android o `onShouldStartLoadWithRequest`
              // nem sempre é consultado num redirect do SERVIDOR. Se a que
              // falhou era http, refaz em https — isto não é falha de rede do
              // usuário, então não gasta o orçamento de `errosRede`.
              if (falhaUrl && forcarHttps(falhaUrl)) return;
              // A URL vai REDIGIDA: a consulta da SEFAZ carrega a chave de
              // acesso (44 díg.) no query string — dado do mundo privado que não
              // pode ir para o log (docs/04).
              log.warn(
                {
                  action: 'coletor.erro_webview',
                  code,
                  description,
                  url: redigirTexto(falhaUrl ?? ''),
                  tentativa: errosRede.current + 1,
                },
                'WebView falhou ao carregar a página da SEFAZ',
              );
              errosRede.current += 1;
              // Reset/instabilidade do portal é transitório: recarrega e tenta de
              // novo. Só desiste (com o motivo real) após esgotar as recargas.
              if (errosRede.current < MAX_ERROS_REDE) {
                setTimeout(() => {
                  if (!concluido.current) webRef.current?.reload();
                }, ATRASO_RECARGA_MS);
                return;
              }
              encerrar(() =>
                aoDesistir(
                  `Não foi possível abrir a página da SEFAZ. Verifique a rede. [${code}: ${description}]`,
                ),
              );
            }}
            onMessage={(e) => void aoMensagem(e)}
            style={estilos.web}
          />
        </View>

        <View style={estilos.rodape}>
          <ActivityIndicator color={c.teal} size="small" />
          <Texto cor="fraco" tamanho="sm" style={{ marginLeft: espaco.sm }}>
            {lendoNota ? 'Lendo os itens da nota…' : 'Aguardando a nota da SEFAZ…'}
          </Texto>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  topoTexto: { flex: 1 },
  fechar: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
  },
  dica: { paddingHorizontal: espaco.lg, paddingBottom: espaco.sm },
  molduraWeb: {
    flex: 1,
    marginHorizontal: espaco.lg,
    borderRadius: raio.md,
    overflow: 'hidden',
    borderWidth: 1,
    // A página da SEFAZ é branca: fundo claro fixo para não "piscar" no escuro.
    backgroundColor: paletaClara.cartao,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
});
