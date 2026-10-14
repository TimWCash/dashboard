import { isIPv6 } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Deps } from './deps';
import { AppError, unauthorized } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value ?? {});
}

export function authenticate(deps: Deps) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const userId = await deps.tokens.verifyAccess(header.slice(7));
    // Access tokens live for minutes, but a deleted account must lose access immediately.
    const { rows } = await deps.db.query<{ last_active_at: Date }>('SELECT last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
    if (!rows[0]) throw unauthorized();
    // Accounts unused for two years are deleted, so note use (at most once a day).
    const now = deps.clock();
    if (rows[0].last_active_at.getTime() < now - 86_400_000) {
      await deps.db.query('UPDATE users SET last_active_at = $2 WHERE id = $1', [userId, new Date(now)]);
    }
    req.userId = userId;
  };
}

// Rate limits count per client. An IPv6 client usually controls a whole /64, so it counts as one.
export function rateLimitKey(ip: string): string {
  const addr = ip.split('%')[0]!;
  if (!isIPv6(addr)) return addr;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return mapped[1]!;
  const [head = '', tail = ''] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // A trailing dotted IPv4 part takes two groups.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups = addr.includes('::') ? [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return reply.status(400).send({ error: { code: 'invalid_request', message: `${where}${issue?.message ?? 'Invalid request.'}` } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      // Fastify's own client errors: malformed JSON, body too large, unsupported media type.
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message ?? 'Bad request.' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } }));
}

export const placeSchema = z.object({
  label: z.string().trim().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const uuidParam = z.object({ id: z.uuid() });
