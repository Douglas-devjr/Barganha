import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      // Inclui os handoffs de design (`design/design_handoff_*`): protótipos
      // estáticos de browser, com `support.js` cheio de `innerHTML`/`new
      // Function`. Vivem AQUI, e não em `app/src`, justamente para não se
      // parecerem com código do app numa auditoria — nada no bundle os importa.
      'design/**',
      'supabase/**',
      '**/*.config.{js,cjs,mjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Ferramentas que rodam no Node por linha de comando (gerador do painel).
    files: ['painel/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
  prettier,
);
