/**
 * C9.2.2 (b6) — Cifra reversível das colunas privadas sensíveis do Postgres
 * (`cupom.chave_acesso_cifrada`, `item_cupom.descricao_cifrada`). Ver
 * docs/19-ambientes-e-endurecimento.md §8 para o desenho completo e o
 * procedimento de rotação.
 *
 * Decisões de design (não repetir sem reler o §8):
 *
 * - **Envelope com a chave FORA do banco.** Cifra/decifra em Node
 *   (`node:crypto`, AES-256-GCM) — nunca `pgcrypto` com a chave passada como
 *   parâmetro de uma query: isso a exporia em `pg_stat_statements` e nos logs
 *   do Postgres, o que contraria "fora do banco". A chave-mestra vive só em
 *   variável de ambiente do BACKEND (`CIFRA_CHAVE_ATUAL`/`CIFRA_CHAVE_ANTERIOR`,
 *   ver `config/env.ts`) — nunca em tabela, `ALTER DATABASE SET` ou secret do
 *   Supabase.
 * - **Reversível, não hash.** O reprocessamento retroativo (C2.5) precisa da
 *   chave de acesso em texto puro para consultar a SEFAZ de novo — por isso é
 *   cifra (AES-256-GCM), não um hash unidirecional. A idempotência (que
 *   PRECISA de comparação por igualdade, impossível com IV aleatório) usa uma
 *   coluna de HASH determinístico à parte (`hashChavePool`, `persistencia/tipos.ts`)
 *   — nunca o blob cifrado.
 * - **Versão embutida no blob, não em coluna própria.** Cada valor cifrado é
 *   `"<versao>:<iv-base64>:<tag-base64>:<cifrado-base64>"`. A versão viaja
 *   DENTRO do texto armazenado — decifrar não depende de nenhuma outra coluna
 *   nem de saber "quando" a linha foi escrita, o que é o que torna a rotação
 *   sem downtime possível: linhas antigas e novas convivem na mesma coluna.
 * - **Ausência de chave é erro tardio, não erro de boot.** `criarCifra` NUNCA
 *   lança na ausência de `chaveAtual` — só quando `cifrar`/`decifrar` são de
 *   fato chamados. Isso deixa o processo inteiro (servidor HTTP, jobs que não
 *   tocam `cupom`/`item_cupom`) de pé mesmo sem a variável configurada; só o
 *   caminho que PRECISA da cifra falha, e falha alto (erro claro, não
 *   degradação silenciosa para texto puro). É assim que a cifra pode existir
 *   no código e no schema SEM estar "ligada de verdade" em produção (gate da
 *   Fase 3, docs/19 §8) sem derrubar `npm run dev`/jobs não-relacionados.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Cifra {
  /** Cifra texto puro → blob opaco (`"<versao>:<iv>:<tag>:<cifrado>"`, base64). */
  cifrar(textoPuro: string): string;
  /** Decifra um blob produzido por `cifrar` (de QUALQUER versão configurada) → texto puro. */
  decifrar(blob: string): string;
}

const ALGORITMO = 'aes-256-gcm';
/** 12 bytes é o tamanho de IV recomendado para GCM (NIST SP 800-38D). */
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32; // AES-256

interface ChaveVersionada {
  versao: string;
  chave: Buffer;
}

/**
 * `"<versao>:<chave-base64>"` → par (versão, chave de 32 bytes). O formato é o
 * mesmo para `CIFRA_CHAVE_ATUAL` e `CIFRA_CHAVE_ANTERIOR` — só muda o papel.
 */
function parseChaveEnv(valor: string, nomeVar: string): ChaveVersionada {
  const i = valor.indexOf(':');
  if (i <= 0) {
    throw new Error(`${nomeVar}: formato inválido — esperado "<versao>:<chave-base64-32-bytes>".`);
  }
  const versao = valor.slice(0, i);
  const chave = Buffer.from(valor.slice(i + 1), 'base64');
  if (chave.length !== TAMANHO_CHAVE) {
    throw new Error(
      `${nomeVar}: chave decodificada tem ${chave.length} bytes — esperado ${TAMANHO_CHAVE} (AES-256). ` +
        'Gere com `gerarChaveAleatoria()` ou `openssl rand -base64 32`.',
    );
  }
  return { versao, chave };
}

