/**
 * Bootstrap do app: garante uma conta anônima (C4.3) guardada localmente. É
 * idempotente e tolerante a estar offline — se não houver sinal, simplesmente
 * tenta de novo num próximo boot (a conta só é obrigatória para ingestão, C6).
 */

import { clienteApi } from '@/api';
import { meta } from '@/dados';

export async function garantirContaAnonima(): Promise<string | null> {
  const existente = await meta.obterUsuarioId();
  if (existente) return existente;

  try {
    const { usuarioId } = await clienteApi.criarContaAnonima();
    await meta.definirUsuarioId(usuarioId);
    return usuarioId;
  } catch {
    // Offline ou servidor fora — sem conta por enquanto; tentamos no próximo boot.
    return null;
  }
}
