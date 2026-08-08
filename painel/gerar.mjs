/**
 * Painel do Barganha — gerador.
 *
 * Lê `mapa.mjs`, CONFERE cada evidência contra o repositório de verdade e emite
 * `painel/index.html` (autocontido, sem nenhuma dependência externa).
 *
 *   npm run painel            gera o painel
 *   npm run painel:conferir   só confere e falha se houver deriva (usado no CI)
 *
 * A conferência é o que mantém o painel honesto. Ela olha para dois lados:
 *   ← evidência que o mapa cita e o repositório não tem mais (arquivo removido,
 *     rota renomeada) → o item aparece marcado no painel;
 *   → rota ou tela que existe no código e nenhum item do mapa menciona → aparece
 *     na lista "novo no código, ausente no painel".
 *
 * Nenhuma das duas quebra a geração: o painel sempre sai, mostrando a deriva.
 * Quem quebra é o modo `--conferir`, para o CI cobrar a atualização.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as mapa from './mapa.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const SAIDA = path.join(AQUI, 'index.html');
const SO_CONFERIR = process.argv.includes('--conferir');

/* ═══════════════════════════════════════════════════════════════════════════
   Leitura do repositório
   ═══════════════════════════════════════════════════════════════════════════ */

const existe = (rel) => fs.existsSync(path.join(RAIZ, rel));

function ler(rel) {
  try {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  } catch {
    return '';
  }
}

function arquivosDe(dir, ext, acc = []) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const item of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) arquivosDe(rel, ext, acc);
    else if (item.name.endsWith(ext)) acc.push(rel);
  }
  return acc;
}

