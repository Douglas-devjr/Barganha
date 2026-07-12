/**
 * C12.2 — Gamificação da contribuição. PURO (sem React Native/SQLite): recebe
 * as datas de captura dos cupons e devolve sequência de semanas, contadores e
 * selos. A recompensa é status + estatística pessoal (modelo dos apps de nota
 * fiscal, sem pagar cashback) — é o motor contra a partida a frio: cada cupom
 * escaneado alimenta a base coletiva anônima.
 *
 * Semana = ISO (segunda a domingo), no fuso LOCAL do aparelho. A sequência
 * conta semanas consecutivas com pelo menos 1 cupom; a semana corrente ainda
 * sem cupom NÃO quebra a sequência (está em andamento).
 */

export interface Selo {
  id: string;
  titulo: string;
  descricao: string;
  conquistado: boolean;
}

export interface Contribuicao {
  totalCupons: number;
  cuponsNaSemana: number;
  /** Semanas consecutivas com >=1 cupom (a corrente conta se já tiver cupom). */
  sequenciaSemanas: number;
  selos: Selo[];
}

/** Início (segunda 00:00 local) da semana ISO da data. */
function inicioDaSemana(data: Date): number {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const dia = d.getDay(); // 0 = domingo
  const paraSegunda = dia === 0 ? 6 : dia - 1;
  d.setDate(d.getDate() - paraSegunda);
  return d.getTime();
}

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export function calcularContribuicao(datasCaptura: string[], agora = new Date()): Contribuicao {
  const datas = datasCaptura
    .map((iso) => new Date(iso))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() <= agora.getTime());

  const semanaAtual = inicioDaSemana(agora);
  const semanasComCupom = new Set(datas.map((d) => inicioDaSemana(d)));

  const cuponsNaSemana = datas.filter((d) => inicioDaSemana(d) === semanaAtual).length;

  // Sequência: caminha para trás a partir da semana corrente (se tiver cupom)
  // ou da anterior (semana corrente em andamento não quebra a sequência).
  let cursor = semanasComCupom.has(semanaAtual) ? semanaAtual : semanaAtual - SEMANA_MS;
  let sequenciaSemanas = 0;
  while (semanasComCupom.has(cursor)) {
    sequenciaSemanas += 1;
    cursor -= SEMANA_MS;
  }

  const totalCupons = datas.length;
  const selos: Selo[] = [
    selo('primeira-nota', 'Primeira nota', 'Escaneou o primeiro cupom', totalCupons >= 1),
    selo('cacador', 'Caçador de preços', '10 cupons escaneados', totalCupons >= 10),
    selo('veterano', 'Veterano da gôndola', '50 cupons escaneados', totalCupons >= 50),
    selo('lenda', 'Lenda do mercado', '100 cupons escaneados', totalCupons >= 100),
    selo('ritmo', 'No ritmo', '4 semanas seguidas contribuindo', sequenciaSemanas >= 4),
    selo('semana-cheia', 'Semana cheia', '3 cupons na mesma semana', temSemanaCheia(datas)),
  ];

  return { totalCupons, cuponsNaSemana, sequenciaSemanas, selos };
}

function selo(id: string, titulo: string, descricao: string, conquistado: boolean): Selo {
  return { id, titulo, descricao, conquistado };
}

function temSemanaCheia(datas: Date[]): boolean {
  const porSemana = new Map<number, number>();
  for (const d of datas) {
    const chave = inicioDaSemana(d);
    const n = (porSemana.get(chave) ?? 0) + 1;
    if (n >= 3) return true;
    porSemana.set(chave, n);
  }
  return false;
}
