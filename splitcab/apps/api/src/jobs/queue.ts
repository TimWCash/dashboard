import type { Queryable } from '../db';
import type { Deps } from '../deps';

export type JobPayloads = {
  'payment.authorize': { paymentId: string };
  'payment.capture': { paymentId: string };
  'payment.cancel': { paymentId: string };
  'payment.refund': { paymentId: string };
  'customer.delete': { customerId: string };
  push: { userId: string; title: string; body: string; data: Record<string, string> };
};
export type JobKind = keyof JobPayloads;

interface JobRow {
  id: number;
  kind: JobKind;
  payload: unknown;
  attempts: number;
}

const MAX_ATTEMPTS = 8;
// A claimed job is invisible for this long; if the worker dies mid-job it runs again afterwards.
const LEASE_MS = 5 * 60_000;

export async function enqueue<K extends JobKind>(q: Queryable, now: number, kind: K, payload: JobPayloads[K], delayMs = 0) {
  await q.query('INSERT INTO jobs (kind, payload, run_at, created_at) VALUES ($1, $2, $3, $4)', [
    kind,
    payload,
    new Date(now + delayMs),
    new Date(now),
  ]);
}

export type JobHandlers = { [K in JobKind]: (payload: JobPayloads[K]) => Promise<void> };

export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private deps: Pick<Deps, 'db' | 'clock' | 'log'>,
    private handlers: JobHandlers,
  ) {}

  // Runs every job that is due right now. Returns how many ran.
  async runDue(limit = 100): Promise<number> {
    let count = 0;
    while (count < limit) {
      const job = await this.claim();
      if (!job) break;
      count++;
      await this.execute(job);
    }
    return count;
  }

  private async claim(): Promise<JobRow | null> {
    const now = this.deps.clock();
    const { rows } = await this.deps.db.query<JobRow>(
      `WITH next AS (
         SELECT id FROM jobs
         WHERE done_at IS NULL AND failed_at IS NULL AND run_at <= $1
         ORDER BY run_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs SET attempts = jobs.attempts + 1, run_at = $2
       FROM next WHERE jobs.id = next.id
       RETURNING jobs.id, jobs.kind, jobs.payload, jobs.attempts`,
      [new Date(now), new Date(now + LEASE_MS)],
    );
    return rows[0] ?? null;
  }

  private async execute(job: JobRow) {
    const handler = this.handlers[job.kind] as (payload: unknown) => Promise<void>;
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      await handler(job.payload);
      await this.deps.db.query('UPDATE jobs SET done_at = $2, last_error = NULL WHERE id = $1', [job.id, new Date(this.deps.clock())]);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const now = this.deps.clock();
      if (job.attempts >= MAX_ATTEMPTS) {
        this.deps.log.error({ jobId: job.id, kind: job.kind, err: message }, 'job failed permanently');
        await this.deps.db.query('UPDATE jobs SET failed_at = $2, last_error = $3 WHERE id = $1', [job.id, new Date(now), message]);
      } else {
        // 20s, 40s, 80s ... capped at an hour.
        const backoff = Math.min(3_600_000, 10_000 * 2 ** job.attempts);
        this.deps.log.warn({ jobId: job.id, kind: job.kind, attempt: job.attempts, err: message }, 'job failed, will retry');
        await this.deps.db.query('UPDATE jobs SET run_at = $2, last_error = $3 WHERE id = $1', [job.id, new Date(now + backoff), message]);
      }
    }
  }

  start(intervalMs = 1000) {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.runDue();
      } catch (err) {
        this.deps.log.error({ err }, 'job worker tick failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Let an in-flight batch finish.
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }
}
