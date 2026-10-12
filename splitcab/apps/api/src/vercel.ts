// Runs the API as a Vercel Function for the public demo (built by apps/demo/build.mjs). Nothing runs between
// requests, so each instance does the sweeper's and job worker's work itself, every few seconds, as requests
// come in. The app polls while a trip is active, so that's often enough.
import type { IncomingMessage, ServerResponse } from 'node:http';
import migrations from 'virtual:migrations';
import { buildApp, type Built } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { applyMigrations } from './migrations';

const TICK_MS = 4000;
const PURGE_MS = 6 * 3_600_000;
let instance: Promise<Built> | null = null;
let lastTick = 0;
let lastPurge = 0;

async function start(): Promise<Built> {
  // NODE_ENV isn't set as a project variable: it would apply to the build too, where npm then skips the build tools.
  const config = loadConfig({ NODE_ENV: 'production', ...process.env });
  const db = createPool(config);
  await applyMigrations(db, migrations);
  const built = await buildApp({ config, db });
  await built.app.ready();
  return built;
}

async function background(built: Built) {
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;
  lastTick = now;
  try {
    await built.rides.sweep();
    await built.worker.runDue();
    if (now - lastPurge > PURGE_MS) {
      lastPurge = now;
      await built.rides.purgeOldData();
    }
  } catch (err) {
    built.app.log.error({ err }, 'background work failed');
  }
}

// The routing config sends /v1/<rest> here as /api?path=<rest>; put back the URL the routes expect.
function restoreUrl(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/v1/')) return;
  const rest = url.searchParams.get('path');
  if (rest === null) return;
  url.searchParams.delete('path');
  const query = url.searchParams.toString();
  req.url = `/v1/${rest}${query ? `?${query}` : ''}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  instance ??= start().catch((err) => {
    instance = null;
    throw err;
  });
  const built = await instance;
  restoreUrl(req);
  await background(built);
  built.app.server.emit('request', req, res);
}
