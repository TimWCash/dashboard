import type { AuthResponse, OtpStartResponse } from '@splitcab/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone } from '../auth/phone';
import { withTx } from '../db';
import type { Deps } from '../deps';
import { badRequest, tooMany, unauthorized } from '../errors';
import { authenticate, parse } from '../http';
import { meView } from '../rides/views';
import type { UserRow } from '../rides/rows';

const MAX_CODES_PER_HOUR = 5;
const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export function authRoutes(app: FastifyInstance, deps: Deps) {
  async function issue(userId: string, user: UserRow): Promise<AuthResponse> {
    const access = await deps.tokens.signAccess(userId);
    const refreshToken = await deps.tokens.issueRefresh(deps.db, userId);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken, user: meView(user) };
  }

  app.post('/v1/auth/otp/start', strict, async (req): Promise<OtpStartResponse> => {
    const { phone: raw } = parse(z.object({ phone: z.string().max(32) }), req.body);
    const phone = normalizePhone(raw);
    const now = deps.clock();
    const { rows } = await deps.db.query<{ n: number }>('SELECT count(*)::int AS n FROM otp_requests WHERE phone = $1 AND created_at > $2', [
      phone,
      new Date(now - 3_600_000),
    ]);
    if ((rows[0]?.n ?? 0) >= MAX_CODES_PER_HOUR) throw tooMany('Too many codes requested for this number. Try again in an hour.');
    await deps.db.query('INSERT INTO otp_requests (phone, created_at) VALUES ($1, $2)', [phone, new Date(now)]);
    const { devCode } = await deps.otp.start(phone);
    return { phone, ...(devCode && deps.config.NODE_ENV !== 'production' ? { devCode } : {}) };
  });

  app.post('/v1/auth/otp/verify', strict, async (req): Promise<AuthResponse> => {
    const body = parse(z.object({ phone: z.string().max(32), code: z.string().regex(/^\d{4,8}$/, 'Enter the code from the text message.') }), req.body);
    const phone = normalizePhone(body.phone);
    const ok = await deps.otp.check(phone, body.code);
    if (!ok) throw badRequest('invalid_code', "That code didn't work. Check it and try again, or request a new one.");
    const user = await withTx(deps.db, async (tx) => {
      const { rows } = await tx.query<UserRow>(
        `INSERT INTO users (phone, created_at) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING *`,
        [phone, new Date(deps.clock())],
      );
      return rows[0]!;
    });
    return issue(user.id, user);
  });

  app.post('/v1/auth/refresh', strict, async (req): Promise<AuthResponse> => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    // Deliberately not in a transaction: when an old token is replayed, revoking the session must stick
    // even though the request fails. rotateRefresh claims tokens with a conditional update instead.
    const rotated = await deps.tokens.rotateRefresh(deps.db, refreshToken);
    const { rows } = await deps.db.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [rotated.userId]);
    const user = rows[0];
    if (!user) throw unauthorized('This account has been deleted.');
    const access = await deps.tokens.signAccess(user.id);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: rotated.refreshToken, user: meView(user) };
  });

  app.post('/v1/auth/logout', { preHandler: authenticate(deps) }, async (req, reply) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().max(200).optional() }), req.body);
    if (refreshToken) await deps.tokens.revokeRefresh(deps.db, refreshToken);
    await deps.db.query('UPDATE users SET push_token = NULL WHERE id = $1', [req.userId]);
    return reply.status(204).send();
  });
}
