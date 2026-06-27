import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{shared,backend}/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['{shared,backend}/src/**/*.ts'],
    },
  },
});