function sh(cmd, fallback = '') {
  try {
    return execSync(cmd, {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

/** Rotas realmente registradas no servidor, no formato "POST /consulta/preco". */
function rotasNoCodigo() {
  const achadas = new Set();
  for (const arq of arquivosDe('backend/src/http', '.ts')) {
    if (arq.includes('.test.')) continue;
    const src = ler(arq);
    // app.post<{...}>(\n  '/rota', ...   |   app.get('/rota', ...
    const re = /\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*['"`](\/[^'"`]*)['"`]/g;
    let m;
    while ((m = re.exec(src)) !== null) achadas.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return achadas;
}

/** Telas do app, para cruzar com o que o mapa descreve. */
function telasNoCodigo() {
  return arquivosDe('app/src/telas', '.tsx').filter((f) => !f.includes('.test.'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Conferência
   ═══════════════════════════════════════════════════════════════════════════ */

const rotasCodigo = rotasNoCodigo();
const telasCodigo = telasNoCodigo();

const deriva = {
  arquivos: [],
  rotas: [],
  rotasNovas: [],
  telasNovas: [],
  links: [],
  semDono: [],
  etapasNovas: [],
};
let evidenciasOk = 0;

/**
 * COBERTURA TOTAL. Todo arquivo de código do projeto tem de estar OU descrito
 * como função/jornada/regra, OU declarado em `infraestrutura` como encanamento.
 *
 * Sem esta checagem, "o painel tem tudo?" só se responde no chute — e foi
 * exatamente assim que módulos inteiros ficaram invisíveis: o GPS da região, o
 * casamento por EAN, a blindagem da URL do QR, os stubs do OCR.
 *
 * Ficam de fora só teste, barril (`index.ts`) e declaração de tipo (`tipos.ts`):
 * não são comportamento, são forma.
 */
function arquivosDeCodigo() {
  return [
    ...arquivosDe('app/src', '.ts'),
    ...arquivosDe('app/src', '.tsx'),
    ...arquivosDe('backend/src', '.ts'),
    ...arquivosDe('shared/src', '.ts'),
  ].filter((f) => !f.includes('.test.') && !/\/(index|tipos)\.tsx?$/.test(f));
}

{
  const descritos = new Set(
    [
      ...mapa.funcoes.flatMap((f) => f.arquivos ?? []),
      ...mapa.jornadas.flatMap((j) => j.passos.map((p) => p.arquivo)),
      ...mapa.regras.flatMap((r) => r.onde ?? []),
    ].filter(Boolean),
  );
  const prefixos = mapa.infraestrutura.flatMap((g) => g.prefixos);
  const ehInfra = (f) => prefixos.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  for (const f of arquivosDeCodigo()) {
    if (!descritos.has(f) && !ehInfra(f)) deriva.semDono.push(f);
  }
}

/**
 * Código de etapa citado no repositório (`C7.2`, `C10.0.4`) que o painel não
 * lista. Foi assim que C2.7, C9.3.3, C10.0.1–5 e C10.4 passaram batido: existiam
 * nos comentários e nos docs, mas não no catálogo.
 */
{
  const mapeados = new Set(mapa.etapas.map((e) => e.codigo));
  const vistos = new Set();
  for (const arq of [
    ...arquivosDeCodigo(),
    ...arquivosDe('supabase/migrations', '.sql'),
    ...arquivosDe('docs', '.md'),
  ]) {
    for (const m of ler(arq).matchAll(/\bC(?:1[0-2]|[0-9])(?:\.\d+){1,2}\b/g)) vistos.add(m[0]);
  }
  for (const c of [...vistos].sort()) if (!mapeados.has(c)) deriva.etapasNovas.push(c);
}

// Referência interna quebrada (uma "conversa com" apontando para função que não
// existe mais, ou uma regra/etapa inexistente) é rot do próprio mapa — e some
// silenciosamente na página, porque o chip simplesmente não é renderizado.
{
  const idsFn = new Set(mapa.funcoes.map((f) => f.id));
  const idsRegra = new Set(mapa.regras.map((r) => r.id));
  const codEtapa = new Set(mapa.etapas.map((e) => e.codigo));
  for (const f of mapa.funcoes) {
    for (const l of f.ligacoes ?? [])
      if (!idsFn.has(l)) deriva.links.push({ nome: f.nome, alvo: `ligação "${l}"` });
    for (const r of f.regras ?? [])
      if (!idsRegra.has(r)) deriva.links.push({ nome: f.nome, alvo: `regra "${r}"` });
    for (const e of f.etapas ?? [])
      if (!codEtapa.has(e)) deriva.links.push({ nome: f.nome, alvo: `etapa "${e}"` });
  }
  for (const z of mapa.trilha.zonas) {
    for (const p of z.passos)
      if (!idsFn.has(p.funcao))
        deriva.links.push({ nome: `trilha · ${p.nome}`, alvo: `função "${p.funcao}"` });
  }
  for (const j of mapa.jornadas) {
    for (const p of j.passos)
      if (!idsFn.has(p.funcao))
        deriva.links.push({ nome: `${j.titulo} · ${p.titulo}`, alvo: `função "${p.funcao}"` });
  }
}

const itensComEvidencia = [
  ...mapa.funcoes.map((f) => ({
    tipo: 'função',
    nome: f.nome,
    arquivos: f.arquivos,
    rotas: f.rotas,
  })),
  ...mapa.jornadas.flatMap((j) =>
    j.passos.map((p, i) => ({
      tipo: 'jornada',
      nome: `${j.titulo} · passo ${i + 1}`,
      arquivos: p.arquivo ? [p.arquivo] : [],
      rotas: p.rota ? [p.rota] : [],
    })),
  ),
  ...mapa.bloqueadores.map((b) => ({ tipo: 'bloqueador', nome: b.titulo, arquivos: b.arquivos })),
  ...mapa.regras.map((r) => ({ tipo: 'regra', nome: r.titulo, arquivos: r.onde })),
];

for (const item of itensComEvidencia) {
  for (const arq of item.arquivos ?? []) {
    const rel = arq.endsWith('/') ? arq.slice(0, -1) : arq;
    if (existe(rel)) evidenciasOk += 1;
    else deriva.arquivos.push({ ...item, alvo: arq });
  }
  for (const rota of item.rotas ?? []) {
    if (rotasCodigo.has(rota)) evidenciasOk += 1;
    else deriva.rotas.push({ ...item, alvo: rota });
  }
}

const rotasMapeadas = new Set(mapa.funcoes.flatMap((f) => f.rotas ?? []));
for (const rota of rotasCodigo) if (!rotasMapeadas.has(rota)) deriva.rotasNovas.push(rota);

const arquivosMapeados = new Set(mapa.funcoes.flatMap((f) => f.arquivos ?? []));
for (const tela of telasCodigo) if (!arquivosMapeados.has(tela)) deriva.telasNovas.push(tela);

const totalDeriva =
  deriva.arquivos.length +
  deriva.rotas.length +
  deriva.rotasNovas.length +
  deriva.telasNovas.length +
  deriva.links.length +
  deriva.semDono.length +
  deriva.etapasNovas.length;

/* ═══════════════════════════════════════════════════════════════════════════
   Fatos medidos (não curados — vêm do repositório a cada geração)
   ═══════════════════════════════════════════════════════════════════════════ */

const migracoes = arquivosDe('supabase/migrations', '.sql');
const tabelasBackend = new Set(
  [
    ...ler('supabase/migrations/20260627091000_dominio_tabelas.sql').matchAll(
      /create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi,
    ),
  ].map((m) => m[1]),
);
for (const mig of migracoes) {
  for (const m of ler(mig).matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi))
    tabelasBackend.add(m[1]);
}
const tabelasLocais = [...ler('app/src/dados/migracoes.ts').matchAll(/CREATE TABLE (\w+)/g)].map(
  (m) => m[1],
);
const testes = [
  ...arquivosDe('app/src', '.test.ts'),
  ...arquivosDe('app/src', '.test.tsx'),
  ...arquivosDe('backend/src', '.test.ts'),
  ...arquivosDe('shared/src', '.test.ts'),
];
const workflows = arquivosDe('.github/workflows', '.yml');

const conta = (lista) => {
  const c = { pronto: 0, parcial: 0, falta: 0, planejado: 0 };
  for (const i of lista) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
};

const fatos = {
  commit: sh('git rev-parse --short HEAD', '—'),
  commitData: sh('git log -1 --format=%cd --date=format:%d/%m/%Y', '—'),
  commitMsg: sh('git log -1 --format=%s', '—'),
  sujo: sh('git status --porcelain').length > 0,
  arquivosSujos: sh('git status --porcelain').split('\n').filter(Boolean).length,
  geradoEm: new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }),
  rotas: rotasCodigo.size,
  telas: telasCodigo.length,
  migracoes: migracoes.length,
  tabelasBackend: tabelasBackend.size,
  tabelasLocais: tabelasLocais.length,
  arquivosTeste: testes.length,
  workflows: workflows.length,
  parsers: arquivosDe('backend/src/parsers', '.ts').filter(
    (f) => !f.includes('.test.') && !/tipos|registro|cuf|chave-acesso|qr-payload/.test(f),
  ).length,
  evidenciasOk,
  etapas: conta(mapa.etapas),
  funcoes: conta(mapa.funcoes),
};

/* ═══════════════════════════════════════════════════════════════════════════
   Modo conferência (CI)
   ═══════════════════════════════════════════════════════════════════════════ */

if (SO_CONFERIR) {
  const linhas = [];
  for (const d of deriva.arquivos)
    linhas.push(`  evidência sumiu · ${d.tipo} "${d.nome}" cita ${d.alvo}`);
  for (const d of deriva.rotas)
    linhas.push(`  rota não registrada · ${d.tipo} "${d.nome}" cita ${d.alvo}`);
  for (const r of deriva.rotasNovas) linhas.push(`  rota nova sem dono no painel · ${r}`);
  for (const t of deriva.telasNovas) linhas.push(`  tela nova sem dono no painel · ${t}`);
  for (const l of deriva.links)
    linhas.push(`  referência quebrada no mapa · "${l.nome}" aponta para ${l.alvo}`);
  for (const f of deriva.semDono) linhas.push(`  arquivo de código sem dono no painel · ${f}`);
  for (const e of deriva.etapasNovas)
    linhas.push(`  etapa citada no repo e ausente do catálogo · ${e}`);
  if (linhas.length === 0) {
    console.log(`painel: em sincronia (${evidenciasOk} evidências conferidas).`);
    process.exit(0);
  }
  console.error(
    `painel: ${linhas.length} deriva(s) entre o código e painel/mapa.mjs\n${linhas.join('\n')}`,
  );
  console.error('\nAtualize painel/mapa.mjs e rode: npm run painel');
  process.exit(1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fontes — Instrument Sans, a mesma do app, embutida como data URI
   ═══════════════════════════════════════════════════════════════════════════ */

function faceFonte(peso, dir, arq) {
  const abs = path.join(RAIZ, 'node_modules/@expo-google-fonts/instrument-sans', dir, arq);
  if (!fs.existsSync(abs)) return '';
  const b64 = fs.readFileSync(abs).toString('base64');
  return `@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:${peso};font-display:swap;src:url(data:font/ttf;base64,${b64}) format('truetype')}`;
}

const fontes = [
  faceFonte(400, '400Regular', 'InstrumentSans_400Regular.ttf'),
  faceFonte(600, '600SemiBold', 'InstrumentSans_600SemiBold.ttf'),
  faceFonte(700, '700Bold', 'InstrumentSans_700Bold.ttf'),
].join('');

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers de HTML
   ═══════════════════════════════════════════════════════════════════════════ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Marca `código` e **negrito** dentro do texto curado. */
const rico = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const ROTULO = {
  pronto: 'pronto',
  parcial: 'parcial',
  falta: 'falta fazer',
  planejado: 'planejado',
};
const pill = (status) => `<span class="pill p-${status}"><i></i>${ROTULO[status] ?? status}</span>`;

/** Texto limpo para a leitura em voz alta. */
const fala = (s) =>
  String(s ?? '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const seccao = (id, num, titulo, dizer, corpo) => `
<section id="${id}" class="sec">
  <header class="sec-cab">
    <div>
      <span class="sec-num">${esc(num)}</span>
      <h2>${esc(titulo)}</h2>
    </div>
    <button class="ouvir" type="button" data-fala="${esc(fala(dizer))}" aria-label="Ouvir o resumo desta seção">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 4.5 5H2v6h2.5L8 14zM11 5.5a3.5 3.5 0 0 1 0 5M13 3.5a6 6 0 0 1 0 9"/></svg>
      ouvir
    </button>
  </header>
  ${corpo}
</section>`;

/* ═══════════════════════════════════════════════════════════════════════════
   Blocos
   ═══════════════════════════════════════════════════════════════════════════ */

const fnPorId = new Map(mapa.funcoes.map((f) => [f.id, f]));
const areaPorId = new Map(mapa.areas.map((a) => [a.id, a]));
const regraPorId = new Map(mapa.regras.map((r) => [r.id, r]));

/* ── Placar ─────────────────────────────────────────────────────────────── */

function blocoPlacar() {
  const total = mapa.etapas.length;
  const pct = Math.round((fatos.etapas.pronto / total) * 100);

  const rail = mapa.publicacao.fases
    .map(
      (f) => `
    <li class="fase f-${f.status}">
      <span class="fase-n">Fase ${f.n}</span>
      <strong>${esc(f.titulo)}</strong>
      <span class="fase-dur">${esc(f.duracao)}</span>
      ${pill(f.status)}
    </li>`,
    )
    .join('');

  const tiles = [
    { n: fatos.etapas.pronto, r: 'etapas prontas', t: 'ok', sub: `de ${total}` },
    { n: fatos.etapas.parcial, r: 'pela metade', t: 'warn', sub: 'com o que falta descrito' },
    { n: fatos.etapas.falta, r: 'não começaram', t: 'bad', sub: 'quase todas pós-lançamento' },
    {
      n: mapa.bloqueadores.filter((b) => b.gravidade === 'alta').length,
      r: 'bloqueiam publicar',
      t: 'bad',
      sub: 'resolvíveis em dias',
    },
  ]
    .map(
      (t) => `
    <div class="tile t-${t.t}">
      <span class="tile-n">${t.n}</span>
      <span class="tile-r">${esc(t.r)}</span>
      <span class="tile-s">${esc(t.sub)}</span>
    </div>`,
    )
    .join('');

  return `
  <p class="lede">${rico(mapa.publicacao.resumo)}</p>
  <div class="tiles">${tiles}</div>
  <div class="barra" role="img" aria-label="${pct}% das etapas prontas">
    <span style="width:${pct}%"></span>
    <b>${pct}% das etapas prontas</b>
  </div>
  <h3 class="sub">O caminho até a loja</h3>
  <ol class="fases">${rail}</ol>
  <p class="nota"><strong>Custo:</strong> ${rico(mapa.publicacao.custo)}</p>`;
}

/* ── Bloqueadores ───────────────────────────────────────────────────────── */

function blocoBloqueadores() {
  const cards = mapa.bloqueadores
    .map(
      (b, i) => `
    <article class="bloq g-${b.gravidade}">
      <header>
        <span class="bloq-n">${i + 1}</span>
        <h3>${esc(b.titulo)}</h3>
        <span class="chip esforco">${esc(b.esforco)}</span>
      </header>
      <p class="porque"><span class="rot">Por que trava</span>${rico(b.porque)}</p>
      <p class="fix"><span class="rot">Como resolver</span>${rico(b.resolver)}</p>
      ${(b.arquivos ?? []).length ? `<p class="onde">${b.arquivos.map((a) => `<code>${esc(a)}</code>`).join(' ')}</p>` : ''}
      ${
        b.prompt
          ? `<div class="prompt-caixa">
        <div class="prompt-rot"><span class="rot">Cole no Claude Code</span><button type="button" class="copiar" data-copiar="prompt-${esc(b.id)}">Copiar</button></div>
        <pre class="prompt" id="prompt-${esc(b.id)}">${esc(b.prompt)}</pre>
      </div>`
          : ''
      }
    </article>`,
    )
    .join('');
  return `<div class="bloqs">${cards}</div>`;
}

/* ── Trilha + funil ─────────────────────────────────────────────────────── */

function blocoTrilha() {
  const zonas = mapa.trilha.zonas
    .map((z) => {
      const passos = z.passos
        .map((p) => {
          const saidas = (p.saidas ?? [])
            .map((s) => `<li><span>${esc(s.rotulo)}</span>${esc(s.texto)}</li>`)
            .join('');
          return `
        <li class="passo${p.destaque ? ' destaque' : ''}">
          <button type="button" class="ir" data-ir="${esc(p.funcao)}">
            <strong>${esc(p.nome)}</strong>
            <span>${esc(p.sub)}</span>
          </button>
          ${p.rota ? `<code class="rota">${esc(p.rota)}</code>` : ''}
          ${saidas ? `<ul class="saidas">${saidas}</ul>` : ''}
        </li>`;
        })
        .join('');
      return `
      <div class="zona${z.fronteira ? ' fronteira' : ''}">
        <header><h4>${esc(z.nome)}</h4><span>${esc(z.nota)}</span></header>
        <ol class="passos">${passos}</ol>
      </div>`;
    })
    .join('');

  const entradas = mapa.funil.entradas
    .map((e) => `<li><strong>${esc(e.rotulo)}</strong><span>${esc(e.sub)}</span></li>`)
    .join('');

  const portas = mapa.funil.portas
    .map((p) => {
      const naoPassou = p.naoPassou
        ? `<div class="ramo"><span class="ver v-${p.naoPassou.tom}">${esc(p.naoPassou.rotulo)}</span><span class="ramo-n">${esc(p.naoPassou.nota)}</span></div>`
        : '';
      const saidas = (p.saidas ?? [])
        .map(
          (s) =>
            `<div class="ramo"><span class="ver v-${s.tom}">${esc(s.rotulo)}</span><span class="ramo-n">${esc(s.nota)}</span></div>`,
        )
        .join('');
      return `
      <li class="porta">
        <span class="porta-n">${p.n}</span>
        <div>
          <h4>${esc(p.pergunta)}</h4>
          <p>${rico(p.regra)}</p>
          <div class="ramos">${naoPassou}${saidas}</div>
        </div>
      </li>`;
    })
    .join('');

  const cortes = mapa.funil.cortes
    .map((c) => `<li><strong>${esc(c.rotulo)}</strong>${rico(c.quando)}</li>`)
    .join('');

  return `
  <h3 class="sub">${esc(mapa.trilha.titulo)}</h3>
  <p class="legenda">${rico(mapa.trilha.legenda)}</p>
  <div class="trilha">${zonas}</div>

  <h3 class="sub">${esc(mapa.funil.titulo)}</h3>
  <p class="legenda">${rico(mapa.funil.legenda)}</p>
  <div class="funil">
    <ul class="entradas">${entradas}</ul>
    <ol class="portas">${portas}</ol>
    <ul class="cortes">${cortes}</ul>
  </div>`;
}

/* ── Jornadas ───────────────────────────────────────────────────────────── */

const ONDE = {
  aparelho: {
    r: 'no celular',
    ico: 'M5 2h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7 12h2',
  },
  navegador: { r: 'navegador no celular', ico: 'M2 4h12v9H2zM2 6.5h12M4.2 5.2h.01M6 5.2h.01' },
  servidor: { r: 'no servidor', ico: 'M2.5 3h11v4h-11zM2.5 9h11v4h-11zM4.5 5h.01M4.5 11h.01' },
  sefaz: { r: 'portal da SEFAZ', ico: 'M8 2 2.5 5v1h11V5zM4 6.5v5M8 6.5v5M12 6.5v5M2.5 12.5h11' },
  banco: {
    r: 'no banco de dados',
    ico: 'M8 2c3 0 5 .9 5 2s-2 2-5 2-5-.9-5-2 2-2 5-2zM3 4v8c0 1.1 2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2 2 5 2s5-.9 5-2',
  },
};

function blocoJornadas() {
  const seletor = mapa.jornadas
    .map(
      (j, i) =>
        `<button type="button" class="jchip${i === 0 ? ' ativo' : ''}" data-jornada="${esc(j.id)}">${esc(j.titulo)}</button>`,
    )
    .join('');

  const painéis = mapa.jornadas
    .map((j, idx) => {
      const passos = j.passos
        .map((p, i) => {
          const onde = ONDE[p.onde] ?? { r: p.onde, ico: '' };
          const alvo = fnPorId.get(p.funcao);
          return `
        <li class="jpasso s-${p.status}">
          <span class="jn">${i + 1}</span>
          <div class="jcorpo">
            <div class="jtopo">
              <h4>${esc(p.titulo)}</h4>
              ${p.status !== 'pronto' ? pill(p.status) : ''}
            </div>
            <span class="jonde o-${esc(p.onde)}">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="${onde.ico}"/></svg>${esc(onde.r)}
            </span>
            <p class="joque">${rico(p.oque)}</p>
            ${p.porque ? `<p class="jporque"><span class="rot">Por que assim</span>${rico(p.porque)}</p>` : ''}
            ${p.seFalhar ? `<p class="jfalhar"><span class="rot">Se der errado</span>${rico(p.seFalhar)}</p>` : ''}
            <div class="chips">
              ${alvo ? `<button type="button" class="chip liga" data-ir="${esc(p.funcao)}">${esc(alvo.nome)}</button>` : ''}
              ${p.rota ? `<code class="rota">${esc(p.rota)}</code>` : ''}
              ${p.arquivo ? `<code class="jarq">${esc(p.arquivo)}</code>` : ''}
            </div>
          </div>
        </li>`;
        })
        .join('');

      const ramos = (j.ramos ?? [])
        .map(
          (r) => `
        <li class="jramo s-${r.status}">
          <div><h5>${esc(r.titulo)}</h5>${pill(r.status)}</div>
          <p>${rico(r.oque)}</p>
        </li>`,
        )
        .join('');

      const cont = conta(j.passos);

      return `
      <div class="jornada" id="jornada-${esc(j.id)}"${idx === 0 ? '' : ' hidden'}>
        <div class="jcab">
          <div class="jmeta">
            <div class="jponta"><span class="rot">Começa quando</span>${rico(j.comeca)}</div>
            <div class="jseta" aria-hidden="true">→</div>
            <div class="jponta"><span class="rot">Termina quando</span>${rico(j.termina)}</div>
          </div>
          <div class="jstats">
            <span class="chip esforco">${esc(j.duracao)}</span>
            <span class="chip esforco">${j.passos.length} passos</span>
            ${pill(j.status)}
            <span class="mini">${cont.pronto} pronto · ${cont.parcial} parcial · ${cont.falta} falta</span>
          </div>
        </div>
        <p class="legenda">${rico(j.resumo)}</p>
        ${j.observacao ? `<p class="jobs">${rico(j.observacao)}</p>` : ''}
        <ol class="jpassos">${passos}</ol>
        ${ramos ? `<h4 class="jramos-t">E quando não vai pelo caminho normal</h4><ul class="jramos">${ramos}</ul>` : ''}
      </div>`;
    })
    .join('');

  return `
  <div class="jchips" role="group" aria-label="Escolher a jornada">${seletor}</div>
  <div class="jornadas">${painéis}</div>`;
}

/* ── Falta fazer (consolidado) ──────────────────────────────────────────── */

function blocoFalta() {
  const naoExiste = mapa.funcoes.filter((f) => f.status === 'falta');
  const pelaMetade = mapa.funcoes.filter((f) => f.status === 'parcial');
  const etapasFalta = mapa.etapas.filter((e) => e.status === 'falta');

  const cartao = (f) => `
    <article class="falta-card s-${f.status}">
      <header>
        <h4>${esc(f.nome)}</h4>
        <span class="fn-area">${esc(areaPorId.get(f.area)?.nome ?? f.area)}</span>
      </header>
      <p class="oque">${rico(f.oque)}</p>
      ${f.falta ? `<p class="falta"><span class="rot">O que falta</span>${rico(f.falta)}</p>` : ''}
      <div class="chips">
        <button type="button" class="chip liga" data-ir="${esc(f.id)}">ver no mapa</button>
        ${(f.etapas ?? []).map((e) => `<a class="chip etapa" href="#etapa-${esc(e)}">${esc(e)}</a>`).join('')}
      </div>
    </article>`;

  const etapasSoltas = etapasFalta
    .filter(
      (e) =>
        !mapa.funcoes.some((f) => (f.etapas ?? []).includes(e.codigo) && f.status !== 'pronto'),
    )
    .map(
      (e) => `
      <li class="etapa s-falta" >
        <code class="cod">${esc(e.codigo)}</code>
        <div class="etapa-corpo">
          <h4>${esc(e.nome)} <span class="fase-tag ${e.fase === 'MVP' ? 'mvp' : 'pos'}">${esc(e.fase)}</span></h4>
          <p>${rico(e.oque)}</p>
          ${e.falta ? `<p class="falta"><span class="rot">Falta</span>${rico(e.falta)}</p>` : ''}
        </div>
      </li>`,
    )
    .join('');

  return `
  <p class="lede">Tudo que o app <strong>ainda não faz</strong>, num lugar só — separado entre o que não existe de forma nenhuma e o que existe pela metade. É a lista de onde tirar o próximo trabalho.</p>

  <h3 class="sub">Não existe (${naoExiste.length})</h3>
  <p class="legenda">Nenhuma linha de produto entregue. Escolher daqui é começar algo novo.</p>
  <div class="falta-grid">${naoExiste.map(cartao).join('')}</div>

  ${etapasSoltas ? `<h3 class="sub">Etapas inteiras sem nada feito</h3><ol class="etapas">${etapasSoltas}</ol>` : ''}

  <h3 class="sub">Existe pela metade (${pelaMetade.length})</h3>
  <p class="legenda">Funciona, mas com um pedaço faltando — quase sempre é aqui que está o trabalho mais barato com maior efeito.</p>
  <div class="falta-grid">${pelaMetade.map(cartao).join('')}</div>`;
}

/* ── Funções ────────────────────────────────────────────────────────────── */

function blocoFuncoes() {
  const filtros = mapa.areas
    .map((a) => `<button type="button" class="fchip" data-area="${a.id}">${esc(a.nome)}</button>`)
    .join('');

  const cards = mapa.funcoes
    .map((f) => {
      const area = areaPorId.get(f.area);
      const ligacoes = (f.ligacoes ?? [])
        .map((id) => {
          const alvo = fnPorId.get(id);
          return alvo
            ? `<button type="button" class="chip liga" data-ir="${esc(id)}">${esc(alvo.nome)}</button>`
            : '';
        })
        .join('');
      const regras = (f.regras ?? [])
        .map((id) => {
          const r = regraPorId.get(id);
          return r
            ? `<a class="chip regra" href="#regra-${esc(id)}">${r.travada ? '&#128274; ' : ''}${esc(r.titulo)}</a>`
            : '';
        })
        .join('');
      const rotas = (f.rotas ?? []).map((r) => `<code class="rota">${esc(r)}</code>`).join('');
      const etapasChips = (f.etapas ?? [])
        .map((e) => `<a class="chip etapa" href="#etapa-${esc(e)}">${esc(e)}</a>`)
        .join('');
      const arquivos = (f.arquivos ?? [])
        .map((a) => {
          const ok = existe(a.endsWith('/') ? a.slice(0, -1) : a);
          return `<li class="${ok ? '' : 'sumiu'}"><code>${esc(a)}</code>${ok ? '' : ' <span class="alerta">não existe mais</span>'}</li>`;
        })
        .join('');

      const buscavel = fala(
        [
          f.nome,
          f.oque,
          f.falta,
          f.detalhe,
          area?.nome,
          (f.rotas ?? []).join(' '),
          (f.etapas ?? []).join(' '),
        ].join(' '),
      ).toLowerCase();

      return `
    <article class="fn s-${f.status}" id="fn-${esc(f.id)}" data-area="${esc(f.area)}" data-status="${esc(f.status)}" data-busca="${esc(buscavel)}">
      <header>
        <h3>${esc(f.nome)}</h3>
        ${pill(f.status)}
      </header>
      <span class="fn-area">${esc(area?.nome ?? f.area)}</span>
      <p class="oque">${rico(f.oque)}</p>
      ${f.falta ? `<p class="falta"><span class="rot">Falta</span>${rico(f.falta)}</p>` : ''}
      ${f.detalhe ? `<details class="det"><summary>Por que é assim</summary><p>${rico(f.detalhe)}</p></details>` : ''}
      ${rotas ? `<div class="rotas">${rotas}</div>` : ''}
      ${ligacoes ? `<div class="chips"><span class="rot">Conversa com</span>${ligacoes}</div>` : ''}
      ${regras ? `<div class="chips"><span class="rot">Regras</span>${regras}</div>` : ''}
      ${etapasChips ? `<div class="chips"><span class="rot">Etapas</span>${etapasChips}</div>` : ''}
      ${arquivos ? `<details class="det"><summary>Onde mora no código</summary><ul class="arqs">${arquivos}</ul></details>` : ''}
    </article>`;
    })
    .join('');

  return `
  <div class="barra-ferramentas">
    <label class="busca">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
      <input type="search" id="busca" placeholder="Buscar função, rota, etapa…" aria-label="Buscar entre as funções">
    </label>
    <div class="fchips" role="group" aria-label="Filtrar por área">
      <button type="button" class="fchip ativo" data-area="todas">Todas</button>${filtros}
    </div>
    <div class="fchips" role="group" aria-label="Filtrar por status">
      <button type="button" class="fchip ativo" data-status="todos">Qualquer estado</button>
      <button type="button" class="fchip" data-status="pronto">Pronto</button>
      <button type="button" class="fchip" data-status="parcial">Pela metade</button>
      <button type="button" class="fchip" data-status="falta">Falta fazer</button>
    </div>
  </div>
  <p class="contagem" id="contagem" aria-live="polite"></p>
  <div class="fns" id="fns">${cards}</div>
  <p class="vazio" id="vazio" hidden>Nada com esse filtro.</p>`;
}

/* ── Regras ─────────────────────────────────────────────────────────────── */

function blocoRegras() {
  const card = (r) => {
    const nums = (r.numeros ?? [])
      .map((n) => `<span class="num"><b>${esc(n.valor)}</b>${esc(n.rotulo)}</span>`)
      .join('');
    return `
    <article class="regra-card${r.travada ? ' travada' : ''}" id="regra-${esc(r.id)}">
      <header>
        ${r.travada ? '<span class="lock" title="Decisão travada — não negociável">&#128274;</span>' : ''}
        <h3>${esc(r.titulo)}</h3>
      </header>
      <p class="oque">${rico(r.regra)}</p>
      ${nums ? `<div class="nums">${nums}</div>` : ''}
      <p class="porque"><span class="rot">Por que</span>${rico(r.porque)}</p>
      ${(r.onde ?? []).length ? `<p class="onde">${r.onde.map((o) => `<code>${esc(o)}</code>`).join(' ')}</p>` : ''}
    </article>`;
  };

  const travadas = mapa.regras
    .filter((r) => r.travada)
    .map(card)
    .join('');
  const demais = mapa.regras
    .filter((r) => !r.travada)
    .map(card)
    .join('');

  return `
  <h3 class="sub">Travadas — não negociáveis</h3>
  <p class="legenda">Se uma tarefa parecer exigir violar uma destas, o certo é parar e levantar a questão, não prosseguir.</p>
  <div class="regras">${travadas}</div>
  <h3 class="sub">Regras do motor</h3>
  <p class="legenda">Decorrem das travadas. Os números são conservadores e documentados — calibrar é trabalho do beta.</p>
  <div class="regras">${demais}</div>`;
}

/* ── Etapas ─────────────────────────────────────────────────────────────── */

function blocoEtapas() {
  const grupos = mapa.camadas
    .map((c) => {
      const daCamada = mapa.etapas.filter(
        (e) => e.codigo === c.id || e.codigo.startsWith(`${c.id}.`),
      );
      if (daCamada.length === 0) return '';
      const cont = conta(daCamada);
      const linhas = daCamada
        .map(
          (e) => `
        <li class="etapa s-${e.status}" id="etapa-${esc(e.codigo)}">
          <code class="cod">${esc(e.codigo)}</code>
          <div class="etapa-corpo">
            <h4>${esc(e.nome)} <span class="fase-tag ${e.fase === 'MVP' ? 'mvp' : 'pos'}">${esc(e.fase)}</span></h4>
            <p>${rico(e.oque)}</p>
            ${e.falta ? `<p class="falta"><span class="rot">Falta</span>${rico(e.falta)}</p>` : ''}
          </div>
          ${pill(e.status)}
        </li>`,
        )
        .join('');
      return `
      <div class="camada">
        <header>
          <h3><code>${esc(c.id)}</code> ${esc(c.nome)}</h3>
          <span>${esc(c.desc)}</span>
          <span class="mini">${cont.pronto} pronto · ${cont.parcial} parcial · ${cont.falta} falta</span>
        </header>
        <ol class="etapas">${linhas}</ol>
      </div>`;
    })
    .join('');
  return `<div class="camadas">${grupos}</div>`;
}

/* ── Publicar ───────────────────────────────────────────────────────────── */

function blocoPublicar() {
  const fases = mapa.publicacao.fases
    .map(
      (f) => `
    <article class="fase-card f-${f.status}">
      <header>
        <span class="fase-n">Fase ${f.n}</span>
        <h3>${esc(f.titulo)}</h3>
        <span class="chip esforco">${esc(f.duracao)}</span>
        ${pill(f.status)}
      </header>
      <ul class="check">
        ${f.passos.map((p) => `<li class="${p.feito ? 'feito' : 'aberto'}"><span class="box" aria-hidden="true"></span>${rico(p.t)}</li>`).join('')}
      </ul>
      ${
        f.gates
          ? `<div class="gate"><span class="rot">Só passa desta fase com</span><ul>${f.gates.map((g) => `<li>${rico(g)}</li>`).join('')}</ul></div>`
          : ''
      }
      ${f.nota ? `<p class="nota">${rico(f.nota)}</p>` : ''}
    </article>`,
    )
    .join('');
  return `<div class="fase-cards">${fases}</div>`;
}

/* ── Dívidas ────────────────────────────────────────────────────────────── */

function blocoDividas() {
  return `<div class="dividas">${mapa.dividas
    .map(
      (d) => `
    <article class="divida">
      <h3>${esc(d.titulo)}</h3>
      <p><span class="rot">Hoje está certo</span>${rico(d.hoje)}</p>
      <p><span class="rot">Vira problema</span>${rico(d.quando)}</p>
      <p class="onde"><code>${esc(d.onde)}</code></p>
    </article>`,
    )
    .join('')}</div>`;
}

/* ── Skills ─────────────────────────────────────────────────────────────── */

function blocoSkills() {
  return mapa.skills
    .map(
      (g) => `
    <h3 class="sub">${esc(g.grupo)}</h3>
    <div class="skills">${g.itens
      .map(
        (i) => `
      <article class="skill">
        <h4><code>${esc(i.nome)}</code></h4>
        <p><span class="rot">Quando</span>${rico(i.quando)}</p>
        <p><span class="rot">Por que</span>${rico(i.porque)}</p>
      </article>`,
      )
      .join('')}</div>`,
    )
    .join('');
}

/* ── Sincronia (rodapé) ─────────────────────────────────────────────────── */

function blocoSincronia() {
  const lista = (titulo, itens, render) =>
    itens.length === 0
      ? ''
      : `<div class="drift-grupo"><h4>${esc(titulo)}</h4><ul>${itens.map(render).join('')}</ul></div>`;

  const corpo =
    totalDeriva === 0
      ? `<p class="ok-drift">&#10003; Tudo em sincronia — as ${fatos.evidenciasOk} evidências citadas pelo painel existem no código, e nenhuma rota ou tela ficou sem dono.</p>`
      : `
      <p class="alerta-drift">${totalDeriva} ponto(s) de deriva entre o código e o mapa do painel. Corrija <code>painel/mapa.mjs</code> e rode <code>npm run painel</code>.</p>
      ${lista('Evidência que sumiu do código', deriva.arquivos, (d) => `<li><strong>${esc(d.nome)}</strong> cita <code>${esc(d.alvo)}</code></li>`)}
      ${lista('Rota citada que não está registrada', deriva.rotas, (d) => `<li><strong>${esc(d.nome)}</strong> cita <code>${esc(d.alvo)}</code></li>`)}
      ${lista('Rota nova no código, sem dono no painel', deriva.rotasNovas, (r) => `<li><code>${esc(r)}</code></li>`)}
      ${lista('Tela nova no código, sem dono no painel', deriva.telasNovas, (t) => `<li><code>${esc(t)}</code></li>`)}
      ${lista('Referência quebrada dentro do mapa', deriva.links, (l) => `<li><strong>${esc(l.nome)}</strong> aponta para ${esc(l.alvo)}</li>`)}
      ${lista('Arquivo de código que ninguém descreve', deriva.semDono, (a) => `<li><code>${esc(a)}</code></li>`)}
      ${lista('Etapa citada no repositório e ausente do catálogo', deriva.etapasNovas, (c) => `<li><code>${esc(c)}</code></li>`)}`;

  const medidos = [
    ['rotas na API', fatos.rotas],
    ['telas no app', fatos.telas],
    ['parsers de estado', fatos.parsers],
    ['tabelas no servidor', fatos.tabelasBackend],
    ['tabelas no aparelho', fatos.tabelasLocais],
    ['migrações', fatos.migracoes],
    ['arquivos de teste', fatos.arquivosTeste],
    ['rotinas agendadas', fatos.workflows],
  ]
    .map(([r, n]) => `<div class="medido"><b>${n}</b><span>${esc(r)}</span></div>`)
    .join('');

  return `
  <div class="medidos">${medidos}</div>
  <p class="legenda">Os números acima são <strong>contados no repositório</strong> a cada geração — ninguém os digita. O que é curado à mão é só o status e o texto de cada item, em <code>painel/mapa.mjs</code>.</p>
  <div class="como">
    <h3 class="sub">Como este painel se mantém junto com o código</h3>
    <ol class="fluxo-manter">
      <li><strong>Você muda o código.</strong></li>
      <li><strong>Atualiza o item no mapa</strong> — uma linha em <code>painel/mapa.mjs</code>: virar <code>pronto</code>, ou reescrever o que falta.</li>
      <li><strong>Roda <code>npm run painel</code></strong> — o painel sai novo, com os números recontados.</li>
      <li><strong>Se você esquecer</strong>, o <code>npm run check</code> (e o CI) roda <code>npm run painel:conferir</code> e reprova: evidência que sumiu e rota/tela nova sem dono aparecem por nome.</li>
    </ol>
  </div>
  <div class="drift">${corpo}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════════════════ */

const css = `
${fontes}
:root{
  --canvas:#F7F7F5; --card:#FFFFFF; --card2:#FCFCFB;
  --line:#E7E7E3; --line2:#F0F0EC;
  --ink:#1B1B19; --sub:#6B6B66; --faint:#A3A39D;
  --ok:#16A34A; --ok-bg:#EAF6EE; --ok-line:#C9EBD4;
  --warn:#B26A05; --warn-pt:#D97706; --warn-bg:#FBF1DC; --warn-line:#F0DFB8;
  --bad:#DC2626; --bad-bg:#FBEAE9; --bad-line:#F3CFCD;
  --sombra:0 1px 2px rgba(27,27,25,.05), 0 8px 24px -16px rgba(27,27,25,.18);
  --r:12px;
}
@media (prefers-color-scheme:dark){
  :root{
    --canvas:#111110; --card:#191918; --card2:#1D1D1B;
    --line:#2C2C29; --line2:#232321;
    --ink:#F0F0EE; --sub:#8F8F8A; --faint:#6E6E69;
    --ok:#4ADE80; --ok-bg:#132419; --ok-line:#1F4530;
    --warn:#FBBF24; --warn-pt:#FBBF24; --warn-bg:#241D0F; --warn-line:#453518;
    --bad:#F87171; --bad-bg:#241413; --bad-line:#4A2422;
    --sombra:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.6);
  }
}
:root[data-theme="light"]{
  --canvas:#F7F7F5; --card:#FFFFFF; --card2:#FCFCFB;
  --line:#E7E7E3; --line2:#F0F0EC;
  --ink:#1B1B19; --sub:#6B6B66; --faint:#A3A39D;
  --ok:#16A34A; --ok-bg:#EAF6EE; --ok-line:#C9EBD4;
  --warn:#B26A05; --warn-pt:#D97706; --warn-bg:#FBF1DC; --warn-line:#F0DFB8;
  --bad:#DC2626; --bad-bg:#FBEAE9; --bad-line:#F3CFCD;
  --sombra:0 1px 2px rgba(27,27,25,.05), 0 8px 24px -16px rgba(27,27,25,.18);
}
:root[data-theme="dark"]{
  --canvas:#111110; --card:#191918; --card2:#1D1D1B;
  --line:#2C2C29; --line2:#232321;
  --ink:#F0F0EE; --sub:#8F8F8A; --faint:#6E6E69;
  --ok:#4ADE80; --ok-bg:#132419; --ok-line:#1F4530;
  --warn:#FBBF24; --warn-pt:#FBBF24; --warn-bg:#241D0F; --warn-line:#453518;
  --bad:#F87171; --bad-bg:#241413; --bad-line:#4A2422;
  --sombra:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.6);
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--canvas); color:var(--ink);
  font-family:'Instrument Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
code{
  font-family:ui-monospace,SFMono-Regular,'Cascadia Mono',Menlo,Consolas,monospace;
  font-size:.86em; background:var(--line2); border:1px solid var(--line);
  padding:.08em .34em; border-radius:5px; white-space:nowrap;
}
h1,h2,h3,h4{margin:0; text-wrap:balance; letter-spacing:-.015em; font-weight:700}
p{margin:0}
ul,ol{margin:0; padding:0; list-style:none}
strong{font-weight:600}
a{color:inherit}
:focus-visible{outline:2px solid var(--ink); outline-offset:2px; border-radius:4px}
svg{fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round}

/* ── topo ─────────────────────────────────────────────────────────────── */
.topo{
  position:sticky; top:0; z-index:20; background:color-mix(in srgb,var(--canvas) 88%,transparent);
  backdrop-filter:blur(12px); border-bottom:1px solid var(--line);
}
.topo-in{max-width:1180px; margin:0 auto; padding:14px 24px 0; display:flex; flex-wrap:wrap; gap:12px 20px; align-items:baseline}
.marca{display:flex; align-items:baseline; gap:9px; font-weight:700; letter-spacing:-.03em; font-size:19px}
.marca span{font-weight:400; font-size:13px; color:var(--sub); letter-spacing:0}
.topo-meta{margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--sub)}
.selo{display:inline-flex; gap:6px; align-items:center; border:1px solid var(--line); background:var(--card); border-radius:999px; padding:3px 10px}
.selo.sujo{border-color:var(--warn-line); background:var(--warn-bg); color:var(--warn)}
nav.abas{max-width:1180px; margin:0 auto; padding:10px 24px 0; display:flex; gap:2px; overflow-x:auto; scrollbar-width:thin}
nav.abas a{
  flex:0 0 auto; text-decoration:none; font-size:13px; font-weight:600; color:var(--sub);
  padding:8px 12px; border-bottom:2px solid transparent; white-space:nowrap;
}
nav.abas a:hover{color:var(--ink)}
nav.abas a.ativo{color:var(--ink); border-bottom-color:var(--ink)}

/* ── layout ───────────────────────────────────────────────────────────── */
main{max-width:1180px; margin:0 auto; padding:8px 24px 96px}
.sec{padding:44px 0 8px; border-top:1px solid var(--line); scroll-margin-top:112px}
.sec:first-of-type{border-top:0}
.sec-cab{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:20px}
.sec-cab>div{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap}
.sec-num{font-size:12px; font-weight:700; color:var(--faint); font-variant-numeric:tabular-nums}
.sec-cab h2{font-size:clamp(21px,3vw,27px)}
.sub{font-size:15px; margin:34px 0 6px; letter-spacing:-.01em}
.sub:first-child{margin-top:0}
.legenda{color:var(--sub); font-size:13.5px; max-width:68ch; margin-bottom:16px}
.lede{font-size:16.5px; color:var(--sub); max-width:70ch; margin-bottom:24px}
.nota{font-size:13px; color:var(--sub); margin-top:14px; max-width:70ch}
.rot{display:block; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--faint); margin-bottom:2px}
.chips .rot,.chips>.rot{display:inline; margin-right:6px}

button.ouvir{
  flex:0 0 auto; display:inline-flex; gap:6px; align-items:center; cursor:pointer;
  font:inherit; font-size:12px; font-weight:600; color:var(--sub);
  background:var(--card); border:1px solid var(--line); border-radius:999px; padding:5px 11px;
}
button.ouvir:hover{color:var(--ink); border-color:var(--faint)}
button.ouvir[aria-pressed="true"]{background:var(--ink); color:var(--canvas); border-color:var(--ink)}
button.ouvir svg{width:13px; height:13px}

/* ── pills ────────────────────────────────────────────────────────────── */
.pill{
  flex:0 0 auto; display:inline-flex; gap:5px; align-items:center; font-size:11px; font-weight:700;
  border-radius:999px; padding:3px 9px 3px 7px; border:1px solid; letter-spacing:.01em;
}
.pill i{width:6px; height:6px; border-radius:50%; background:currentColor}
.p-pronto{color:var(--ok); background:var(--ok-bg); border-color:var(--ok-line)}
.p-parcial{color:var(--warn); background:var(--warn-bg); border-color:var(--warn-line)}
.p-falta{color:var(--bad); background:var(--bad-bg); border-color:var(--bad-line)}
.p-planejado{color:var(--sub); background:var(--line2); border-color:var(--line)}

/* ── placar ───────────────────────────────────────────────────────────── */
.tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:22px}
.tile{
  background:var(--card); border:1px solid var(--line); border-radius:var(--r);
  padding:15px 16px; display:flex; flex-direction:column; gap:1px; box-shadow:var(--sombra);
  border-top:3px solid var(--line);
}
.tile.t-ok{border-top-color:var(--ok)} .tile.t-warn{border-top-color:var(--warn-pt)} .tile.t-bad{border-top-color:var(--bad)}
.tile-n{font-size:31px; font-weight:700; line-height:1.05; font-variant-numeric:tabular-nums; letter-spacing:-.035em}
.tile-r{font-size:13px; font-weight:600}
.tile-s{font-size:11.5px; color:var(--faint)}

.barra{position:relative; height:26px; background:var(--line2); border:1px solid var(--line); border-radius:999px; overflow:hidden; display:flex; align-items:center}
.barra span{position:absolute; inset:0 auto 0 0; background:var(--ok-bg); border-right:2px solid var(--ok)}
.barra b{position:relative; font-size:11.5px; font-weight:700; padding:0 12px; color:var(--ink)}

.fases{display:grid; grid-template-columns:repeat(auto-fit,minmax(178px,1fr)); gap:10px; margin-top:12px}
.fase{
  background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px 13px;
  display:flex; flex-direction:column; gap:3px; align-items:flex-start; border-left:3px solid var(--line);
}
.fase.f-pronto{border-left-color:var(--ok)} .fase.f-parcial{border-left-color:var(--warn-pt)} .fase.f-falta{border-left-color:var(--bad)}
.fase-n{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--faint)}
.fase strong{font-size:13.5px; line-height:1.3}
.fase-dur{font-size:11.5px; color:var(--sub); margin-bottom:4px}

