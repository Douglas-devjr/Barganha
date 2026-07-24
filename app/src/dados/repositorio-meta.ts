/**
 * C5.3 — Metadados locais (tabela chave/valor). Guarda o cursor do delta sync
 * (docs/05) e o consentimento LGPD do onboarding (C6.4).
 *
 * NOTA (C4.3.1): a credencial deixou de morar aqui — o Bearer agora é o JWT da
 * sessão do Supabase Auth, gerido pelo supabase-js (ver src/auth/).
 */

import { getBd } from './bd';

const CHAVE_CURSOR = 'cursor_delta';
/** Chave do consentimento LGPD. Exportada p/ a limpeza local preservá-la (nucleo/conta). */
export const CHAVE_CONSENTIMENTO = 'consentimento_em';
const CHAVE_LOCAL_UF = 'local_uf';
const CHAVE_LOCAL_MUNICIPIO = 'local_municipio';
const CHAVE_ALERTAS = 'alertas_ativos';
const CHAVE_ALERTA_OFERTAS = 'alerta_ofertas_perto';
const CHAVE_ALERTA_RESUMO = 'alerta_resumo_mensal';
const CHAVE_ALERTA_SENSIBILIDADE = 'alerta_sensibilidade';
const CHAVE_ABERTURA = 'abertura_em';
const CHAVE_RAIO = 'raio_comparacao_km';

export async function obterMeta(chave: string): Promise<string | null> {
  const linha = await getBd().getFirstAsync<{ valor: string | null }>(
    `SELECT valor FROM meta_sync WHERE chave = ?`,
    [chave],
  );
  return linha?.valor ?? null;
}

export async function definirMeta(chave: string, valor: string): Promise<void> {
  await getBd().runAsync(`INSERT OR REPLACE INTO meta_sync (chave, valor) VALUES (?, ?)`, [
    chave,
    valor,
  ]);
}

export const obterCursorDelta = (): Promise<string | null> => obterMeta(CHAVE_CURSOR);
export const definirCursorDelta = (cursor: string): Promise<void> =>
  definirMeta(CHAVE_CURSOR, cursor);

/**
 * C6.4 — Consentimento LGPD do onboarding. Guarda o instante (ISO) em que o
 * usuário concordou; ausente = onboarding ainda não concluído. É o gate que
 * decide a rota inicial (onboarding vs. abas) no boot.
 */
export const obterConsentimentoEm = (): Promise<string | null> => obterMeta(CHAVE_CONSENTIMENTO);
export const registrarConsentimento = (): Promise<void> =>
  definirMeta(CHAVE_CONSENTIMENTO, new Date().toISOString());

/**
 * Chave-mestra dos alertas de preço (linha "Alertas de preço" do Perfil).
 * Desligada, `verificarAlertas()` não dispara nada — os alvos por produto ficam
 * guardados, só param de avisar. Ausente = ligado (o padrão).
 */
export const alertasAtivos = async (): Promise<boolean> => (await obterMeta(CHAVE_ALERTAS)) !== '0';
export const definirAlertasAtivos = (ativos: boolean): Promise<void> =>
  definirMeta(CHAVE_ALERTAS, ativos ? '1' : '0');

/**
 * Preferências de alerta do handoff 3a — as MESMAS nas Boas-vindas e em
 * Perfil → Alertas de preço (o protótipo compartilha `bvAlertas`/`bvSens`).
 *
 * `quandoBaixar` é a chave-mestra já existente (`alertasAtivos`), então quem
 * desliga ali continua desligando o motor de `nucleo/alertas`. As outras duas
 * são preferências guardadas para quando os avisos correspondentes existirem —
 * `ofertasPerto` depende da camada de ofertas (C12.4) e `resumoMensal` do
 * agendamento de push (v2). Ficam gravadas agora para não perder a escolha do
 * usuário quando essas features chegarem.
 *
 * `sensibilidade` é o percentual abaixo do típico a partir do qual avisamos.
 */
export type Sensibilidade = 3 | 5 | 10;

export interface PreferenciasAlerta {
  quandoBaixar: boolean;
  ofertasPerto: boolean;
  resumoMensal: boolean;
  sensibilidade: Sensibilidade;
}

