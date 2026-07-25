/**
 * Handoff 3a — o fluxo de ABERTURA: boas-vindas → permissão de câmera → região.
 * É o gate que roda uma vez por aparelho, entre o login e as abas (App.tsx).
 *
 * Por que aqui e não como rotas do stack raiz: são passos com ORDEM e sem
 * volta ao app — o usuário não deve conseguir escapar para as abas no meio.
 * Uma máquina de estados curta é mais honesta que um navegador que ele poderia
 * desempilhar.
 *
 * "Digitar chave manualmente" (saída de quem bloqueou a câmera) conclui a
 * abertura e o usuário chega no app, onde o botão existe dentro do scanner —
 * empurrar a tela de chave por cima do gate deixaria o fluxo sem retorno.
 */

import { useState } from 'react';

import { meta } from '@/dados';

import { BemVindoTela } from './BemVindoTela';
import { EscolherRegiaoTela } from './EscolherRegiaoTela';
import { PermissaoCameraTela } from './PermissaoCameraTela';

type Passo = 'bemvindo' | 'camera' | 'regiao';

export interface AberturaFluxoProps {
  /** Libera o app (grava `abertura_em` antes de chamar). */
  aoConcluir: () => void;
}

export function AberturaFluxo({ aoConcluir }: AberturaFluxoProps) {
  const [passo, setPasso] = useState<Passo>('bemvindo');

  async function terminar() {
    await meta.registrarAbertura();
    aoConcluir();
  }

  if (passo === 'bemvindo') {
    return <BemVindoTela aoConcluir={() => setPasso('camera')} />;
  }

  if (passo === 'camera') {
    return (
      <PermissaoCameraTela
        aoConcluir={() => setPasso('regiao')}
        aoDigitarChave={() => void terminar()}
      />
    );
  }

  return <EscolherRegiaoTela aoConcluir={() => void terminar()} />;
}
