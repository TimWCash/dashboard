import { placeById, type AuthResponse, type TripInput, type TripView } from '@splitcab/core';
import type { FastifyInstance } from 'fastify';
import { buildApp, type Built } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool, type Db } from '../src/db';
import { migrate } from '../src/migrate';
import { MemoryPush } from '../src/providers/push';
import { TestGateway, type PaymentGateway } from '../src/providers/payments';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/splitcab_test';
export const MIN = 60_000;
// Tuesday 13 October 2026, 10:00 in Dublin.
export const START = Date.UTC(2026, 9, 13, 9, 0);

let shared: Db | null = null;

export async function testDb(): Promise<Db> {
  if (shared) return shared;
  const db = createPool({ DATABASE_URL: TEST_DB, DATABASE_SSL: false, DATABASE_POOL_MAX: 10 });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  shared = db;
  return db;
}

export async function resetDb(db: Db) {
  const { rows } = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
  await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface Harness extends Built {
  clock: { now: number };
  gateway: TestGateway;
  push: MemoryPush;
  call: (method: string, url: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; json: any }>;
  advance: (ms: number) => void;
  runJobs: () => Promise<number>;
}

export async function harness(db: Db, opts: { payments?: PaymentGateway } = {}): Promise<Harness> {
  const clock = { now: START };
  const gateway = new TestGateway();
  const push = new MemoryPush();
  const config = loadConfig({ DATABASE_URL: TEST_DB, JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256', NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const built = await buildApp({ config, db, clock: () => clock.now, payments: opts.payments ?? gateway, push });
  const app: FastifyInstance = built.app;
  return {
    ...built,
    clock,
    gateway,
    push,
    advance: (ms) => {
      clock.now += ms;
    },
    runJobs: () => built.worker.runDue(),
    call: async (method, url, { token, body, headers = {} } = {}) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
    },
  };
}

let phoneSeq = 1000;

export interface Rider {
  token: string;
  refreshToken: string;
  userId: string;
  phone: string;
}

// Signs up a rider with a profile and a saved (test) card.
export async function rider(h: Harness, name: string, { card = true } = {}): Promise<Rider> {
  const phone = `087 123 ${String(phoneSeq++).padStart(4, '0')}`;
  const start = await h.call('POST', '/v1/auth/otp/start', { body: { phone } });
  if (start.status !== 200) throw new Error(`otp start ${start.status} ${JSON.stringify(start.json)}`);
  const verify = await h.call('POST', '/v1/auth/otp/verify', { body: { phone, code: start.json.devCode } });
  const auth = verify.json as AuthResponse;
  await h.call('PATCH', '/v1/me', { token: auth.accessToken, body: { firstName: name, acceptTerms: true, pushToken: `ExponentPushToken[${name}]` } });
  if (card) {
    await h.call('POST', '/v1/payments/setup', { token: auth.accessToken });
    await h.call('POST', '/v1/payments/method/refresh', { token: auth.accessToken });
  }
  return { token: auth.accessToken, refreshToken: auth.refreshToken, userId: auth.user.id, phone: start.json.phone };
}

export function trip(from: string, to: string, extra: Partial<Omit<TripInput, 'time'>> & { inMin?: number; time?: string } = {}): TripInput {
  const p = (id: string) => {
    const place = placeById(id)!;
    return { label: place.label, lat: place.lat, lng: place.lng };
  };
  const { inMin = 60, ...rest } = extra;
  return {
    origin: p(from),
    destination: p(to),
    timeMode: 'depart',
    time: new Date(START + inMin * MIN).toISOString(),
    flexMin: 30,
    seats: 1,
    ...rest,
  };
}

export async function post(h: Harness, r: Rider, input: TripInput): Promise<TripView> {
  const res = await h.call('POST', '/v1/trips', { token: r.token, body: input });
  if (res.status !== 201) throw new Error(`post trip ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

// Gets a new access token after the clock has moved past its expiry.
export async function refresh(h: Harness, r: Rider): Promise<void> {
  const res = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: r.refreshToken } });
  if (res.status !== 200) throw new Error(`refresh ${res.status} ${JSON.stringify(res.json)}`);
  r.token = res.json.accessToken;
  r.refreshToken = res.json.refreshToken;
}

export async function get(h: Harness, r: Rider, tripId: string): Promise<TripView> {
  const res = await h.call('GET', `/v1/trips/${tripId}`, { token: r.token });
  if (res.status !== 200) throw new Error(`get trip ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}
