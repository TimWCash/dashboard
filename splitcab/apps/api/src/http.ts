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
    req.userId = await deps.tokens.verifyAccess(header.slice(7));
  };
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
