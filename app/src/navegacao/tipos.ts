/**
 * C5.1 — Tipos da navegação. A raiz é um stack que contém as abas + as telas
 * "de fluxo" (scan, nota, detalhe, onboarding). As abas são as 4 seções fixas;
 * o botão central de scan abre a tela `Scanner` do stack (não é uma aba).
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Handoff 3a: a aba "Produtos" deu lugar a "Lista" (checklist). Produtos não
 * sumiu — virou tela de stack, alcançada pelo atalho dentro da Lista e pelos
 * fluxos de scan/verificação. A troca é de PRIORIDADE: montar a compra é a
 * tarefa recorrente; navegar o catálogo é consulta.
 */
export type TabParamList = {
  Inicio: undefined;
  // O EAN escaneado (C7.1) chega pelo correio de scan em memória
  // (`nucleo/scan-pendente`), não por param aninhado — mais confiável.
  Verificar: undefined;
  Lista: undefined;
  Perfil: undefined;
};

export type RootStackParamList = {
  Abas: NavigatorScreenParams<TabParamList> | undefined;
  Scanner: undefined;
  /** Scan de código de barras na gôndola (C7.1); devolve o EAN à aba Verificar. */
  EscanearBarras: undefined;
  /**
   * `recemCapturado` marca a nota que acabou de ser escaneada/digitada: quando
   * ela terminar de processar, a NotaFiscal mostra a confirmação (`CupomLido`)
   * por cima. Vindo do histórico, a flag é ausente e a tela abre direto no
   * detalhe.
   */
  NotaFiscal: { cupomLocalId: string; recemCapturado?: boolean };
  /** Histórico completo de cupons escaneados ("Ver tudo" de Últimas compras). */
  Compras: undefined;
  /** Catálogo dos produtos monitorados. Saiu da tab bar no 3a (ver TabParamList). */
  Produtos: undefined;
  /** `chave` = id canônico, EAN ou descrição (chave do catálogo local, C7.5). */
  ProdutoDetalhe: { chave: string; nome?: string };
  /** Ranking dos mercados da região pela cesta escolhida (C12.1). */
  CompararMercados: undefined;
  /** Feed local de avisos (alerta disparado, conquista, resumo do mês). */
  Notificacoes: undefined;
  /** Selos de contribuição (C12.2), derivados do histórico local. */
  Conquistas: undefined;
  /** Detalhe de um selo: progresso e recompensa. `id` vem de `nucleo/gamificacao`. */
  ConquistaDetalhe: { id: string };
  /** Resumo de descontos por mês (desconto honesto do cupom). */
  Dashboard: undefined;
  /** Alternativa ao QR: os 44 dígitos da chave de acesso da NFC-e. */
  DigitarChave: undefined;
  /** Confirmação após um cupom ser lido e processado. */
  CupomLido: { cupomLocalId: string };
  /** Preferências de alerta (as mesmas das boas-vindas). */
  Alertas: undefined;
  /** Dados pessoais + sair / excluir conta. */
  ConfiguracoesConta: undefined;
  /** Região usada nas comparações (GPS ou busca manual) + raio. */
  EditarRegiao: undefined;
  /** Central de ajuda: FAQ + canais de contato. */
  Ajuda: undefined;
  /** Estado de rede ausente, com "tentar de novo". */
  SemConexao: undefined;
  /**
   * Alerta de preço + lista de compras de um produto do catálogo local. Ambas
   * as preferências são indexadas pelo id canônico — daí ele ser o parâmetro
   * que importa (e `null` significa "produto ainda não identificado na base").
   */
  EditarProduto: {
    nome: string;
    produtoCanonicoId: string | null;
    unidadeBase?: string | null;
  };
  /**
   * Lançamento manual de preço de gôndola (C11.3) — o usuário viu o preço mas não
   * tem cupom. Exige `ean` real (nunca inventado): quem navega para cá garante
   * isso, então o campo não é opcional aqui.
   */
  LancamentoManual: {
    ean: string;
    descricao?: string;
    unidadeBase?: string | null;
  };
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
