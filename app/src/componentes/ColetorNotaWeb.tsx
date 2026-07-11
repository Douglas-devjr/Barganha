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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';

import { espaco, raio, useTema } from '@/tema';

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
// UA de Chrome mobile REAL (sem o marcador "; wv" do WebView). O reCAPTCHA v3 do
// portal do RJ penaliza User-Agent de WebView e trava no desafio (`grecaptcha-error`);
// apresentar-se como Chrome comum melhora a pontuação e a chance de render a nota.
const UA_CHROME_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export function ColetorNotaWeb({ url, enviarHtml, aoProcessar, aoDesistir }: ColetorNotaWebProps) {
  const { c } = useTema();
  const webRef = useRef<WebViewInstancia>(null);
  const enviando = useRef(false);
  const concluido = useRef(false);
  const errosBackend = useRef(0);
  const errosRede = useRef(0);
  const recargasPortal = useRef(0);
  // Entre disparar a recarga e a página nova carregar, o timer ainda colheria a
  // MESMA página de erro e contaria recargas a mais — silencia até o onLoadEnd.
  const aguardandoRecarga = useRef(false);
  const [lendoNota, setLendoNota] = useState(false);
  const [avisoPortal, setAvisoPortal] = useState<string | null>(null);

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
          webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(url)});true;`);
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
    [enviarHtml, aoProcessar, aoDesistir, encerrar, url],
  );

  if (!WebViewNativo) return null; // o pai mostra a mensagem via aoDesistir.

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
            source={{ uri: url }}
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
              console.warn('[ColetorNotaWeb] onError', code, description, falhaUrl);
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
    // A página da SEFAZ é branca: fundo branco fixo para não "piscar" no escuro.
    backgroundColor: '#FFFFFF',
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
