/**
 * C8.4 — Permissão de notificação PUSH (Expo) + registro do token no servidor.
 *
 * NOME DELIBERADAMENTE DIFERENTE de `nucleo/notificacoes.ts`: aquele módulo já
 * existe e é o motor do FEED local (alertas/selos/resumo mensal gravados como
 * eventos na tabela `notificacao`, redesign 3a) — um conceito adjacente mas
 * distinto deste (permissão do SISTEMA + token do Expo Push Service).
 *
 * Ao contrário de `useCameraPronta` (que PEDE A PERMISSÃO SOZINHO ao montar,
 * porque a tela literalmente não funciona sem câmera), aqui o pedido é
 * CONTEXTUAL: só faz sentido perguntar quando o usuário acabou de demonstrar
 * intenção — criando o PRIMEIRO alerta de preço (as telas chamam `solicitar()`
 * depois de `nucleo/alertas.definirAlerta` ter sucesso). Pedir sozinho ao
 * montar perguntaria toda vez que qualquer uma dessas telas abrisse, sem
 * relação com o gesto do usuário.
 *
 * `solicitar()` só dispara o prompt do sistema UMA vez por aparelho (flag
 * `notificacao_permissao_pedida` em `meta`, ver `repositorio-meta.ts`): sem
 * essa memória PERSISTENTE, apagar todos os alertas e criar um novo repetiria
 * a condição "primeiro alerta" e o prompt voltaria — um `useRef` como o de
 * `useCameraPronta` não bastaria aqui, porque ele não sobrevive à tela
 * desmontar entre uma criação de alerta e outra.
 *
 * Best-effort de ponta a ponta: offline, sem sessão, emulador sem push real
 * (`expo-device`) ou permissão negada NUNCA podem quebrar o fluxo de criar um
 * alerta local — que continua 100% funcional sem push (comportamento atual,
 * C8.4 v1).
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { clienteApi } from '@/api';
import { meta } from '@/dados';
// Import do módulo-folha, não do barril `@/navegacao`: o barril exporta o
// `RaizNavegador`, que importa as telas, que importam ESTE arquivo — ciclo.
import { navegacaoRef } from '@/navegacao/ref';

import { log } from './log';
import { decidirAberturaPorToque } from './notificacoes-push-regras';

// Handler de FOREGROUND: sem isto, uma notificação chegando com o app ABERTO
// não aparece (o padrão do expo-notifications é não mostrar nada). Nomes de
// campo confirmados na v0.32 instalada (node_modules/expo-notifications/build/
// NotificationsHandler.d.ts): `shouldShowBanner`/`shouldShowList` substituíram
// o antigo `shouldShowAlert` (removido daqui — a lib não pede mais os dois).
// Roda uma vez, no import do módulo (mesmo padrão de `api/config.ts`).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type EstadoPermissaoNotificacao =
  /** Ainda lendo a permissão atual do sistema. */
  | 'carregando'
  /** Concedida — o token de push já foi (ou está sendo) registrado. */
  | 'pronta'
  /** Negada, mas ainda dá para pedir de novo pelo app. */
  | 'sem_permissao'
  /** Negada em definitivo: só nas configurações do sistema. */
  | 'bloqueada'
  /** A checagem/pedido falhou (erro nativo inesperado). */
  | 'erro';

function estadoDe(
  resposta: Notifications.NotificationPermissionsStatus,
): EstadoPermissaoNotificacao {
  if (resposta.granted) return 'pronta';
  return resposta.canAskAgain ? 'sem_permissao' : 'bloqueada';
}

function obterProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/** Envia o token ao servidor (`POST /dispositivos/push`). Engole qualquer falha. */
async function registrarNoServidor(token: string): Promise<void> {
  const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  if (!plataforma) return; // web/outros: sem push do Expo
  try {
    await clienteApi.registrarTokenPush(token, plataforma);
  } catch (erro) {
    // Offline, sem sessão, backend fora — best-effort: o alerta local segue
    // funcionando; o token sobe na próxima vez que houver sinal.
    log.falha(
      'warn',
      { action: 'push.registrar_token' },
      erro,
      'Não deu para registrar o token de push agora',
    );
  }
}

/** Obtém o Expo push token do aparelho e tenta registrá-lo. Engole qualquer falha. */
async function obterTokenERegistrar(): Promise<void> {
  // Emulador/simulador não recebe push de verdade — `expo-notifications` já
  // avisa sozinho nesse caso; aqui só evitamos a chamada que falharia.
  if (!Device.isDevice) return;

  const projectId = obterProjectId();
  if (!projectId) return; // sem app.json.extra.eas.projectId — não deveria faltar, mas nunca crasha por isso

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registrarNoServidor(token);
  } catch (erro) {
    log.falha(
      'warn',
      { action: 'push.obter_token' },
      erro,
      'Não deu para obter o Expo push token agora',
    );
  }
}

export interface PermissaoNotificacao {
  estado: EstadoPermissaoNotificacao;
  /**
   * Pede a permissão do sistema — mas só UMA vez por aparelho (ver o
   * cabeçalho do arquivo). Se concedida, registra o token de push no
   * servidor. Best-effort: não lança, não bloqueia quem chama — "dispare e
   * siga" (a UI não deve esperar por isto).
   */
  solicitar: () => void;
}

