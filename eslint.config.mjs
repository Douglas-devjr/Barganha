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
      // Protótipo estático do handoff de design (não é código do app).
      'app/src/design_handoff_barganha_2a/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
