import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `app` entra para os módulos PUROS (sem React Native) — ex.: nucleo/formato.
    include: ['{shared,backend,app}/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['{shared,backend}/src/**/*.ts'],
    },
  },
});