/* ── bloqueadores ─────────────────────────────────────────────────────── */
.bloqs{display:grid; gap:12px}
.bloq{
  background:var(--card); border:1px solid var(--line); border-left:3px solid var(--bad);
  border-radius:var(--r); padding:16px 18px; box-shadow:var(--sombra);
}
.bloq.g-media{border-left-color:var(--warn-pt)}
.bloq header{display:flex; align-items:baseline; gap:11px; margin-bottom:9px; flex-wrap:wrap}
.bloq-n{
  flex:0 0 auto; width:21px; height:21px; border-radius:50%; background:var(--ink); color:var(--canvas);
  font-size:11.5px; font-weight:700; display:grid; place-items:center; font-variant-numeric:tabular-nums;
}
.bloq h3{font-size:15.5px; flex:1 1 240px}
.chip.esforco{background:var(--line2); border-color:var(--line); color:var(--sub); font-weight:600}
.bloq p{max-width:78ch; font-size:13.5px; color:var(--sub)}
.bloq .porque{margin-bottom:9px}
.bloq .fix{color:var(--ink)}
.onde{margin-top:10px; display:flex; flex-wrap:wrap; gap:5px}
.prompt-caixa{margin-top:11px}
.prompt-rot{display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:5px}
button.copiar{
  font:inherit; font-size:11.5px; font-weight:600; cursor:pointer; padding:3px 10px; border-radius:999px;
  background:var(--card2); border:1px solid var(--line); color:var(--sub);
}
button.copiar:hover{color:var(--ink); border-color:var(--faint)}
button.copiar.ok{background:var(--ok-bg); border-color:var(--ok-line); color:var(--ok)}
pre.prompt{
  margin:0; padding:11px 13px; background:var(--card2); border:1px solid var(--line); border-radius:9px;
  font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--ink);
  white-space:pre-wrap; word-break:break-word; max-width:none;
}

