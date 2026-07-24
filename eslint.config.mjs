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
      'app/src/design_handoff_barganha_2a/**',
      'app/src/design_handoff_barganha_3a/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
