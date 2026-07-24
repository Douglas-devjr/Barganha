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

/**
 * Ícone do selo — identificador SEMÂNTICO, não o componente. Este módulo é puro
 * (roda sem React Native, nos testes); quem desenha é a tela, que mapeia cada
 * chave para o SVG correspondente.
 */
export type IconeSelo = 'check' | 'recibo' | 'trofeu' | 'coroa' | 'chama' | 'calendario';

export interface Selo {
  id: string;
  titulo: string;
  descricao: string;
  conquistado: boolean;
  /** Cada conquista tem seu próprio ícone (handoff 3a, screenshot 06). */
  icone: IconeSelo;
  /** Progresso rumo ao selo (para a barra do detalhe). `alvo` é o que falta bater. */
  progresso: { atual: number; alvo: number };
  /** O que o selo dá — status, não dinheiro (docs/12). Texto para o detalhe. */
  recompensa: string;
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
  const maiorNaSemana = maxCuponsNumaSemana(datas);

  const selos: Selo[] = [
    selo({
      id: 'primeira-nota',
      titulo: 'Primeira nota',
      descricao: 'Escaneou o primeiro cupom',
      progresso: { atual: totalCupons, alvo: 1 },
      recompensa: 'Sua jornada de economia começa aqui.',
      icone: 'check',
    }),
    selo({
      id: 'cacador',
      titulo: 'Caçador de preços',
      descricao: '10 cupons escaneados',
      progresso: { atual: totalCupons, alvo: 10 },
      recompensa: 'Selo de Caçador no seu perfil de contribuição.',
      icone: 'recibo',
    }),
    selo({
      id: 'veterano',
      titulo: 'Veterano da gôndola',
      descricao: '50 cupons escaneados',
      progresso: { atual: totalCupons, alvo: 50 },
      recompensa: 'Selo de Veterano e nível na base colaborativa.',
      icone: 'trofeu',
    }),
    selo({
      id: 'lenda',
      titulo: 'Lenda do mercado',
      descricao: '100 cupons escaneados',
      progresso: { atual: totalCupons, alvo: 100 },
      recompensa: 'O topo: selo de Lenda do mercado.',
      icone: 'coroa',
    }),
    selo({
      id: 'ritmo',
      titulo: 'No ritmo',
      descricao: '4 semanas seguidas contribuindo',
      progresso: { atual: sequenciaSemanas, alvo: 4 },
      recompensa: 'Selo de constância — quem mantém a base viva.',
      icone: 'chama',
    }),
    selo({
      id: 'semana-cheia',
      titulo: 'Semana cheia',
      descricao: '3 cupons na mesma semana',
      progresso: { atual: maiorNaSemana, alvo: 3 },
      recompensa: 'Selo de Semana cheia.',
      icone: 'calendario',
    }),
  ];

  return { totalCupons, cuponsNaSemana, sequenciaSemanas, selos };
}

function selo(base: Omit<Selo, 'conquistado'>): Selo {
  return { ...base, conquistado: base.progresso.atual >= base.progresso.alvo };
}

/** Maior número de cupons já feito numa única semana (progresso de "semana cheia"). */
function maxCuponsNumaSemana(datas: Date[]): number {
  const porSemana = new Map<number, number>();
  let maior = 0;
  for (const d of datas) {
    const chave = inicioDaSemana(d);
    const n = (porSemana.get(chave) ?? 0) + 1;
    porSemana.set(chave, n);
    if (n > maior) maior = n;
  }
  return maior;
}
