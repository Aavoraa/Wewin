import { defineConfig } from 'tsup';

// Bundle the API with the internal workspace packages (@wewin/shared, @wewin/db) inlined (D-07).
export default defineConfig({
  entry: ['src/main.ts', 'src/serverless.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@wewin\//],
  external: ['@prisma/client', '.prisma/client', 'argon2', 'pg-boss', 'exceljs', 'bwip-js', 'pino', 'pino-pretty'],
});
