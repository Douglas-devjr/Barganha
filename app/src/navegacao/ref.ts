/**
 * C8.4 — Referência do container de navegação, para navegar de FORA da árvore
 * React.
 *
 * Existe por um motivo só: o toque numa notificação push chega por um listener
 * NATIVO (`expo-notifications`), não por um componente. Quem recebe esse evento
 * não tem `useNavigation()` — nem pode ter, porque o evento pode chegar antes de
 * qualquer navegador existir (o toque LANÇA o app do zero).
 *
 * Anexada apenas ao container do app autenticado (`RaizNavegador` em App.tsx),
 * nunca ao de login: as rotas alvo (ex.: `ProdutoDetalhe`) só existem lá.
 */

import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './tipos';

export const navegacaoRef = createNavigationContainerRef<RootStackParamList>();
