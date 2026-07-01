/**
 * Depuração da captura por HTML (C2.6). Quando o app manda o HTML colhido no
 * WebView, é útil ver o LAYOUT REAL do portal para ajustar os seletores do
 * parser (o do RJ foi escrito sobre um fixture). Mas o HTML da nota pode conter
 * CPF do consumidor — então NUNCA gravamos o HTML cru: gravamos só o ESQUELETO
 * (árvore de `tag#id.classes` + o TAMANHO do texto, jamais o texto). Isso revela
 * os seletores sem vazar dado pessoal (docs/04).
 *
 * Ligado por padrão em desenvolvimento; desligue com `BARGANHA_DEBUG_HTML=0`.
 * Nunca escreve em produção nem durante os testes. Arquivos vão para
 * `backend/.debug-html/` (ignorado pelo git).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHtml, type HTMLElement } from '../parsers/html';

const DESLIGADO = process.env.BARGANHA_DEBUG_HTML === '0';
const AMBIENTE = process.env.NODE_ENV;
const ATIVO = !DESLIGADO && AMBIENTE !== 'production' && AMBIENTE !== 'test';

const DIR = join(process.cwd(), '.debug-html');
const TAGS_IGNORADAS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'svg', 'path']);
const MAX_LINHAS = 5000;

/** Árvore `tag#id.classes [txt:N]` — estrutura pura, sem conteúdo textual. */
function esqueletoDe(html: string): string {
  const raiz = parseHtml(html);
  const linhas: string[] = [];

  const visitar = (no: HTMLElement, prof: number): void => {
    if (linhas.length >= MAX_LINHAS || prof > 15) return;
    const tag = (no.rawTagName ?? '').toLowerCase();
    if (tag && TAGS_IGNORADAS.has(tag)) return;

    if (tag) {
      const classe = (no.getAttribute('class') ?? '').trim().replace(/\s+/g, '.');
      const id = (no.getAttribute('id') ?? '').trim();
      const seletor = tag + (id ? `#${id}` : '') + (classe ? `.${classe}` : '');
      const texto = no.childNodes
        .filter((n) => n.nodeType === 3)
        .map((n) => ((n as { text?: string }).text ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      linhas.push('  '.repeat(prof) + seletor + (texto ? ` [txt:${texto.length}]` : ''));
    }

    for (const filho of no.childNodes) {
      if (filho.nodeType === 1) visitar(filho as unknown as HTMLElement, tag ? prof + 1 : prof);
    }
  };

  visitar(raiz, 0);
  return linhas.join('\n');
}

/**
 * Grava o esqueleto do HTML recebido (no-op fora de dev). `rotulo` compõe o nome
 * do arquivo. Nunca lança — depuração não pode derrubar a ingestão.
 */
export function registrarHtmlDebug(html: string, rotulo: string): void {
  if (!ATIVO || !html) return;
  try {
    mkdirSync(DIR, { recursive: true });
    const seguro = rotulo.replace(/[^\w.-]/g, '_');
    const arquivo = join(DIR, `${seguro}-${Date.now()}.txt`);
    const cabecalho =
      `# Esqueleto do HTML recebido em ${new Date().toISOString()} ` +
      `(só estrutura — sem texto/PII).\n# tamanho do html: ${html.length} bytes\n\n`;
    writeFileSync(arquivo, cabecalho + esqueletoDe(html), 'utf8');
    console.log(`[debug-html] esqueleto salvo: ${arquivo}`);
  } catch (e) {
    console.warn('[debug-html] falha ao salvar:', e instanceof Error ? e.message : e);
  }
}
