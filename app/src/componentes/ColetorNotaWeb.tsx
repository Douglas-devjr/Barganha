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
 * ESTE ARQUIVO É SÓ A ORQUESTRAÇÃO. Toda a decisão — quando insistir, quando
 * promover http→https, quando parar — mora em `nucleo/coletor-regras`, que o
 * `vitest` percorre inteira sem WebView. É a única forma de verificar a
 * recuperação automática contra a recusa do reCAPTCHA: ela roda sozinha, é
 * intermitente e termina em silêncio.
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

import { redigirTexto, urlConsultaConfiavel } from '@barganha/shared';

import {
  ATRASO_RECARGA_MS,
  type AcaoColetor,
  type EstadoColetor,
  type EventoColetor,
  INTERVALO_COLETA_MS,
  type ResultadoColeta,
  coletaVale,
  decidirColeta,
  estadoInicialColetor,
} from '@/nucleo/coletor-regras';
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

export type { ResultadoColeta };

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

// UA de Chrome mobile REAL (sem o marcador "; wv" do WebView). O reCAPTCHA v3 do
// portal do RJ penaliza User-Agent de WebView e trava no desafio (`grecaptcha-error`);
// apresentar-se como Chrome comum melhora a pontuação e a chance de render a nota.
const UA_CHROME_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
  const estadoRef = useRef<EstadoColetor>(estadoInicialColetor());
  // Envio em voo. Fica fora da máquina de propósito: é sobre a promessa pendente
  // deste componente, não sobre o que a SEFAZ respondeu.
  const enviando = useRef(false);
  const [lendoNota, setLendoNota] = useState(false);
  const [avisoPortal, setAvisoPortal] = useState<string | null>(null);
  // Página EXIBIDA no WebView. Começa na consulta do QR, mas muda sempre que
  // precisamos refazer em https uma navegação que o portal mandou em http.
  const [uri, setUri] = useState(urlSegura ?? '');

  useEffect(() => {
    setUri(urlConsultaConfiavel(url) ?? '');
  }, [url]);

  /**
   * Um passo da máquina: avança o estado e devolve a ação a executar.
   *
   * O log é a INSTRUMENTAÇÃO DA VALIDAÇÃO NO APARELHO. A recuperação contra o
   * reCAPTCHA acontece sozinha e em silêncio; sem esta linha, uma sessão real no
   * device não distingue "passou de primeira" de "recusou três vezes e a quarta
   * passou". Sai só em dev build (ver `nucleo/log`), que é onde a validação roda.
   */
  const despachar = useCallback(
    (evento: EventoColetor): AcaoColetor => {
      const { estado, acao } = decidirColeta(estadoRef.current, evento, urlSegura ?? '');
      estadoRef.current = estado;
      // O tique que só manda colher é o batimento normal de 3s — logá-lo afogaria
      // o resto. Todo o que não for isso é sinal.
      if (evento.tipo !== 'tique' || acao.tipo !== 'coletar') {
        log.info(
          {
            action: 'coletor.passo',
            evento: evento.tipo,
            acao: acao.tipo,
            recargasPortal: estado.recargasPortal,
            errosRede: estado.errosRede,
            errosBackend: estado.errosBackend,
            upgradesHttps: estado.upgradesHttps,
          },
          'Coletor decidiu o próximo passo',
        );
      }
      return acao;
    },
    [urlSegura],
  );

  const executar = useCallback(
    (acao: AcaoColetor) => {
      switch (acao.tipo) {
        case 'coletar':
          webRef.current?.injectJavaScript(COLETAR_JS);
          return;
        case 'processar':
          setLendoNota(true);
          aoProcessar();
          return;
        case 'ir-para':
          // Trocar a `uri` — em vez de `reload()` — é o que garante sair do
          // endereço errado: o `reload` repetiria a URL recusada.
          setUri(acao.uri);
          return;
        case 'recarregar-consulta':
          setAvisoPortal(acao.aviso);
          if (acao.uri) {
            webRef.current?.injectJavaScript(
              `window.location.replace(${JSON.stringify(acao.uri)});true;`,
            );
          }
          return;
        case 'recarregar-pagina':
          setTimeout(() => {
            if (!estadoRef.current.concluido) webRef.current?.reload();
          }, ATRASO_RECARGA_MS);
          return;
        case 'desistir':
          aoDesistir(acao.motivo);
          return;
        default:
          return; // 'nada' e as decisões de navegação, resolvidas no próprio handler.
      }
    },
    [aoProcessar, aoDesistir],
  );

  const passo = useCallback(
    (evento: EventoColetor) => executar(despachar(evento)),
    [despachar, executar],
  );

  // O pai passa `aoProcessar`/`aoDesistir` como arrow INLINE (ver
  // `NotaFiscalTela`), então `passo` muda de identidade a cada render dele — e
  // ele re-renderiza sozinho, num poll. Ler o `passo` atual por ref é o que
  // mantém o timer abaixo com dependência vazia: preso a `[passo]`, o intervalo
  // seria destruído e recriado antes de completar os 3s e o colhedor de
  // segurança nunca dispararia.
  const passoRef = useRef(passo);
  useEffect(() => {
    passoRef.current = passo;
  }, [passo]);

  // Timer de segurança: mesmo sem novo `onLoadEnd` (ex.: atualização via AJAX do
  // portal, ou o postback do reCAPTCHA), tenta colher o HTML periodicamente até
  // processar/desistir.
  useEffect(() => {
    if (!WebViewNativo) return;
    const t = setInterval(() => passoRef.current({ tipo: 'tique' }), INTERVALO_COLETA_MS);
    return () => clearInterval(t);
  }, []);

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

  const aoMensagem = useCallback(
    async (evento: WebViewMessageEvent) => {
      const html = evento.nativeEvent.data;
      // `enviando` some da máquina: ela é síncrona e não sabe de promessa em voo.
      if (enviando.current || !coletaVale(estadoRef.current, html)) return;

      enviando.current = true;
      try {
        const resultado = await enviarHtml(html);
        passo({ tipo: 'resposta', resultado });
      } finally {
        enviando.current = false;
      }
    },
    [enviarHtml, passo],
  );

  // Sem módulo nativo, ou payload fora dos portais públicos: o pai mostra a
  // mensagem via `aoDesistir` (efeitos acima). Nada de WebView nos dois casos.
  if (!WebViewNativo || !urlSegura) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={() => passo({ tipo: 'fechar' })}>
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
            onPress={() => passo({ tipo: 'fechar' })}
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
            // Portão ÚNICO de navegação, com dois trabalhos (ver `decidirColeta`):
            //  1. host fora dos portais públicos → recusa (`navegacaoPermitida`);
            //  2. http → refaz a MESMA navegação em https e aborta a original (o
            //     portal aponta para si mesmo em texto puro e a porta 80 está
            //     fechada).
            //
            // O host vem PRIMEIRO de propósito: o item 2 promove qualquer http a
            // https e mexe na `uri`, então deixá-lo na frente faria uma URL
            // hostil gastar orçamento de upgrade e virar estado do componente
            // antes de ser recusada na volta.
            onShouldStartLoadWithRequest={(req) => {
              const acao = despachar({
                tipo: 'navegacao',
                url: req.url,
                isTopFrame: req.isTopFrame,
              });
              if (acao.tipo === 'bloquear-navegacao') {
                log.warn(
                  { action: 'coletor.navegacao_recusada', url: redigirTexto(req.url) },
                  'WebView tentou sair para um host que não é portal público',
                );
                return false;
              }
              // `ir-para` = a original morreria em http; a promovida já foi pedida.
              if (acao.tipo === 'ir-para') {
                executar(acao);
                return false;
              }
              return true;
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
            onLoadEnd={() => passo({ tipo: 'carregou' })}
            onError={(e) => {
              const { code, description, url: falhaUrl } = e.nativeEvent;
              // A URL vai REDIGIDA: a consulta da SEFAZ carrega a chave de
              // acesso (44 díg.) no query string — dado do mundo privado que não
              // pode ir para o log (docs/04).
              log.warn(
                {
                  action: 'coletor.erro_webview',
                  code,
                  description,
                  url: redigirTexto(falhaUrl ?? ''),
                },
                'WebView falhou ao carregar a página da SEFAZ',
              );
              passo({
                tipo: 'erro-rede',
                url: falhaUrl,
                codigo: code,
                descricao: description,
              });
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
