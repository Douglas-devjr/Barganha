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
      'design/**',
      'supabase/**',
      '**/*.config.{js,cjs,mjs,ts}',
      // Protótipos estáticos dos handoffs de design (não são código do app).
      // Glob por prefixo: cada handoff novo traz o mesmo `support.js` de
      // browser, e listar um a um só era lembrado quando o lint quebrava.
      'app/src/design_handoff_*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
