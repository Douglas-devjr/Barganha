#!/usr/bin/env node
// Observa o mapa e o código-fonte que o gerador confere, e roda `painel` de novo
// a cada mudança. Não substitui `npm run painel:conferir` no CI — é só
// conveniência de desenvolvimento local.
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

const ALVOS = [
  'painel/mapa.mjs',
  'app/src',
  'backend/src',
  'shared/src',
  'supabase/migrations',
  'docs',
];

function gerar() {
  const hora = new Date().toLocaleTimeString('pt-BR');
  try {
    execFileSync('node', ['painel/gerar.mjs'], { cwd: RAIZ, stdio: 'inherit' });
    console.log(`[painel] atualizado às ${hora}`);
  } catch {
    console.log(`[painel] falhou ao gerar às ${hora} — veja o erro acima`);
  }
}

let pendente = null;
function agendar() {
  clearTimeout(pendente);
  pendente = setTimeout(gerar, 300);
}

console.log('[painel] observando mudanças — Ctrl+C para sair');
gerar();

for (const alvo of ALVOS) {
  const abs = path.join(RAIZ, alvo);
  if (!fs.existsSync(abs)) continue;
  fs.watch(abs, { recursive: true }, agendar);
}
