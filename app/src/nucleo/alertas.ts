/**
 * C8.4 — Motor dos alertas de preço. Quando o app abre/foca o Início, cada
 * alerta é checado contra o CACHE regional (offline-first): o nível mais
 * específico disponível (município → UF) com base mínima. Dispara quando o
 * preço de referência da região — a MEDIANA (típico) ou o MENOR visto —
 * chegou ao alvo do usuário. Isto continua sendo o que garante o aviso
 * OFFLINE/com o app aberto; o push de verdade (app fechado) é um espelho
 * ADICIONAL no servidor (`definirAlerta`/`removerAlerta` abaixo), avaliado
 * pelo job `backend/src/jobs/alerta-preco.ts` — nunca o substituto dele.
 *
 * As regras puras (escolha do nível regional + decisão de disparo) vivem em
 * `alertas-regras.ts`, testáveis sem React Native.
 */

import type { AlertaPrecoItem } from '@barganha/shared';
import { chaveMunicipio } from '@barganha/shared';

import { clienteApi } from '@/api';
import { alertas, cache, meta } from '@/dados';

import { avaliarAlerta, escolherEstatisticaRegional, type AlertaDisparado } from './alertas-regras';
import { log } from './log';
import { resolverLocalizacao, type LocalizacaoEfetiva } from './localizacao';

export type { AlertaDisparado } from './alertas-regras';

/**
 * Chave de `escopoGeo` para UM alerta — a mesma normalizada de
 * `chaveMunicipio()` quando há município; cai para o código de UF quando o
 * histórico/escolha manual só tem a UF (sem município informado pelo portal).
 */
function escopoGeoDe(local: LocalizacaoEfetiva): string {
  if (local.municipio) {
    const chave = chaveMunicipio(local.uf, local.municipio);
    if (chave) return chave;
  }
  return local.uf.trim().toUpperCase();
}

/**
 * Sobe o conjunto COMPLETO de alertas locais para o servidor — substituição
 * TOTAL (`PUT /alertas`), então toda mutação local dispara de novo. Best-
 * effort: o alerta local (SQLite) é a fonte da verdade e nunca pode parar de
 * funcionar por causa do servidor (offline, sem sessão, backend fora — tudo
 * engolido aqui).
 *
 * Respeita a chave-mestra (`meta.alertasAtivos`): desligada, o espelho no
 * servidor é APAGADO em vez de atualizado — um alerta desligado no Perfil que
 * continuasse disparando push seria um controle de privacidade que MENTE
 * (LGPD: oposição/revogação ineficaz). Os alvos locais continuam guardados
 * (comportamento atual); só o servidor é zerado.
 *
 * Sem localização resolvida ainda (usuário nunca escolheu região nem tem
 * histórico com UF), não há `escopoGeo` para montar: fica pendente até a
 * próxima mutação local ou até `resolverLocalizacao` ter o que responder.
 */
async function sincronizarComServidor(): Promise<void> {
  try {
    if (!(await meta.alertasAtivos())) {
      await clienteApi.apagarAlertas();
      return;
    }

    const [todos, local] = await Promise.all([alertas.listar(), resolverLocalizacao()]);
    if (!local) return; // sync pendente — sem região não há escopoGeo válido

    const escopoGeo = escopoGeoDe(local);
    const itens: AlertaPrecoItem[] = todos.map((a) => ({
      produtoCanonicoId: a.produtoCanonicoId,
      nome: a.nome,
      precoAlvo: a.precoAlvo,
      escopoGeo,
    }));
    await clienteApi.sincronizarAlertas(itens);
  } catch (erro) {
    log.falha(
      'warn',
      { action: 'alertas.sincronizar' },
      erro,
      'Não deu para sincronizar os alertas com o servidor agora',
    );
  }
}

/**
 * Reflete a chave-mestra do Perfil (`AlertasTela`) no espelho do servidor:
 * desligou → apaga lá; religou → sobe o conjunto local de novo. Best-effort
 * (mesma regra de `sincronizarComServidor`, que já checa a chave-mestra —
 * esta função só existe para dar um nome claro ao ponto de chamada da UI).
 */
export async function ressincronizarPreferenciaAlertas(): Promise<void> {
  await sincronizarComServidor();
}

/**
 * Apaga TUDO do espelho do servidor (alertas + token de push) — chamada
 * ANTES de `supabase.auth.signOut()`, com a sessão ainda válida (as rotas
 * exigem `Authorization: Bearer`). Sem isto, sair da conta num aparelho
 * compartilhado não revoga o push do lado do servidor: o job continuaria
 * mandando "Preço baixou" para quem estiver com o aparelho depois — furando a
 * mesma higiene que `redefinirAppLocal` já faz do lado do SQLite.
 */
export async function encerrarAlertasNoServidor(): Promise<void> {
  try {
    await clienteApi.apagarAlertas();
  } catch (erro) {
    log.falha(
      'warn',
      { action: 'alertas.apagar_ao_sair' },
      erro,
      'Não deu para apagar os alertas do servidor ao sair',
    );
  }
}

/**
 * Cria/atualiza o alvo LOCAL (comportamento atual, sempre funciona offline) e
 * dispara — sem esperar — a sincronização best-effort com o servidor.
 */
export async function definirAlerta(
  produtoCanonicoId: string,
  nome: string,
  precoAlvo: number,
): Promise<void> {
  await alertas.definir(produtoCanonicoId, nome, precoAlvo);
  void sincronizarComServidor();
}

/** Remove o alvo LOCAL e dispara — sem esperar — a sincronização best-effort. */
export async function removerAlerta(produtoCanonicoId: string): Promise<void> {
  await alertas.remover(produtoCanonicoId);
  void sincronizarComServidor();
}

/** Checa todos os alertas contra o cache regional. Silencioso em erro (é aviso). */
export async function verificarAlertas(): Promise<AlertaDisparado[]> {
  try {
    // Chave-mestra do Perfil: desligada, nada dispara (os alvos ficam salvos).
    if (!(await meta.alertasAtivos())) return [];

    const [todos, local] = await Promise.all([alertas.listar(), resolverLocalizacao()]);
    if (todos.length === 0 || !local) return [];

    const disparados: AlertaDisparado[] = [];
    for (const alerta of todos) {
      const estatisticas = await cache.listarEstatisticasDoProduto(alerta.produtoCanonicoId);
      const regional = escolherEstatisticaRegional(estatisticas, local);
      const disparo = avaliarAlerta(alerta, regional);
      if (disparo) disparados.push(disparo);
    }
    return disparados;
  } catch {
    return []; // alerta nunca pode quebrar o Início.
  }
}
