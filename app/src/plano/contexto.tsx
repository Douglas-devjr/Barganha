/**
 * C13.1/C13.2/C13.5 — O plano da conta, disponível para o app inteiro.
 *
 * Uma única fonte de leitura (`usePlano`) para nenhuma tela reimplementar a
 * regra: quem decide o que cada plano pode é `@barganha/shared` (docs/21), e
 * este contexto só amarra a regra ao plano atual e ao SQLite local.
 *
 * NADA AQUI COBRA NADA. Duas fontes convivem (docs/21):
 *   • `GET /conta/estado` (C13.2) — a verdade, quando há sessão e rede. Vira o
 *     cache local; sem rede, o cache aguenta a folga de 7 dias e só depois
 *     degrada pra `gratis` (nunca o contrário — a folga nunca CONCEDE plano).
 *   • O interruptor de teste das Configurações da conta — continua existindo
 *     até o C13.3 trazer cobrança de verdade (Google Play). Enquanto a última
 *     escolha foi a simulação, este contexto NÃO consulta o servidor: hoje ele
 *     sempre responderia `gratis` (nada em C13.3/C13.4 escreve `assinatura`
 *     ainda) e apagaria a simulação a cada boot.
 *
 * O provedor é montado DEPOIS do boot do banco (ver App.tsx): ele lê `meta`, e
 * ler antes do `inicializarBd` daria erro. Enquanto carrega o cache local, o
 * valor é `gratis` — o app nunca mostra conteúdo pago por engano no meio do
 * caminho. A revalidação contra o servidor roda em segundo plano DEPOIS disso,
 * sem travar o boot: o plano precisa funcionar offline.
 */

import {
  PLANO_PADRAO,
  type Contagem,
  type Plano,
  type Recurso,
  aplicarTeto as aplicarTetoRegra,
  dentroDaFolgaRevalidacao,
  dentroDoGrafico as dentroDoGraficoRegra,
  dentroDoHistorico as dentroDoHistoricoRegra,
  limiteDe as limiteDeRegra,
  podeAdicionar as podeAdicionarRegra,
  podeUsar as podeUsarRegra,
} from '@barganha/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { clienteApi } from '@/api';
import { useAuth } from '@/auth';
import { meta } from '@/dados';

import { FolhaPlus } from './FolhaPlus';

export interface ContextoPlano {
  plano: Plano;
  /** Atalho de leitura para as telas: `plus` é o que libera tudo. */
  plus: boolean;
  /** `true` enquanto o plano ainda não foi lido do aparelho. */
  carregando: boolean;
  /** Troca o plano (hoje só o interruptor de teste chama isto). */
  trocarPlano: (plano: Plano) => Promise<void>;
  /** Abre a folha que explica o Barganha+ — o destino de todo cadeado. */
  mostrarPlus: () => void;
  podeUsar: (recurso: Recurso) => boolean;
  limiteDe: (contagem: Contagem) => number;
  podeAdicionar: (contagem: Contagem, jaUsados: number) => boolean;
  aplicarTeto: <T>(contagem: Contagem, itens: readonly T[]) => { visiveis: T[]; ocultos: number };
  /** O registro cabe na janela de histórico do plano? */
  dentroDoHistorico: (quandoISO?: string) => boolean;
  /** Idem para o gráfico de evolução do produto. */
  dentroDoGrafico: (quandoISO?: string) => boolean;
}

const Contexto = createContext<ContextoPlano | null>(null);

export function ProvedorPlano({ children }: { children: ReactNode }) {
  const [plano, setPlano] = useState<Plano>(PLANO_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [folhaVisivel, setFolhaVisivel] = useState(false);
  const { sessao } = useAuth();

  // Relê a cada troca de sessão: o logout apaga o `meta_sync` (nucleo/conta), e
  // sem isto o plano da conta anterior continuaria valendo em memória para quem
  // entrasse depois neste mesmo aparelho.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);

    void (async () => {
      const local = await meta.obterEstadoPlanoLocal().catch(() => null);
      if (!vivo) return;
      setPlano(local?.plano ?? PLANO_PADRAO);
      setCarregando(false);

      // Simulado: o interruptor de teste manda, sem consultar o servidor —
      // ver o comentário no topo do arquivo sobre por que isto não é revalidado.
      if (local?.origem === 'simulado') return;
      // Sem sessão não há Bearer para `GET /conta/estado`; fica no cache local.
      if (!sessao) return;

      try {
        const estado = await clienteApi.obterEstadoConta();
        if (!vivo) return;
        await meta.definirPlanoServidor(estado.plano, estado.validoAte ?? null);
        setPlano(estado.plano);
      } catch {
        // Offline/erro: o cache aguenta a folga de 7 dias sem revalidar
        // (docs/21 — o plano precisa funcionar no corredor do mercado sem
        // sinal). Só depois dela é que derruba pro grátis.
        if (!dentroDaFolgaRevalidacao(local?.revalidadoEm ?? null, new Date())) {
          await meta.degradarPlanoParaGratis();
          if (vivo) setPlano(PLANO_PADRAO);
        }
      }
    })();

    return () => {
      vivo = false;
    };
  }, [sessao]);

  const trocarPlano = useCallback(async (novo: Plano) => {
    setPlano(novo);
    await meta.definirPlanoSimulado(novo);
  }, []);

  const mostrarPlus = useCallback(() => setFolhaVisivel(true), []);

  const valor = useMemo<ContextoPlano>(
    () => ({
      plano,
      plus: plano === 'plus',
      carregando,
      trocarPlano,
      mostrarPlus,
      podeUsar: (recurso) => podeUsarRegra(plano, recurso),
      limiteDe: (contagem) => limiteDeRegra(plano, contagem),
      podeAdicionar: (contagem, jaUsados) => podeAdicionarRegra(plano, contagem, jaUsados),
      aplicarTeto: (contagem, itens) => aplicarTetoRegra(plano, contagem, itens),
      // `new Date()` na chamada, não no render: a janela do grátis é uma data
      // móvel, e congelá-la faria o corte envelhecer junto com a sessão aberta.
      dentroDoHistorico: (quandoISO) => dentroDoHistoricoRegra(quandoISO, plano, new Date()),
      dentroDoGrafico: (quandoISO) => dentroDoGraficoRegra(quandoISO, plano, new Date()),
    }),
    [plano, carregando, trocarPlano, mostrarPlus],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      <FolhaPlus visivel={folhaVisivel} aoFechar={() => setFolhaVisivel(false)} />
    </Contexto.Provider>
  );
}

export function usePlano(): ContextoPlano {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('usePlano precisa estar dentro de <ProvedorPlano>');
  return ctx;
}
