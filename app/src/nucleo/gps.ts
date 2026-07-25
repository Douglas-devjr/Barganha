/**
 * GPS opcional para DETECTAR a região (handoff 3a: "Usar minha localização").
 *
 * É o único uso de GPS do app e é TRANSITÓRIO (docs/04): pegamos a posição uma
 * vez, traduzimos para município/UF por geocodificação reversa e devolvemos isso
 * para o usuário CONFIRMAR e salvar. A posição (lat/lng) nunca é gravada nem
 * enviada — o que persiste é só a região escolhida (município/UF), idêntico ao
 * caminho manual. Isso preserva a decisão travada nº4 (geo pela loja, sem
 * rastrear a pessoa): o GPS aqui só ajuda a pessoa a se localizar, não vira dado.
 *
 * `expo-location` é módulo nativo — exige um novo dev build/EAS depois desta
 * mudança (não sobe por OTA sozinho).
 */

import * as Location from 'expo-location';

import { UFS } from './localizacao';

/**
 * Nome do estado (como a geocodificação reversa devolve em `region`) → UF. O
 * Android costuma devolver o nome por extenso; o iOS às vezes já manda a sigla.
 * Cobre as 27 unidades + algumas variações sem acento que aparecem na prática.
 */
const NOME_ESTADO_PARA_UF: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

function semAcento(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Traduz o que a geocodificação deu em `region` para uma UF válida, se der. */
function paraUf(region: string | null | undefined): string | undefined {
  if (!region) return undefined;
  const bruto = region.trim();
  // Já é uma sigla (iOS às vezes devolve "RJ").
  if (bruto.length === 2 && UFS.includes(bruto.toUpperCase())) return bruto.toUpperCase();
  return NOME_ESTADO_PARA_UF[semAcento(bruto)];
}

export type ResultadoGps =
  | { ok: true; uf: string; municipio?: string }
  /** Permissão negada — a UI oferece "abrir ajustes" ou o caminho manual. */
  | { ok: false; motivo: 'permissao' }
  /** Sem GPS/sinal, ou a geocodificação não achou uma UF conhecida. */
  | { ok: false; motivo: 'indisponivel' };

/**
 * Pede a permissão, lê a posição UMA vez e geocodifica para município/UF.
 * Não grava nada — quem salva é o editor, com a confirmação do usuário.
 */
export async function detectarRegiaoPorGps(): Promise<ResultadoGps> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      return { ok: false, motivo: 'permissao' };
    }

    const posicao = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const [lugar] = await Location.reverseGeocodeAsync({
      latitude: posicao.coords.latitude,
      longitude: posicao.coords.longitude,
    });
    if (!lugar) return { ok: false, motivo: 'indisponivel' };

    const uf = paraUf(lugar.region) ?? paraUf(lugar.subregion);
    if (!uf) return { ok: false, motivo: 'indisponivel' };

    // `city` é o município; `subregion` costuma ser a região metropolitana e é
    // um fallback razoável quando a cidade não vem.
    const municipio = (lugar.city ?? lugar.subregion ?? undefined) || undefined;

    return { ok: true, uf, ...(municipio ? { municipio } : {}) };
  } catch {
    return { ok: false, motivo: 'indisponivel' };
  }
}
