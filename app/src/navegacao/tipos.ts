/**
 * C5.1 — Tipos da navegação. A raiz é um stack que contém as abas + as telas
 * "de fluxo" (scan, nota, detalhe, onboarding). As abas são as 4 seções fixas;
 * o botão central de scan abre a tela `Scanner` do stack (não é uma aba).
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Inicio: undefined;
  // O EAN escaneado (C7.1) chega pelo correio de scan em memória
  // (`nucleo/scan-pendente`), não por param aninhado — mais confiável.
  Verificar: undefined;
  Produtos: undefined;
  Perfil: undefined;
};

export type RootStackParamList = {
  Abas: NavigatorScreenParams<TabParamList> | undefined;
  Scanner: undefined;
  /** Scan de código de barras na gôndola (C7.1); devolve o EAN à aba Verificar. */
  EscanearBarras: undefined;
  NotaFiscal: { cupomLocalId: string };
  /** `chave` = id canônico, EAN ou descrição (chave do catálogo local, C7.5). */
  ProdutoDetalhe: { chave: string; nome?: string };
};

/**
 * C4.3.1 — Stack de autenticação (login obrigatório). Só aparece quando o
 * usuário já consentiu (onboarding) mas ainda não tem sessão.
 */
export type AuthStackParamList = {
  Login: undefined;
  Cadastro: undefined;
  EsqueciSenha: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // Declaration merging do React Navigation — tipa navigation/route globalmente.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
