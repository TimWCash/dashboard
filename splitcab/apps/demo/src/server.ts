// Runs the real SplitCab API inside the browser, so the app can be tried with no server. Requests the app
// makes to DEMO_API_URL are answered here, from an in-browser Postgres (PGlite) saved in IndexedDB.
// Payments use the test gateway, sign-in codes are shown on screen, and every trip is matched with a
// pretend traveller (the store review companion), since there's nobody else in a browser to match with.
import { PGlite } from '@electric-sql/pglite';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import migrations from 'virtual:migrations';
import { TokenService } from '../../api/src/auth/tokens';
import { loadConfig } from '../../api/src/config';
import type { Db } from '../../api/src/db';
import type { Deps } from '../../api/src/deps';
import { registerErrorHandler } from '../../api/src/http';
import { createJobHandlers } from '../../api/src/jobs/handlers';
import { JobWorker } from '../../api/src/jobs/queue';
import { DevOtp } from '../../api/src/providers/otp';
import { TestGateway } from '../../api/src/providers/payments';
import { BuiltinPlaces } from '../../api/src/providers/places';
import { MemoryPush } from '../../api/src/providers/push';
import { RideService } from '../../api/src/rides/service';
import { authRoutes } from '../../api/src/routes/auth';
import { meRoutes } from '../../api/src/routes/me';
import { rideRoutes } from '../../api/src/routes/rides';
import { DemoApp, type Logger } from './router';

export const DEMO_API_URL = 'https://api.splitcab.demo';

// Visitors can jump ahead to after the ride instead of waiting for it. The page's clock moves forward for the
// app and the API alike, and stays moved after a reload.
const CLOCK_KEY = 'splitcab-demo-clock-offset';
const RealDate = Date;
let clockOffset = 0;
try {
  clockOffset = Number(localStorage.getItem(CLOCK_KEY)) || 0;
} catch {}
if (clockOffset) {
  const ShiftedDate = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(RealDate.now() + clockOffset).toString();
    return args.length ? new (RealDate as unknown as new (...a: unknown[]) => Date)(...args) : new RealDate(RealDate.now() + clockOffset);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(ShiftedDate, RealDate);
  Object.defineProperty(ShiftedDate, 'prototype', { value: RealDate.prototype });
  ShiftedDate.now = () => RealDate.now() + clockOffset;
  globalThis.Date = ShiftedDate;
}
Object.assign(globalThis, {
  splitcabDemo: {
    skipTo(time: number) {
      try {
        localStorage.setItem(CLOCK_KEY, String(Math.max(clockOffset, clockOffset + time - Date.now())));
      } catch {}
      location.reload();
    },
  },
});

const log: Logger = {
  level: 'warn',
  fatal: console.error,
  error: console.error,
  warn: console.warn,
  info: () => {},
  debug: () => {},
  trace: () => {},
  silent: () => {},
  child: () => log,
};

// node-postgres's interface, on top of PGlite. Requests run one at a time (see `serial`), so a single
// connection is enough and transactions never interleave.
class BrowserDb {
  constructor(private pg: PGlite) {}

  async query<T>(text: string, params: unknown[] = []) {
    const result = await this.pg.query<T>(text, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }
}

async function migrate(pg: PGlite) {
  await pg.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pg.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const { name, sql } of migrations) {
    if (done.has(name)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
  }
  // Everyone in the demo gets the review account's pretend travel partner.
  await pg.exec(`
    CREATE OR REPLACE FUNCTION demo_partner() RETURNS trigger AS $$
    BEGIN NEW.is_reviewer := NOT NEW.is_demo; RETURN NEW; END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS demo_partner ON users;
    CREATE TRIGGER demo_partner BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION demo_partner();
  `);
}

async function boot() {
  const pg = await PGlite.create('idb://splitcab-demo', { parsers: { 20: (value: string) => Number(value) } });
  await migrate(pg);

  const config = loadConfig({
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'pglite://splitcab-demo',
    // Everything runs in the visitor's own browser, so there's nothing for this secret to protect.
    JWT_SECRET: 'splitcab-browser-demo-only-not-a-real-secret',
    OTP_PROVIDER: 'dev',
    PAYMENTS_PROVIDER: 'test',
    PLACES_PROVIDER: 'builtin',
    PUSH_PROVIDER: 'log',
  });
  const clock = () => Date.now();
  const deps: Deps = {
    config,
    db: new BrowserDb(pg) as unknown as Db,
    clock,
    log: log as unknown as FastifyBaseLogger,
    tokens: new TokenService(config, clock),
    otp: new DevOtp(),
    payments: new TestGateway(),
    push: new MemoryPush(),
    places: new BuiltinPlaces(),
  };
  const rides = new RideService(deps);
  const worker = new JobWorker(deps, createJobHandlers(deps, rides));

  const app = new DemoApp(log);
  const fastify = app as unknown as FastifyInstance;
  registerErrorHandler(fastify);
  authRoutes(fastify, deps);
  meRoutes(fastify, deps, rides);
  rideRoutes(fastify, deps, rides);

  // The server's sweeper and job worker, on a timer.
  setInterval(() => {
    serial(async () => {
      await rides.sweep();
      await worker.runDue();
    }).catch((err) => console.error('SplitCab demo: background work failed', err));
  }, 5000);

  return { app, worker };
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const server = boot();
server.catch((err) => console.error('SplitCab demo: could not start', err));

const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(DEMO_API_URL)) return realFetch(input, init);

  const { app, worker } = await server;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  let body: unknown;
  if (typeof init?.body === 'string' && init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      return Response.json({ error: { code: 'bad_request', message: 'Body is not valid JSON.' } }, { status: 400 });
    }
  }
  const { status, payload } = await serial(async () => {
    const result = await app.handle(method, new URL(url), headers, body);
    // Holds are captured and released by background jobs; run them straight away.
    await worker.runDue().catch((err) => console.error('SplitCab demo: job failed', err));
    return result;
  });
  return payload === undefined || status === 204 ? new Response(null, { status }) : Response.json(payload, { status });
};
