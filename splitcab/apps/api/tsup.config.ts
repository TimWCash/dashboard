import { defineConfig } from 'tsup';

// Bundles the API and the shared core into one file; npm dependencies stay external.
export default defineConfig({
  entry: ['src/index.ts', 'src/migrate-cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@splitcab/core'],
});
