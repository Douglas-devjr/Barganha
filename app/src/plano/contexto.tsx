/**
 * C13.1/C13.5 — O plano da conta, disponível para o app inteiro.
 *
 * Uma única fonte de leitura (`usePlano`) para nenhuma tela reimplementar a
 * regra: quem decide o que cada plano pode é `@barganha/shared` (docs/21), e
 * este contexto só amarra a regra ao plano atual e ao SQLite local.
 *
 * NADA AQUI COBRA NADA. O plano é local e alternável no interruptor de teste das
 * Configurações da conta — serve para ver e testar o corte inteiro antes de
 * existir cobrança (C13.2 traz o plano do servidor; C13.3, o Google Play).
 *
 * O provedor é montado DEPOIS do boot do banco (ver App.tsx): ele lê `meta`, e
 * ler antes do `inicializarBd` daria erro. Enquanto carrega, o valor é `gratis`
 * — o app nunca mostra conteúdo pago por engano no meio do caminho.
 */

import {
  PLANO_PADRAO,
  type Contagem,
  type Plano,
  type Recurso,
  aplicarTeto as aplicarTetoRegra,
  dentroDoGrafico as dentroDoGraficoRegra,
  dentroDoHistorico as dentroDoHistoricoRegra,
  limiteDe as limiteDeRegra,
  podeAdicionar as podeAdicionarRegra,
  podeUsar as podeUsarRegra,
} from '@barganha/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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
    void meta
      .obterPlano()
      .then((p) => {
        if (vivo) setPlano(p);
      })
      .catch(() => {
        // Falhou a leitura: fica no grátis. Um erro de banco não pode conceder
        // o plano pago — nem derrubar o app.
        if (vivo) setPlano(PLANO_PADRAO);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [sessao]);

  const trocarPlano = useCallback(async (novo: Plano) => {
    setPlano(novo);
    await meta.definirPlano(novo);
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
