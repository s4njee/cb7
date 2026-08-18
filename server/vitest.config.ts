import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.vite', 'dist'],
    // The Postgres-backed suites all share one test database and TRUNCATE it
    // from parallel workers, which races across files (cross-file FK errors,
    // "pool already ended"). Serialize the run when a test DB is configured;
    // plain suites keep full parallelism.
    fileParallelism: !process.env.CB8_TEST_DATABASE_URL,
  },
});