/** Monta o par (versão, chave) sempre que `cifrar`/`decifrar` for chamado sem chave configurada. */
function semChaveConfigurada(): never {
  throw new Error(
    'Cifra indisponível: CIFRA_CHAVE_ATUAL não está definida (docs/19 §8). ' +
      'A coluna espera um valor cifrado — sem a chave-mestra no ambiente, o backend não pode ' +
      'escrever nem ler chave_acesso_cifrada/descricao_cifrada. Isto é esperado enquanto a cifra ' +
      'não foi "ligada de verdade" (gate da Fase 3); qualquer caminho que precise dela deve falhar ' +
      'alto, nunca gravar/ler texto puro como se estivesse cifrado.',
  );
}

export interface OpcoesCifra {
  /** `CIFRA_CHAVE_ATUAL` — usada para CIFRAR sempre, e para decifrar blobs da própria versão. */
  chaveAtual?: string;
  /**
   * `CIFRA_CHAVE_ANTERIOR` — só usada para DECIFRAR blobs gravados antes da
   * rotação. Nunca cifra nada de novo. Ausente fora de uma janela de rotação.
   */
  chaveAnterior?: string;
}

/**
 * Fábrica da cifra. Nunca lança por causa de chave ausente/malformada AQUI —
 * só quando o retorno é efetivamente usado (`cifrar`/`decifrar`), para não
 * derrubar processos que nunca tocam as colunas cifradas (ver o comentário de
 * topo do arquivo). Chave malformada (tamanho errado, separador ausente) É
 * validada eagerly, porque é um erro de configuração e não de "feature desligada".
 */
export function criarCifra(opcoes: OpcoesCifra): Cifra {
  if (!opcoes.chaveAtual) {
    return { cifrar: semChaveConfigurada, decifrar: semChaveConfigurada };
  }

  const atual = parseChaveEnv(opcoes.chaveAtual, 'CIFRA_CHAVE_ATUAL');
  const porVersao = new Map<string, Buffer>([[atual.versao, atual.chave]]);
  if (opcoes.chaveAnterior) {
    const anterior = parseChaveEnv(opcoes.chaveAnterior, 'CIFRA_CHAVE_ANTERIOR');
    if (anterior.versao === atual.versao) {
      throw new Error(
        'CIFRA_CHAVE_ANTERIOR tem a MESMA versão de CIFRA_CHAVE_ATUAL — durante a rotação as ' +
          'duas precisam ter identificadores de versão distintos (docs/19 §8).',
      );
    }
    porVersao.set(anterior.versao, anterior.chave);
  }

  return {
    cifrar(textoPuro: string): string {
      const iv = randomBytes(TAMANHO_IV);
      const cipher = createCipheriv(ALGORITMO, atual.chave, iv);
      const cifrado = Buffer.concat([cipher.update(textoPuro, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        atual.versao,
        iv.toString('base64'),
        tag.toString('base64'),
        cifrado.toString('base64'),
      ].join(':');
    },
    decifrar(blob: string): string {
      const partes = blob.split(':');
      if (partes.length !== 4) {
        throw new Error(
          'Blob cifrado em formato inesperado (esperado 4 segmentos separados por ":").',
        );
      }
      const [versao, ivB64, tagB64, cifradoB64] = partes as [string, string, string, string];
      const chave = porVersao.get(versao);
      if (!chave) {
        throw new Error(
          `Nenhuma chave disponível para a versão "${versao}" deste valor cifrado — configure ` +
            'CIFRA_CHAVE_ANTERIOR com essa versão durante a rotação (docs/19 §8).',
        );
      }
      const decipher = createDecipheriv(ALGORITMO, chave, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const decifrado = Buffer.concat([
        decipher.update(Buffer.from(cifradoB64, 'base64')),
        decipher.final(),
      ]);
      return decifrado.toString('utf8');
    },
  };
}

/**
 * Gera uma chave nova no formato aceito por `CIFRA_CHAVE_ATUAL`/`CIFRA_CHAVE_ANTERIOR`
 * (`"<versao>:<chave-base64-32-bytes>"`). Utilitário do PASSO 1 do procedimento
 * de rotação (docs/19 §8) — não é usado em runtime, só por quem vai operar a
 * rotação manualmente (`node -e` ou um script ad-hoc).
 */
export function gerarChaveEnv(versao: string): string {
  if (!versao) throw new Error('gerarChaveEnv: versão não pode ser vazia.');
  return `${versao}:${randomBytes(TAMANHO_CHAVE).toString('base64')}`;
}
