/**
 * C2.6 — Coletor da nota via WebView. Alguns portais da SEFAZ (ex.: RJ) só
 * entregam a nota a um NAVEGADOR real (reCAPTCHA v3 + postback JSF) e barram
 * robôs/IP de servidor. Como o backend não consegue buscar, o PRÓPRIO app abre a
 * URL do QR num WebView no aparelho do usuário: aí o reCAPTCHA passa e a nota
 * renderiza. Colhemos o HTML final e o entregamos ao backend, que PARSEIA
 * (decisão travada nº2: parsing nunca no app — aqui só coletamos o HTML).
 *
 * A cada carregamento (e num timer de segurança) injetamos um script que
 * devolve `document.documentElement.outerHTML`. Enviamos ao backend: se ainda for
 * a página de desafio, ele responde 422 e seguimos tentando; quando vier a nota,
 * ele processa e encerramos. Damos às tentativas um teto para não girar à toa.
 *
 * `react-native-webview` é módulo NATIVO: carregamos de forma preguiçosa e
 * tolerante para um dev build ANTIGO (ainda sem o módulo) não derrubar o app —
 * nesse caso avisamos o pai (`aoDesistir`) para pedir um novo build.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';

import { cores, espaco, raio } from '@/tema';

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

/** Resultado do envio do HTML ao backend, do ponto de vista do coletor. */
export type ResultadoColeta = 'processado' | 'desafio' | 'erro';

export interface ColetorNotaWebProps {
  /** URL do QR da NFC-e (o payload capturado) — a página a renderizar. */
  url: string;
  /** Envia o HTML colhido ao backend e diz o que aconteceu. */
  enviarHtml: (html: string) => Promise<ResultadoColeta>;
  /** Nota lida com sucesso — o pai recarrega e desmonta o coletor. */
  aoProcessar: () => void;
  /** Esgotou as tentativas (ou erro de rede / módulo ausente) sem ler a nota. */
  aoDesistir: (motivo: string) => void;
}

// Injeta a coleta do HTML atual da página (roda no contexto do WebView).
const COLETAR_JS = `(function(){try{var h=document.documentElement?document.documentElement.outerHTML:'';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(h);}catch(e){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('');}})();true;`;

const INTERVALO_COLETA_MS = 3000;
const MAX_TENTATIVAS = 8; // ~24s de desafio antes de desistir.

export function ColetorNotaWeb({ url, enviarHtml, aoProcessar, aoDesistir }: ColetorNotaWebProps) {
  const webRef = useRef<WebViewInstancia>(null);
  const enviando = useRef(false);
  const concluido = useRef(false);
  const tentativas = useRef(0);
  const [aguardando, setAguardando] = useState(true);

  const coletar = useCallback(() => {
    if (concluido.current) return;
    webRef.current?.injectJavaScript(COLETAR_JS);
  }, []);

  // Timer de segurança: mesmo sem novo `onLoadEnd` (ex.: atualização via AJAX do
  // portal), tenta colher o HTML periodicamente até processar/desistir.
  useEffect(() => {
    if (!WebViewNativo) return;
    const t = setInterval(coletar, INTERVALO_COLETA_MS);
    return () => clearInterval(t);
  }, [coletar]);

  // Dev build antigo, sem o módulo nativo: avisa o pai uma vez em vez de quebrar.
  useEffect(() => {
    if (!WebViewNativo) {
      aoDesistir('Este recurso é novo. Gere um novo build de desenvolvimento do app para ler esta nota.');
    }
  }, [aoDesistir]);

  const encerrar = useCallback((fn: () => void) => {
    concluido.current = true;
    fn();
  }, []);

  const aoMensagem = useCallback(
    async (evento: WebViewMessageEvent) => {
      if (concluido.current || enviando.current) return;
      const html = evento.nativeEvent.data;
      if (!html || html.length < 200) return; // página ainda vazia/carregando.

      enviando.current = true;
      try {
        const resultado = await enviarHtml(html);
        if (resultado === 'processado') {
          encerrar(aoProcessar);
          return;
        }
        // 'desafio' (ainda no reCAPTCHA/JSF) ou 'erro' transitório: conta e segue.
        tentativas.current += 1;
        setAguardando(true);
        if (tentativas.current >= MAX_TENTATIVAS) {
          encerrar(() =>
            aoDesistir('Não foi possível ler a nota na SEFAZ agora. Tente de novo em instantes.'),
          );
        }
      } finally {
        enviando.current = false;
      }
    },
    [enviarHtml, aoProcessar, aoDesistir, encerrar],
  );

  if (!WebViewNativo) return null; // o pai mostra a mensagem via aoDesistir.

  return (
    <View style={estilos.raiz}>
      <View style={estilos.molduraWeb}>
        <WebViewNativo
          ref={webRef}
          source={{ uri: url }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          onLoadEnd={() => {
            setAguardando(false);
            coletar();
          }}
          onError={() =>
            encerrar(() =>
              aoDesistir('Não foi possível abrir a página da SEFAZ. Verifique a rede.'),
            )
          }
          onMessage={(e) => void aoMensagem(e)}
          style={estilos.web}
        />
      </View>
      <Texto cor="textoMudo" tamanho="sm" centralizado style={{ marginTop: espaco.sm }}>
        {aguardando ? 'Confirmando a nota na SEFAZ…' : 'Lendo os itens da nota…'}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { alignItems: 'stretch' },
  // Mostramos o WebView (baixo) para o usuário poder resolver um eventual desafio
  // visível do reCAPTCHA — no v3 costuma ser invisível e nada aparece.
  molduraWeb: {
    height: 220,
    borderRadius: raio.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.branco,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
});
