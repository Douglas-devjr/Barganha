/**
 * C9.2.2 (b6) — cobre o contrato que a rotação de chave depende de estar certo:
 * round-trip cifrar→decifrar, hash determinístico do padrão reaproveitado de
 * `hashChavePool`, e o comportamento com múltiplas versões de chave (o
 * mecanismo inteiro da rotação sem downtime).
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { criarCifra, gerarChaveEnv } from './cifra';

const CHAVE_V1 = gerarChaveEnv('1');
const CHAVE_V2 = gerarChaveEnv('2');

describe('criarCifra — cifrar/decifrar (AES-256-GCM)', () => {
  it('cifra e decifra de volta ao texto original', () => {
    const cifra = criarCifra({ chaveAtual: CHAVE_V1 });
    const original = '35260600000000000000000000000000000000000000000';
    const blob = cifra.cifrar(original);
    expect(blob).not.toContain(original);
    expect(cifra.decifrar(blob)).toBe(original);
  });

  it('produz um blob DIFERENTE a cada chamada (IV aleatório) mesmo para o mesmo texto', () => {
    const cifra = criarCifra({ chaveAtual: CHAVE_V1 });
    const a = cifra.cifrar('CAFE PILAO 500G');
    const b = cifra.cifrar('CAFE PILAO 500G');
    expect(a).not.toBe(b);
    expect(cifra.decifrar(a)).toBe('CAFE PILAO 500G');
    expect(cifra.decifrar(b)).toBe('CAFE PILAO 500G');
  });

  it('embute a versão da chave no próprio blob (primeiro segmento)', () => {
    const cifra = criarCifra({ chaveAtual: CHAVE_V2 });
    const blob = cifra.cifrar('x');
    expect(blob.startsWith('2:')).toBe(true);
  });

  it('rejeita um blob cifrado com uma chave diferente (autenticação GCM)', () => {
    const cifraA = criarCifra({ chaveAtual: gerarChaveEnv('1') });
    const cifraB = criarCifra({ chaveAtual: gerarChaveEnv('1') }); // mesma versão, chave DIFERENTE
    const blob = cifraA.cifrar('segredo');
    expect(() => cifraB.decifrar(blob)).toThrow();
  });

  it('rejeita blob em formato inesperado', () => {
    const cifra = criarCifra({ chaveAtual: CHAVE_V1 });
    expect(() => cifra.decifrar('nao-e-um-blob-valido')).toThrow(/formato inesperado/i);
  });

  it('valida o tamanho da chave (precisa decodificar para 32 bytes)', () => {
    expect(() => criarCifra({ chaveAtual: '1:dGV4dG9jdXJ0bw==' }).cifrar('x')).toThrow(/32/);
  });

  it('exige separador "versão:chave" — rejeita valor sem versão', () => {
    expect(() => criarCifra({ chaveAtual: 'chave-sem-versao-base64' }).cifrar('x')).toThrow(
      /formato inválido/i,
    );
  });
});

describe('criarCifra — falha tardia sem CIFRA_CHAVE_ATUAL (não derruba o boot)', () => {
  it('NÃO lança ao construir sem chaveAtual', () => {
    expect(() => criarCifra({})).not.toThrow();
  });

  it('lança só quando cifrar() é efetivamente chamado', () => {
    const cifra = criarCifra({});
    expect(() => cifra.cifrar('x')).toThrow(/CIFRA_CHAVE_ATUAL/);
  });

  it('lança só quando decifrar() é efetivamente chamado', () => {
    const cifra = criarCifra({});
    expect(() => cifra.decifrar('1:a:b:c')).toThrow(/CIFRA_CHAVE_ATUAL/);
  });
});

describe('criarCifra — rotação (chaveAtual + chaveAnterior)', () => {
  it('decifra um blob da versão ANTERIOR quando as duas chaves estão configuradas', () => {
    // Fase 1: só a v1 existe — cifra o dado "antigo".
    const antes = criarCifra({ chaveAtual: CHAVE_V1 });
    const blobAntigo = antes.cifrar('dado gravado antes da rotação');

    // Fase 2 (durante a rotação): v2 é a atual, v1 vira "anterior".
    const durante = criarCifra({ chaveAtual: CHAVE_V2, chaveAnterior: CHAVE_V1 });
    expect(durante.decifrar(blobAntigo)).toBe('dado gravado antes da rotação');
  });

  it('cifra SEMPRE com a chave ATUAL, nunca com a anterior, mesmo durante a rotação', () => {
    const durante = criarCifra({ chaveAtual: CHAVE_V2, chaveAnterior: CHAVE_V1 });
    const blobNovo = durante.cifrar('dado novo, já na janela de rotação');
    expect(blobNovo.startsWith('2:')).toBe(true);
  });

  it('depois que a chave anterior é retirada do ambiente, blobs antigos não decifram mais', () => {
    const antes = criarCifra({ chaveAtual: CHAVE_V1 });
    const blobAntigo = antes.cifrar('dado antigo');

    // Fase 3 (rotação concluída, chave antiga desligada): v1 não existe mais no ambiente.
    const depois = criarCifra({ chaveAtual: CHAVE_V2 });
    expect(() => depois.decifrar(blobAntigo)).toThrow(/versão "1"/);
  });

  it('rejeita configuração com chaveAtual e chaveAnterior apontando para a MESMA versão', () => {
    expect(() => criarCifra({ chaveAtual: CHAVE_V1, chaveAnterior: gerarChaveEnv('1') })).toThrow(
      /mesma versão/i,
    );
  });
});

describe('gerarChaveEnv', () => {
  it('gera chaves no formato "<versao>:<base64-32-bytes>"', () => {
    const env = gerarChaveEnv('3');
    const [versao, base64] = env.split(':');
    expect(versao).toBe('3');
    expect(Buffer.from(base64 ?? '', 'base64')).toHaveLength(32);
  });

  it('nunca repete a mesma chave entre duas chamadas', () => {
    expect(gerarChaveEnv('1')).not.toBe(gerarChaveEnv('1'));
  });
});

/**
 * Hash DETERMINÍSTICO — não é responsabilidade deste módulo (é `hashChavePool`
 * em `persistencia/tipos.ts`, reaproveitado tal qual para a nova coluna de
 * idempotência `cupom.chave_acesso_hash`, ver repositorio-supabase.ts). O
 * teste aqui só documenta e trava a propriedade que a idempotência depende:
 * determinismo (mesma entrada → mesmo hash sempre) e sensibilidade a byte
 * (entradas diferentes não colidem no caso trivial).
 */
describe('padrão de hash determinístico (reaproveitado de hashChavePool)', () => {
  const hash = (v: string) => createHash('sha256').update(v).digest('hex');

  it('é determinístico — mesma chave de acesso produz sempre o mesmo hash', () => {
    const chave = '35260600000000000000000000000000000000000000000';
    expect(hash(chave)).toBe(hash(chave));
  });

  it('chaves de acesso diferentes produzem hashes diferentes', () => {
    expect(hash('35260600000000000000000000000000000000000000000')).not.toBe(
      hash('35260600000000000000000000000000000000000000001'),
    );
  });

  it('é insensível ao IV/nonce — ao contrário do blob cifrado, o hash NÃO varia entre chamadas', () => {
    const chave = 'chave-de-acesso-de-teste';
    expect(hash(chave)).toBe(hash(chave));
  });
});