/* ── trilha ───────────────────────────────────────────────────────────── */
.trilha{display:grid; grid-template-columns:repeat(auto-fit,minmax(196px,1fr)); gap:10px; align-items:start}
.zona{background:var(--card2); border:1px solid var(--line); border-radius:var(--r); padding:12px}
.zona.fronteira{background:var(--bad-bg); border-color:var(--bad-line)}
.zona>header{margin-bottom:9px}
.zona h4{font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--sub)}
.zona.fronteira h4{color:var(--bad)}
.zona>header span{font-size:11.5px; color:var(--faint)}
.passos{display:grid; gap:7px}
.passo button.ir{
  width:100%; text-align:left; cursor:pointer; font:inherit; display:grid; gap:1px;
  background:var(--card); border:1px solid var(--line); border-radius:9px; padding:9px 11px;
}
.passo button.ir:hover{border-color:var(--ink)}
.passo strong{font-size:13.5px}
.passo button.ir span{font-size:11.5px; color:var(--sub); line-height:1.4}
.passo.destaque button.ir{background:var(--ink); color:var(--canvas); border-color:var(--ink)}
.passo.destaque button.ir span{color:color-mix(in srgb,var(--canvas) 74%,var(--ink))}
.passo code.rota{display:inline-block; margin-top:4px; font-size:10.5px}
.saidas{display:grid; gap:5px; margin-top:7px}
.saidas li{font-size:11.5px; color:var(--sub); background:var(--card); border:1px solid var(--bad-line); border-radius:8px; padding:7px 9px}
.saidas li span{display:block; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--bad)}

