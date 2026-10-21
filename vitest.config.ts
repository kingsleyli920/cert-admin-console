import { defineConfig } from 'vitest/config';

const node = { environment: 'node' as const };
const jsdom = {
  environment: 'jsdom' as const,
  setupFiles: ['web/src/test/setup.ts'],
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'be-unit',
          ...node,
          include: ['server/test/unit/**/*.test.ts', 'shared/src/**/*.test.ts'],
        },
      },
      {
        test: { name: 'be-ft', ...node, include: ['server/test/ft/**/*.test.ts'] },
      },
      {
        test: {
          name: 'be-e2e',
          ...node,
          include: ['server/test/e2e/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'contract',
          ...node,
          include: ['e2e/contract/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'fe-unit',
          ...jsdom,
          include: ['web/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/__tests__/**'],
        },
      },
      {
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'fe-ft',
          ...jsdom,
          include: ['web/src/**/__tests__/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
