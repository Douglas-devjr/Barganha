/**
 * Gera um id LOCAL do dispositivo (UUID v4). Não é uma credencial nem um id
 * canônico — o backend atribui os UUIDs oficiais. Serve só como chave de
 * correlação no SQLite local enquanto o cupom não tem id de servidor.
 */
export function gerarIdLocal(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Instante atual em ISO 8601 (UTC) — formato dos timestamps do contrato. */
export function agoraIso(): string {
  return new Date().toISOString();
}