/* ── funil ────────────────────────────────────────────────────────────── */
.funil{display:grid; gap:12px}
.entradas{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px}
.entradas li{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px 14px}
.entradas strong{display:block; font-size:13.5px}
.entradas span{font-size:12px; color:var(--sub)}
.portas{display:grid; gap:10px}
.porta{display:flex; gap:13px; background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:15px 16px}
.porta-n{
  flex:0 0 auto; width:24px; height:24px; border-radius:50%; border:1.5px solid var(--ink);
  display:grid; place-items:center; font-size:12px; font-weight:700; font-variant-numeric:tabular-nums;
}
.porta h4{font-size:14.5px; margin-bottom:3px}
.porta p{font-size:13px; color:var(--sub); max-width:74ch}
.ramos{display:flex; flex-wrap:wrap; gap:8px; margin-top:11px}
.ramo{display:flex; align-items:center; gap:7px; background:var(--card2); border:1px solid var(--line); border-radius:999px; padding:4px 11px 4px 5px}
.ver{font-size:10.5px; font-weight:700; letter-spacing:.04em; border-radius:999px; padding:2px 8px; border:1px solid}
.v-ok{color:var(--ok); background:var(--ok-bg); border-color:var(--ok-line)}
.v-warn{color:var(--warn); background:var(--warn-bg); border-color:var(--warn-line)}
.v-bad{color:var(--bad); background:var(--bad-bg); border-color:var(--bad-line)}
.ramo-n{font-size:11.5px; color:var(--sub)}
.cortes{display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:8px}
.cortes li{font-size:12px; color:var(--sub); background:var(--card2); border:1px solid var(--line); border-radius:9px; padding:9px 11px}
.cortes strong{display:block; color:var(--ink); font-size:12.5px}

