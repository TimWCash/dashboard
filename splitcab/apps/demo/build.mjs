// Builds the browser demo: the app's web build with the API running in the page.
// Output: apps/demo/dist, a static site (see ../../vercel.json).
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '../api');
const mobile = path.resolve(here, '../mobile');
const out = path.join(here, 'dist');
const DEMO_API_URL = 'https://api.splitcab.demo';

// 1. The app, pointed at the in-page API. --clear, because Metro caches inlined EXPO_PUBLIC_ values.
const exported = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', out], {
  cwd: mobile,
  stdio: 'inherit',
  env: { ...process.env, APP_VARIANT: 'production', EXPO_OFFLINE: '1', EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_API_URL: DEMO_API_URL },
});
if (exported.status !== 0) process.exit(exported.status ?? 1);

// 2. The API, bundled for the browser. Node-only modules are swapped for small browser versions.
const shims = { 'node:crypto': 'crypto', 'node:net': 'net', pg: 'pg', stripe: 'stripe' };
const browserShims = {
  name: 'browser-shims',
  setup(build) {
    build.onResolve({ filter: /^(node:crypto|node:net|pg|stripe)$/ }, (args) => ({ path: path.join(here, 'src/shims', `${shims[args.path]}.ts`) }));
    build.onResolve({ filter: /^virtual:migrations$/ }, () => ({ path: 'migrations', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => {
      const dir = path.join(api, 'migrations');
      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      const list = await Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), 'utf8') })));
      return { contents: `export default ${JSON.stringify(list)};`, loader: 'js' };
    });
  },
};
await mkdir(path.join(out, 'demo'), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(here, 'src/server.ts')],
  outfile: path.join(out, 'demo/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [browserShims],
  logLevel: 'warning',
});

// PGlite loads its WebAssembly and data files from next to the bundle.
const pglite = path.join(here, 'node_modules/@electric-sql/pglite/dist');
const pgliteDir = (await readdir(pglite).catch(() => null)) ? pglite : path.resolve(here, '../../node_modules/@electric-sql/pglite/dist');
for (const file of ['pglite.wasm', 'pglite.data', 'initdb.wasm']) await copyFile(path.join(pgliteDir, file), path.join(out, 'demo', file));

// 3. Load the API before the app, so it's listening when the app makes its first request.
const index = path.join(out, 'index.html');
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace('<script', '<script type="module" src="/demo/server.js"></script><script'));
console.log(`Demo built in ${path.relative(process.cwd(), out)}`);
