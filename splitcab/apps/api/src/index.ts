import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config);
const { app, rides, worker } = await buildApp({ config, db });

await migrate(db, (msg) => app.log.info(msg));

const timers: NodeJS.Timeout[] = [];
if (config.RUN_WORKER) {
  worker.start(1000);
  const every = (ms: number, name: string, fn: () => Promise<void>) => {
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        app.log.error({ err }, `${name} failed`);
      } finally {
        busy = false;
      }
    }, ms);
    t.unref();
    timers.push(t);
  };
  every(15_000, 'sweep', () => rides.sweep());
  every(6 * 3_600_000, 'purge', () => rides.purgeOldData());
}

await app.listen({ port: config.PORT, host: config.HOST });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, shutting down`);
  timers.forEach(clearInterval);
  await app.close();
  await worker.stop();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