/**
 * Remove do servidor o token de push DESTE aparelho — chamada ao sair da
 * conta, com a sessão ainda válida. Sem permissão concedida não existe token
 * a remover (nunca chamamos `requestPermissionsAsync` aqui: só lê o que já
 * foi concedido, nunca pede de novo só para poder revogar).
 */
export async function removerTokenPushAtual(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted) return;
    const projectId = obterProjectId();
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await clienteApi.removerTokenPush(token);
  } catch (erro) {
    log.falha(
      'warn',
      { action: 'push.remover_token_ao_sair' },
      erro,
      'Não deu para remover o token de push do servidor ao sair',
    );
  }
}

// ───────────── Toque na notificação → tela do produto (C8.4) ──────────────
//
// O push de alerta viaja com `data.produtoCanonicoId` (ver `jobs/alerta-preco`).
// Sem o que vem abaixo, tocar o aviso "Preço baixou" só abria o app na tela em
// que ele estava — o usuário tinha que caçar o produto na mão.
//
// Duas entradas para o MESMO evento, porque o toque pode chegar em dois estados
// bem diferentes do app:
//   • FRIO — o toque LANÇOU o app. Não havia listener montado a tempo, então o
//     evento é lido depois, por `getLastNotificationResponseAsync`.
//   • QUENTE — app aberto ou em segundo plano: o listener recebe na hora.
// A decisão (inclusive a dedupe entre as duas) é pura e vive em
// `notificacoes-push-regras.ts`, onde é testada; aqui fica só o efeito.

/**
 * Produto tocado que ainda não pôde ser aberto. No arranque frio o evento chega
 * MUITO antes de existir navegação: o app ainda vai montar o banco, os gates de
 * consentimento/login e a abertura. Fica estacionado aqui até
 * `entregarProdutoDeNotificacao` (o `onReady` do container) poder navegar.
 */
let produtoPendente: string | null = null;
/** Última resposta já tratada — a dedupe entre a leitura fria e o listener. */
let ultimaRespostaTratada: string | null = null;

function tratarResposta(resposta: Notifications.NotificationResponse | null): void {
  const decisao = decidirAberturaPorToque(
    resposta
      ? {
          identificador: resposta.notification.request.identifier,
          dados: resposta.notification.request.content.data,
        }
      : null,
    ultimaRespostaTratada,
  );
  if (!decisao) return;

  ultimaRespostaTratada = decisao.identificador;
  if (!decisao.produtoCanonicoId) return; // aviso sem produto: nada a abrir
  produtoPendente = decisao.produtoCanonicoId;
  entregarProdutoDeNotificacao();
}

/**
 * Abre o produto estacionado, se houver e se já existir navegação. Chamado
 * tanto no momento do toque quanto pelo `onReady` do container — o que vier por
 * último é quem de fato navega, sem ninguém precisar saber a ordem.
 */
export function entregarProdutoDeNotificacao(): void {
  const chave = produtoPendente;
  if (chave == null || !navegacaoRef.isReady()) return;
  produtoPendente = null;
  // `chave` do ProdutoDetalhe aceita id canônico (ver navegacao/tipos.ts).
  navegacaoRef.navigate('ProdutoDetalhe', { chave });
}

/**
 * Liga o toque na notificação à navegação. Montado no componente RAIZ (App.tsx),
 * não numa tela: o evento pode chegar com o app em qualquer gate, e uma tela que
 * desmonta levaria o listener junto.
 */
export function useToqueEmNotificacao(): void {
  useEffect(() => {
    // Best-effort como todo o resto deste módulo: um arranque sem push nenhum
    // não pode derrubar o app.
    void Notifications.getLastNotificationResponseAsync()
      .then(tratarResposta)
      .catch((erro: unknown) => {
        log.falha(
          'warn',
          { action: 'push.ultima_resposta' },
          erro,
          'Não deu para ler a notificação que abriu o app',
        );
      });

    const inscricao = Notifications.addNotificationResponseReceivedListener(tratarResposta);
    return () => inscricao.remove();
  }, []);
}

/** Estado da permissão de notificação push + o pedido contextual dela. */
export function usePermissaoNotificacao(): PermissaoNotificacao {
  const [estado, setEstado] = useState<EstadoPermissaoNotificacao>('carregando');

  // Reflete a permissão JÁ concedida (ex.: liberada pelas Configurações do
  // sistema, fora do app) e mantém o token do servidor em dia sem esperar
  // outro alerta — não é o pedido em si, só a leitura do estado atual.
  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const resposta = await Notifications.getPermissionsAsync();
        if (!ativo) return;
        setEstado(estadoDe(resposta));
        if (resposta.granted) void obterTokenERegistrar();
      } catch {
        if (ativo) setEstado('erro');
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const solicitar = useCallback(() => {
    void (async () => {
      try {
        // A memória persistente do pedido: sem ela, zerar os alertas e criar
        // um novo repetiria "primeiro alerta" e voltaria a perguntar.
        if (await meta.notificacaoPermissaoPedida()) return;
        await meta.marcarNotificacaoPermissaoPedida();

        const resposta = await Notifications.requestPermissionsAsync();
        setEstado(estadoDe(resposta));
        if (resposta.granted) await obterTokenERegistrar();
      } catch (erro) {
        setEstado('erro');
        log.falha(
          'warn',
          { action: 'push.solicitar_permissao' },
          erro,
          'Falha ao pedir a permissão de notificação',
        );
      }
    })();
  }, []);

  return { estado, solicitar };
}
