// Builds the public demo. Two versions:
//   npm run demo:build         The app with the API running in the page (PGlite). One person, no server:
//                              a static site in apps/demo/dist.
//   npm run demo:build:server  The app plus the API as a Vercel Function on a real database, so two people
//                              can match each other. Writes Vercel's Build Output API format to
//                              splitcab/.vercel/output; see ../../vercel.json and docs in the README.
//   npm run demo:build:vercel  What Vercel runs: the shared version when the project has a DATABASE_URL,
//                              otherwise the one-person version, both in the Build Output API format.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const api = path.resolve(here, '../api');
const mobile = path.resolve(here, '../mobile');
const vercel = process.argv.includes('--vercel');
const server = process.argv.includes('--server') || (vercel && Boolean(process.env.DATABASE_URL));
const IN_PAGE_API_URL = 'https://api.splitcab.demo';

const out = server || vercel ? path.join(root, '.vercel/output') : path.join(here, 'dist');
const staticDir = server || vercel ? path.join(out, 'static') : out;
await rm(out, { recursive: true, force: true });

// The SQL migrations, inlined into whichever bundle runs the API.
const migrationsPlugin = {
  name: 'migrations',
  setup(build) {
    build.onResolve({ filter: /^virtual:migrations$/ }, () => ({ path: 'migrations', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => {
      const dir = path.join(api, 'migrations');
      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      const list = await Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), 'utf8') })));
      return { contents: `export default ${JSON.stringify(list)};`, loader: 'js' };
    });
  },
};

// 1. The app. --clear, because Metro caches inlined EXPO_PUBLIC_ values.
const exported = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', staticDir], {
  cwd: mobile,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_VARIANT: 'production',
    EXPO_OFFLINE: '1',
    EXPO_PUBLIC_DEMO: server ? 'server' : 'browser',
    // "/" means the same site the app is served from.
    EXPO_PUBLIC_API_URL: server ? '/' : IN_PAGE_API_URL,
  },
});
if (exported.status !== 0) process.exit(exported.status ?? 1);

if (server) {
  // 2. The API as one bundled function.
  const fn = path.join(out, 'functions/api.func');
  await mkdir(fn, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(api, 'src/vercel.ts')],
    outfile: path.join(fn, 'index.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // Some dependencies are CommonJS and call require().
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    external: ['pg-native', 'pino-pretty'],
    plugins: [migrationsPlugin],
    logLevel: 'warning',
  });
  await writeFile(
    path.join(fn, '.vc-config.json'),
    // Dublin, next to the database: each request makes several queries.
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30, regions: ['dub1'] }, null, 2),
  );
  console.log(`Demo (shared server) built in ${path.relative(process.cwd(), out)}`);
} else {
  // 2. The API, bundled for the browser. Node-only modules are swapped for small browser versions.
  const shims = { 'node:crypto': 'crypto', 'node:net': 'net', pg: 'pg', stripe: 'stripe' };
  await mkdir(path.join(staticDir, 'demo'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(here, 'src/server.ts')],
    outfile: path.join(staticDir, 'demo/server.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      migrationsPlugin,
      {
        name: 'browser-shims',
        setup(build) {
          build.onResolve({ filter: /^(node:crypto|node:net|pg|stripe)$/ }, (args) => ({ path: path.join(here, 'src/shims', `${shims[args.path]}.ts`) }));
        },
      },
    ],
    logLevel: 'warning',
  });

  // PGlite loads its WebAssembly and data files from next to the bundle.
  const pglite = path.join(here, 'node_modules/@electric-sql/pglite/dist');
  const pgliteDir = (await readdir(pglite).catch(() => null)) ? pglite : path.resolve(here, '../../node_modules/@electric-sql/pglite/dist');
  for (const file of ['pglite.wasm', 'pglite.data', 'initdb.wasm']) await copyFile(path.join(pgliteDir, file), path.join(staticDir, 'demo', file));

  // 3. Load the API before the app, so it's listening when the app makes its first request.
  const index = path.join(staticDir, 'index.html');
  const html = await readFile(index, 'utf8');
  await writeFile(index, html.replace('<script', '<script type="module" src="/demo/server.js"></script><script'));
  console.log(`Demo (in the browser) built in ${path.relative(process.cwd(), out)}`);
}

// Vercel's routing: the API (shared version only), then files, then the app for every other path.
if (server || vercel) {
  const routes = [...(server ? [{ src: '^/v1/(.*)$', dest: '/api?path=$1' }] : []), { handle: 'filesystem' }, { src: '^/(.*)$', dest: '/index.html' }];
  await writeFile(path.join(out, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));
}