/** Padrão do handoff: baixa e ofertas ligadas, resumo mensal desligado, 5%. */
export const PREFERENCIAS_ALERTA_PADRAO: PreferenciasAlerta = {
  quandoBaixar: true,
  ofertasPerto: true,
  resumoMensal: false,
  sensibilidade: 5,
};

function comoSensibilidade(valor: string | null): Sensibilidade {
  const n = Number(valor);
  return n === 3 || n === 10 ? n : 5;
}

export async function obterPreferenciasAlerta(): Promise<PreferenciasAlerta> {
  const [baixar, ofertas, resumo, sens] = await Promise.all([
    obterMeta(CHAVE_ALERTAS),
    obterMeta(CHAVE_ALERTA_OFERTAS),
    obterMeta(CHAVE_ALERTA_RESUMO),
    obterMeta(CHAVE_ALERTA_SENSIBILIDADE),
  ]);
  return {
    // Ausente = ligado (o padrão), igual à chave-mestra.
    quandoBaixar: baixar !== '0',
    ofertasPerto: ofertas !== '0',
    // Este é o único que nasce DESLIGADO: ausente = desligado.
    resumoMensal: resumo === '1',
    sensibilidade: comoSensibilidade(sens),
  };
}

export async function definirPreferenciasAlerta(p: PreferenciasAlerta): Promise<void> {
  await definirMeta(CHAVE_ALERTAS, p.quandoBaixar ? '1' : '0');
  await definirMeta(CHAVE_ALERTA_OFERTAS, p.ofertasPerto ? '1' : '0');
  await definirMeta(CHAVE_ALERTA_RESUMO, p.resumoMensal ? '1' : '0');
  await definirMeta(CHAVE_ALERTA_SENSIBILIDADE, String(p.sensibilidade));
}

/**
 * Abertura concluída (boas-vindas + permissões). Ausente = o usuário ainda não
 * passou por esse fluxo NESTE aparelho — é o gate que App.tsx usa depois do
 * login. Fica no aparelho de propósito: permissão é do aparelho, não da conta.
 */
export const obterAberturaEm = (): Promise<string | null> => obterMeta(CHAVE_ABERTURA);
export const registrarAbertura = (): Promise<void> =>
  definirMeta(CHAVE_ABERTURA, new Date().toISOString());

/**
 * Raio (km) das comparações por loja — o segmentado 1/3/5 km de Editar região.
 * Só filtra o que já é anônimo (lojas da região); não guarda posição do usuário.
 */
export type RaioKm = 1 | 3 | 5;

export async function obterRaioKm(): Promise<RaioKm> {
  const n = Number(await obterMeta(CHAVE_RAIO));
  return n === 1 || n === 5 ? n : 3;
}

export const definirRaioKm = (km: RaioKm): Promise<void> => definirMeta(CHAVE_RAIO, String(km));

/**
 * Localização ESCOLHIDA manualmente pelo usuário (cidade/UF) — o recorte
 * geográfico das consultas/sync de preço da região. Mora só aqui, no aparelho;
 * nunca viaja junto com dado privado e serve apenas para recortar a consulta
 * anônima (decisão travada #4: geo pela loja, sem rastrear o usuário). `municipio`
 * é opcional (UF já dá o fallback). Ausente = ainda não escolheu (cai na UF
 * derivada do histórico).
 */
export interface LocalEscolhido {
  uf: string;
  municipio?: string;
}

export async function obterLocalEscolhido(): Promise<LocalEscolhido | null> {
  const [uf, municipio] = await Promise.all([
    obterMeta(CHAVE_LOCAL_UF),
    obterMeta(CHAVE_LOCAL_MUNICIPIO),
  ]);
  if (!uf) return null;
  return { uf, ...(municipio ? { municipio } : {}) };
}

export async function definirLocalEscolhido(local: LocalEscolhido): Promise<void> {
  await definirMeta(CHAVE_LOCAL_UF, local.uf);
  await definirMeta(CHAVE_LOCAL_MUNICIPIO, local.municipio?.trim() ?? '');
}