/* ── jornadas ─────────────────────────────────────────────────────────── */
.jchips{display:flex; flex-wrap:wrap; gap:5px; margin-bottom:18px}
.jchip{
  cursor:pointer; font:inherit; font-size:12.5px; font-weight:600; color:var(--sub);
  background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 13px;
}
.jchip:hover{color:var(--ink); border-color:var(--faint)}
.jchip.ativo{background:var(--ink); color:var(--canvas); border-color:var(--ink)}
.jornada[hidden]{display:none}
.jcab{background:var(--card2); border:1px solid var(--line); border-radius:var(--r); padding:14px 16px; margin-bottom:14px}
.jmeta{display:flex; flex-wrap:wrap; gap:10px 14px; align-items:flex-start}
.jponta{flex:1 1 250px; font-size:13.5px}
.jseta{flex:0 0 auto; align-self:center; color:var(--faint); font-size:17px}
.jstats{display:flex; flex-wrap:wrap; gap:7px; align-items:center; margin-top:12px; padding-top:11px; border-top:1px solid var(--line)}
.jstats .mini{font-size:11px; color:var(--faint); font-variant-numeric:tabular-nums}
.jobs{
  font-size:12.5px; color:var(--sub); background:var(--card2); border:1px solid var(--line);
  border-left:3px solid var(--faint); border-radius:9px; padding:10px 12px; margin-bottom:16px; max-width:78ch;
}
.jpassos{display:grid; gap:0; position:relative}
.jpasso{
  display:flex; gap:13px; padding:0 0 16px 0; position:relative;
}
/* trilho vertical ligando os passos */
.jpasso::before{
  content:''; position:absolute; left:12px; top:26px; bottom:0; width:1.5px; background:var(--line);
}
.jpasso:last-child::before{display:none}
.jn{
  flex:0 0 auto; z-index:1; width:25px; height:25px; border-radius:50%;
  background:var(--card); border:1.5px solid var(--line); color:var(--sub);
  font-size:11.5px; font-weight:700; display:grid; place-items:center; font-variant-numeric:tabular-nums;
}
.jpasso.s-pronto .jn{border-color:var(--ok); color:var(--ok)}
.jpasso.s-parcial .jn{border-color:var(--warn-pt); color:var(--warn)}
.jpasso.s-falta .jn{border-color:var(--bad); color:var(--bad)}
.jcorpo{
  flex:1 1 auto; background:var(--card); border:1px solid var(--line); border-radius:var(--r);
  padding:13px 15px; box-shadow:var(--sombra);
}
.jpasso.s-parcial .jcorpo{border-color:var(--warn-line)}
.jpasso.s-falta .jcorpo{border-color:var(--bad-line)}
.jtopo{display:flex; gap:9px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap}
.jtopo h4{font-size:14.5px; line-height:1.3; flex:1 1 200px}
.jonde{
  display:inline-flex; gap:5px; align-items:center; margin-top:6px;
  font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  border:1px solid var(--line); background:var(--card2); color:var(--sub);
  border-radius:999px; padding:2px 9px 2px 7px;
}
.jonde svg{width:11px; height:11px; stroke-width:1.5}
.jonde.o-navegador{color:var(--warn); background:var(--warn-bg); border-color:var(--warn-line)}
.jonde.o-servidor,.jonde.o-banco{color:var(--ink); background:var(--line2); border-color:var(--line)}
.jonde.o-sefaz{color:var(--bad); background:var(--bad-bg); border-color:var(--bad-line)}
.joque{font-size:13.5px; color:var(--sub); margin-top:8px; max-width:74ch}
.jporque,.jfalhar{font-size:12.5px; margin-top:10px; border-radius:9px; padding:8px 10px; max-width:74ch}
.jporque{color:var(--sub); background:var(--card2); border:1px solid var(--line)}
.jfalhar{color:var(--warn); background:var(--warn-bg); border:1px solid var(--warn-line)}
.jfalhar .rot{color:var(--warn); opacity:.8}
code.jarq{font-size:10.5px; white-space:normal; word-break:break-all; color:var(--faint)}
.jramos-t{font-size:13px; margin:26px 0 10px; color:var(--sub)}
.jramos{display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:10px; align-items:start}
.jramo{
  background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px 14px;
  border-left:3px solid var(--line2);
}
.jramo.s-pronto{border-left-color:var(--ok)} .jramo.s-parcial{border-left-color:var(--warn-pt)} .jramo.s-falta{border-left-color:var(--bad)}
.jramo>div{display:flex; gap:8px; align-items:baseline; justify-content:space-between; margin-bottom:5px}
.jramo h5{font-size:13px; font-weight:700; margin:0}
.jramo p{font-size:12.5px; color:var(--sub)}

/* ── falta fazer ──────────────────────────────────────── */
.falta-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start; margin-bottom:8px}
.falta-card{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:14px 16px; box-shadow:var(--sombra); border-left:3px solid var(--line2)}
.falta-card.s-falta{border-left-color:var(--bad)}
.falta-card.s-parcial{border-left-color:var(--warn-pt)}
.falta-card header{margin-bottom:6px}
.falta-card h4{font-size:14.5px; line-height:1.3}
.falta-card .oque{font-size:13px; color:var(--sub); margin-top:6px; max-width:60ch}

/* ── ferramentas + funções ────────────────────────────────────────────── */
.barra-ferramentas{display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; margin-bottom:12px}
.busca{display:flex; align-items:center; gap:7px; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 13px; flex:1 1 230px; max-width:330px}
.busca svg{width:14px; height:14px; color:var(--faint); flex:0 0 auto}
.busca input{border:0; background:none; font:inherit; font-size:13.5px; color:var(--ink); width:100%; outline:none}
.fchips{display:flex; flex-wrap:wrap; gap:5px}
.fchip{
  cursor:pointer; font:inherit; font-size:12px; font-weight:600; color:var(--sub);
  background:var(--card); border:1px solid var(--line); border-radius:999px; padding:4px 11px;
}
.fchip:hover{color:var(--ink); border-color:var(--faint)}
.fchip.ativo{background:var(--ink); color:var(--canvas); border-color:var(--ink)}
.contagem{font-size:12px; color:var(--faint); margin-bottom:12px; font-variant-numeric:tabular-nums}
.fns{display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; align-items:start}
.fn{
  background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:15px 16px;
  box-shadow:var(--sombra); border-top:3px solid var(--line2); scroll-margin-top:120px;
}
.fn.s-pronto{border-top-color:var(--ok)} .fn.s-parcial{border-top-color:var(--warn-pt)} .fn.s-falta{border-top-color:var(--bad)}
.fn[hidden]{display:none}
.fn.alvo{border-color:var(--ink); box-shadow:0 0 0 2px var(--ink)}
.fn header{display:flex; gap:10px; align-items:flex-start; justify-content:space-between; margin-bottom:2px}
.fn h3{font-size:15px; line-height:1.3}
.fn-area{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--faint)}
.fn .oque{font-size:13.5px; color:var(--sub); margin-top:7px; max-width:60ch}
.fn .falta,.etapa .falta{
  margin-top:10px; font-size:12.5px; color:var(--warn); background:var(--warn-bg);
  border:1px solid var(--warn-line); border-radius:9px; padding:8px 10px;
}
.fn .falta .rot,.etapa .falta .rot{color:var(--warn); opacity:.8}
details.det{margin-top:10px}
details.det summary{
  cursor:pointer; font-size:11.5px; font-weight:600; color:var(--sub); list-style:none;
  display:inline-flex; gap:5px; align-items:center;
}
details.det summary::-webkit-details-marker{display:none}
details.det summary::before{content:'+'; font-weight:700; color:var(--faint)}
details.det[open] summary::before{content:'−'}
details.det summary:hover{color:var(--ink)}
details.det>p{font-size:12.5px; color:var(--sub); margin-top:7px; max-width:64ch}
.arqs{margin-top:7px; display:grid; gap:4px}
.arqs li{font-size:11px}
.arqs li code{white-space:normal; word-break:break-all}
.arqs li.sumiu code{border-color:var(--bad-line); background:var(--bad-bg); color:var(--bad)}
.alerta{font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--bad)}
.rotas{display:flex; flex-wrap:wrap; gap:5px; margin-top:11px}
code.rota{background:var(--card2); border-color:var(--line); font-size:11px; white-space:normal}
.chips{display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-top:9px}
.chip{
  font-size:11.5px; font-weight:600; color:var(--sub); background:var(--card2);
  border:1px solid var(--line); border-radius:999px; padding:3px 9px; text-decoration:none;
  cursor:pointer; font-family:inherit;
}
.chip:hover{color:var(--ink); border-color:var(--faint)}
.chip.etapa{font-variant-numeric:tabular-nums}
.vazio{color:var(--sub); font-size:13.5px; padding:22px 0}

/* ── regras ───────────────────────────────────────────────────────────── */
.regras{display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; align-items:start}
.regra-card{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:15px 16px; box-shadow:var(--sombra); scroll-margin-top:120px}
.regra-card.travada{border-color:var(--ink); border-width:1.5px}
.regra-card header{display:flex; gap:8px; align-items:baseline; margin-bottom:7px}
.regra-card h3{font-size:14.5px; line-height:1.3}
.lock{font-size:12px; line-height:1.4}
.regra-card .oque{font-size:13.5px; max-width:62ch}
.regra-card .porque{font-size:12.5px; color:var(--sub); margin-top:11px; max-width:64ch}
.nums{display:flex; flex-wrap:wrap; gap:7px; margin-top:11px}
.num{
  display:flex; flex-direction:column; background:var(--card2); border:1px solid var(--line);
  border-radius:9px; padding:6px 10px;
  font-size:10.5px; color:var(--faint); text-transform:uppercase; letter-spacing:.06em;
}
.num b{
  font-size:14px; color:var(--ink); text-transform:none;
  font-variant-numeric:tabular-nums; letter-spacing:-.02em;
}

/* ── etapas ───────────────────────────────────────────────────────────── */
.camadas{display:grid; gap:14px}
.camada{background:var(--card2); border:1px solid var(--line); border-radius:var(--r); padding:13px 14px}
.camada>header{display:flex; flex-wrap:wrap; gap:4px 12px; align-items:baseline; margin-bottom:10px}
.camada h3{font-size:14.5px}
.camada>header>span{font-size:12.5px; color:var(--sub)}
.camada .mini{margin-left:auto; font-size:11px; color:var(--faint); font-variant-numeric:tabular-nums}
.etapas{display:grid; gap:6px}
.etapa{
  display:flex; gap:11px; align-items:flex-start; background:var(--card); border:1px solid var(--line);
  border-radius:9px; padding:10px 12px; border-left:3px solid var(--line2); scroll-margin-top:120px;
}
.etapa.s-pronto{border-left-color:var(--ok)} .etapa.s-parcial{border-left-color:var(--warn-pt)} .etapa.s-falta{border-left-color:var(--bad)}
.etapa .cod{flex:0 0 auto; font-size:11px; font-weight:700; min-width:50px; text-align:center}
.etapa-corpo{flex:1 1 auto}
.etapa h4{font-size:13.5px; display:flex; gap:7px; align-items:baseline; flex-wrap:wrap}
.etapa p{font-size:12.5px; color:var(--sub); max-width:78ch}
.fase-tag{font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; border-radius:4px; padding:1px 5px; border:1px solid}
.fase-tag.mvp{color:var(--ink); border-color:var(--ink)}
.fase-tag.pos{color:var(--faint); border-color:var(--line)}

/* ── publicar ─────────────────────────────────────────────────────────── */
.fase-cards{display:grid; gap:12px}
.fase-card{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:16px 18px; box-shadow:var(--sombra); border-left:3px solid var(--line)}
.fase-card.f-pronto{border-left-color:var(--ok)} .fase-card.f-parcial{border-left-color:var(--warn-pt)} .fase-card.f-falta{border-left-color:var(--bad)}
.fase-card header{display:flex; flex-wrap:wrap; gap:9px; align-items:baseline; margin-bottom:11px}
.fase-card h3{font-size:15.5px; flex:1 1 200px}
.check{display:grid; gap:5px}
.check li{display:flex; gap:9px; align-items:flex-start; font-size:13px}
.check .box{flex:0 0 auto; width:14px; height:14px; margin-top:3px; border:1.5px solid var(--faint); border-radius:4px}
.check li.feito{color:var(--sub)}
.check li.feito .box{background:var(--ok); border-color:var(--ok); position:relative}
.check li.feito .box::after{content:'✓'; position:absolute; inset:0; color:var(--card); font-size:10px; font-weight:700; display:grid; place-items:center}
.gate{margin-top:13px; background:var(--card2); border:1px solid var(--line); border-radius:9px; padding:11px 13px}
.gate ul{display:grid; gap:4px; margin-top:5px}
.gate li{font-size:12.5px; color:var(--sub); padding-left:13px; position:relative}
.gate li::before{content:''; position:absolute; left:0; top:8px; width:5px; height:5px; border-radius:50%; background:var(--faint)}

/* ── dívidas / skills ─────────────────────────────────────────────────── */
.dividas,.skills{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start}
.divida,.skill{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:15px 16px; box-shadow:var(--sombra)}
.divida h3,.skill h4{font-size:14.5px; margin-bottom:9px}
.divida p,.skill p{font-size:12.5px; color:var(--sub); margin-bottom:9px; max-width:60ch}
.divida p:last-of-type,.skill p:last-child{margin-bottom:0}
.divida .onde{margin-top:2px}

/* ── sincronia ────────────────────────────────────────────────────────── */
.medidos{display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px; margin-bottom:14px}
.medido{background:var(--card); border:1px solid var(--line); border-radius:9px; padding:10px 12px; display:grid; gap:0}
.medido b{font-size:21px; font-variant-numeric:tabular-nums; letter-spacing:-.03em; line-height:1.15}
.medido span{font-size:11px; color:var(--faint)}
.fluxo-manter{display:grid; gap:7px; counter-reset:p; margin-top:8px}
.fluxo-manter li{font-size:13.5px; color:var(--sub); padding-left:28px; position:relative; max-width:78ch}
.fluxo-manter li::before{
  counter-increment:p; content:counter(p); position:absolute; left:0; top:1px;
  width:19px; height:19px; border-radius:50%; background:var(--line2); border:1px solid var(--line);
  color:var(--ink); font-size:11px; font-weight:700; display:grid; place-items:center;
}
.fluxo-manter strong{color:var(--ink)}
.drift{margin-top:20px; border:1px solid var(--line); border-radius:var(--r); padding:15px 16px; background:var(--card)}
.ok-drift{font-size:13.5px; color:var(--ok); font-weight:600}
.alerta-drift{font-size:13.5px; color:var(--warn); font-weight:600; margin-bottom:12px}
.drift-grupo{margin-top:12px}
.drift-grupo h4{font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--faint); margin-bottom:5px}
.drift-grupo ul{display:grid; gap:3px}
.drift-grupo li{font-size:12.5px; color:var(--sub)}

footer{max-width:1180px; margin:0 auto; padding:0 24px 72px; font-size:12px; color:var(--faint); max-width:72ch}

@media (max-width:640px){
  main,.topo-in,nav.abas,footer{padding-left:16px; padding-right:16px}
  .sec{padding-top:34px}
  .fns,.regras{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important; transition:none!important}}
@media print{
  .topo,button.ouvir,.barra-ferramentas{display:none}
  .sec{break-inside:avoid}
  details.det{display:none}
}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   JS da página
   ═══════════════════════════════════════════════════════════════════════════ */

const js = `
(function(){
  // ── filtros das funções ──────────────────────────────────────────────
  var cards = Array.prototype.slice.call(document.querySelectorAll('.fn'));
  var busca = document.getElementById('busca');
  var contagem = document.getElementById('contagem');
  var vazio = document.getElementById('vazio');
  var area = 'todas', status = 'todos';

  function aplicar(){
    var termo = (busca.value || '').trim().toLowerCase();
    var n = 0;
    cards.forEach(function(c){
      var ok = (area === 'todas' || c.dataset.area === area)
        && (status === 'todos' || c.dataset.status === status)
        && (!termo || c.dataset.busca.indexOf(termo) !== -1);
      c.hidden = !ok;
      if (ok) n++;
    });
    contagem.textContent = n + (n === 1 ? ' função' : ' funções') + ' de ' + cards.length;
    vazio.hidden = n > 0;
  }

  document.querySelectorAll('.fchip[data-area]').forEach(function(b){
    b.addEventListener('click', function(){
      area = b.dataset.area;
      document.querySelectorAll('.fchip[data-area]').forEach(function(o){ o.classList.toggle('ativo', o === b); });
      aplicar();
    });
  });
  document.querySelectorAll('.fchip[data-status]').forEach(function(b){
    b.addEventListener('click', function(){
      status = b.dataset.status;
      document.querySelectorAll('.fchip[data-status]').forEach(function(o){ o.classList.toggle('ativo', o === b); });
      aplicar();
    });
  });
  busca.addEventListener('input', aplicar);
  aplicar();

  // ── troca de jornada ─────────────────────────────────────────────────
  document.querySelectorAll('.jchip').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.jchip').forEach(function(o){ o.classList.toggle('ativo', o === b); });
      document.querySelectorAll('.jornada').forEach(function(p){
        p.hidden = p.id !== 'jornada-' + b.dataset.jornada;
      });
    });
  });

  // ── copiar o prompt de um bloqueador ──────────────────────────────────
  document.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-copiar]');
    if (!b) return;
    var alvo = document.getElementById(b.dataset.copiar);
    if (!alvo) return;
    var texto = alvo.textContent;
    var marcarOk = function(){
      var original = b.textContent;
      b.textContent = 'Copiado!';
      b.classList.add('ok');
      window.setTimeout(function(){ b.textContent = original; b.classList.remove('ok'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(marcarOk);
    } else {
      var area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      marcarOk();
    }
  });

  // ── ir para uma função (limpa o filtro que a esconderia) ─────────────
  document.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-ir]');
    if (!b) return;
    var alvo = document.getElementById('fn-' + b.dataset.ir);
    if (!alvo) return;
    area = 'todas'; status = 'todos'; busca.value = '';
    document.querySelectorAll('.fchip[data-area]').forEach(function(o){ o.classList.toggle('ativo', o.dataset.area === 'todas'); });
    document.querySelectorAll('.fchip[data-status]').forEach(function(o){ o.classList.toggle('ativo', o.dataset.status === 'todos'); });
    aplicar();
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cards.forEach(function(c){ c.classList.remove('alvo'); });
    alvo.classList.add('alvo');
    window.setTimeout(function(){ alvo.classList.remove('alvo'); }, 2400);
  });

  // ── ouvir a seção ────────────────────────────────────────────────────
  var falando = null;
  var temVoz = 'speechSynthesis' in window;
  document.querySelectorAll('button.ouvir').forEach(function(b){
    if (!temVoz) { b.hidden = true; return; }
    b.addEventListener('click', function(){
      var jaEra = falando === b;
      window.speechSynthesis.cancel();
      document.querySelectorAll('button.ouvir').forEach(function(o){ o.setAttribute('aria-pressed', 'false'); });
      falando = null;
      if (jaEra) return;
      var u = new SpeechSynthesisUtterance(b.dataset.fala);
      u.lang = 'pt-BR';
      u.rate = 1.02;
      u.onend = function(){ b.setAttribute('aria-pressed', 'false'); falando = null; };
      b.setAttribute('aria-pressed', 'true');
      falando = b;
      window.speechSynthesis.speak(u);
    });
  });

  // ── aba ativa conforme a rolagem ─────────────────────────────────────
  var secoes = Array.prototype.slice.call(document.querySelectorAll('.sec'));
  var links = {};
  document.querySelectorAll('nav.abas a').forEach(function(a){ links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entradas){
      entradas.forEach(function(e){
        var a = links[e.target.id];
        if (!a) return;
        if (e.isIntersecting) {
          Object.keys(links).forEach(function(k){ links[k].classList.remove('ativo'); });
          a.classList.add('ativo');
        }
      });
    }, { rootMargin: '-116px 0px -70% 0px' });
    secoes.forEach(function(s){ obs.observe(s); });
  }
})();
`;

/* ═══════════════════════════════════════════════════════════════════════════
   Página
   ═══════════════════════════════════════════════════════════════════════════ */

const abas = [
  ['placar', 'Onde estou'],
  ['bloqueadores', 'Bloqueadores'],
  ['como-funciona', 'Como funciona'],
  ['jornadas', 'Jornadas'],
  ['falta', 'Falta fazer'],
  ['funcoes', 'Funções'],
  ['regras', 'Regras'],
  ['etapas', 'Etapas'],
  ['publicar', 'Publicar'],
  ['dividas', 'Dívidas'],
  ['skills', 'Skills'],
  ['sincronia', 'Sincronia'],
];

const html = `<title>Barganha — Painel do Projeto</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>

<div class="topo">
  <div class="topo-in">
    <span class="marca">Barganha <span>painel do projeto</span></span>
    <span class="topo-meta">
      <span class="selo">commit <code>${esc(fatos.commit)}</code> · ${esc(fatos.commitData)}</span>
      ${fatos.sujo ? `<span class="selo sujo">${fatos.arquivosSujos} arquivo(s) sem commit</span>` : ''}
      <span class="selo">gerado em ${esc(fatos.geradoEm)}</span>
    </span>
  </div>
  <nav class="abas" aria-label="Seções">
    ${abas.map(([id, r]) => `<a href="#${id}">${esc(r)}</a>`).join('')}
  </nav>
</div>

<main>
${seccao(
  'placar',
  '01',
  'Onde estou',
  `${fatos.etapas.pronto} de ${mapa.etapas.length} etapas estão prontas, ${fatos.etapas.parcial} estão pela metade e ${fatos.etapas.falta} não começaram. ${mapa.publicacao.resumo}`,
  blocoPlacar(),
)}
${seccao(
  'bloqueadores',
  '02',
  'O que impede publicar hoje',
  `São ${mapa.bloqueadores.length} pontos, e ${mapa.bloqueadores.filter((b) => b.gravidade === 'alta').length} deles são de gravidade alta. Nenhum é uma feature nova: são configuração, uma validação no aparelho e a conta da loja. ` +
    mapa.bloqueadores.map((b, i) => `${i + 1}. ${fala(b.titulo)}.`).join(' '),
  blocoBloqueadores(),
)}
${seccao(
  'como-funciona',
  '03',
  'Como o app funciona',
  `${fala(mapa.trilha.legenda)} ${fala(mapa.funil.legenda)}`,
  blocoTrilha(),
)}
${seccao(
  'jornadas',
  '04',
  'Cada função do início ao fim',
  `São ${mapa.jornadas.length} jornadas completas, passo a passo, do gatilho até o fim. Cada passo diz em que máquina roda — no celular, num navegador dentro do celular, no servidor, no portal da SEFAZ ou no banco — o que ele faz, e o que acontece quando dá errado. Serve para você conferir se o app está fazendo o que deveria. ` +
    mapa.jornadas.map((j) => `${fala(j.titulo)}: ${j.passos.length} passos.`).join(' '),
  blocoJornadas(),
)}
${seccao(
  'falta',
  '05',
  'O que ainda não existe',
  `São ${mapa.funcoes.filter((f) => f.status === 'falta').length} coisas que o app não faz de jeito nenhum e ${mapa.funcoes.filter((f) => f.status === 'parcial').length} que existem pela metade. Cada uma diz exatamente o que falta. É desta lista que sai o próximo trabalho.`,
  blocoFalta(),
)}
${seccao(
  'funcoes',
  '06',
  'Cada função, em uma frase',
  `São ${mapa.funcoes.length} funções mapeadas, divididas em ${mapa.areas.length} áreas. Cada uma diz o que faz, com quem conversa, que regra obedece e onde mora no código. Use os filtros para ver só as que estão pela metade.`,
  blocoFuncoes(),
)}
${seccao(
  'regras',
  '07',
  'Regras de negócio',
  `São ${mapa.regras.filter((r) => r.travada).length} decisões travadas, que não se negociam, e ${mapa.regras.filter((r) => !r.travada).length} regras do motor estatístico que decorrem delas.`,
  blocoRegras(),
)}
${seccao(
  'etapas',
  '08',
  'Etapas, do C0 ao C12',
  `O catálogo completo com o status real de cada sub-etapa. ${fatos.etapas.pronto} prontas, ${fatos.etapas.parcial} pela metade — todas com o que falta escrito — e ${fatos.etapas.falta} que não começaram.`,
  blocoEtapas(),
)}
${seccao(
  'publicar',
  '09',
  'Como publicar e os 14 dias de teste',
  `${fala(mapa.publicacao.resumo)} Custo: ${fala(mapa.publicacao.custo)}`,
  blocoPublicar(),
)}
${seccao(
  'dividas',
  '10',
  'Dívidas conscientes',
  'Coisas que estão certas hoje e viram problema em um momento específico. Estão aqui para você não gastar tempo consertando cedo, e não ser pego de surpresa depois.',
  blocoDividas(),
)}
${seccao(
  'skills',
  '11',
  'Skills e agentes que valem a pena',
  'O que já está instalado e você deveria usar mais, o que vale criar de específico para o Barganha, e qual agente chamar para cada frente.',
  blocoSkills(),
)}
${seccao(
  'sincronia',
  '12',
  'Como este painel se mantém junto com o código',
  totalDeriva === 0
    ? `Tudo em sincronia: as ${fatos.evidenciasOk} evidências citadas existem no código e nenhuma rota ou tela ficou sem dono.`
    : `Atenção: existem ${totalDeriva} pontos de deriva entre o código e o mapa do painel.`,
  blocoSincronia(),
)}
</main>

<footer>
  Gerado por <code>npm run painel</code> a partir de <code>painel/mapa.mjs</code> + o estado real do repositório.
  Último commit lido: <code>${esc(fatos.commit)}</code> — “${esc(fatos.commitMsg)}”.
  ${fatos.sujo ? `Havia ${fatos.arquivosSujos} arquivo(s) modificado(s) sem commit no momento da geração.` : ''}
</footer>

<script>${js}</script>
`;

fs.writeFileSync(SAIDA, html, 'utf8');

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`painel: painel/index.html gerado (${kb} KB)`);
console.log(
  `  ${mapa.funcoes.length} funções · ${mapa.regras.length} regras · ${mapa.etapas.length} etapas · ${mapa.bloqueadores.length} bloqueadores`,
);
console.log(
  `  medido no repo: ${fatos.rotas} rotas · ${fatos.telas} telas · ${fatos.migracoes} migrações · ${fatos.arquivosTeste} arquivos de teste`,
);
if (!fontes)
  console.log(
    '  aviso: Instrument Sans não encontrada em node_modules — usando a fonte do sistema.',
  );
if (totalDeriva === 0) console.log(`  sincronia: ok (${evidenciasOk} evidências conferidas)`);
else console.log(`  sincronia: ${totalDeriva} deriva(s) — veja a seção "Sincronia" no painel`);
