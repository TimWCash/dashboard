import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AppConfig } from '../config';
import type { Queryable } from '../db';
import { unauthorized } from '../errors';

const ISSUER = 'splitcab-api';
const AUDIENCE = 'splitcab-app';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export class TokenService {
  private key: Uint8Array;

  constructor(
    private config: Pick<AppConfig, 'JWT_SECRET' | 'ACCESS_TOKEN_TTL_MIN' | 'REFRESH_TOKEN_TTL_DAYS'>,
    private clock: () => number,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  async signAccess(userId: string) {
    const now = Math.floor(this.clock() / 1000);
    const exp = now + this.config.ACCESS_TOKEN_TTL_MIN * 60;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: new Date(this.clock()),
      });
      if (!payload.sub) throw new Error('missing subject');
      return payload.sub;
    } catch {
      throw unauthorized();
    }
  }

  // Opaque refresh tokens, stored hashed. Each use rotates to a new token in the same family; presenting a
  // token that was already rotated means it leaked, so the whole family is revoked.
  async issueRefresh(q: Queryable, userId: string, familyId: string = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.clock() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await q.query('INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      sha256(token),
      familyId,
      expiresAt,
      new Date(this.clock()),
    ]);
    return token;
  }

  async rotateRefresh(q: Queryable, token: string): Promise<{ userId: string; refreshToken: string }> {
    const now = new Date(this.clock());
    const { rows } = await q.query<{ id: string; user_id: string; family_id: string; expires_at: Date; used_at: Date | null; revoked_at: Date | null }>(
      'SELECT id, user_id, family_id, expires_at, used_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [sha256(token)],
    );
    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at <= now) throw unauthorized();
    if (row.used_at) {
      await q.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id, now]);
      throw unauthorized();
    }
    // Conditional update so two concurrent refreshes with the same token can't both succeed.
    const claimed = await q.query('UPDATE refresh_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL', [row.id, now]);
    if (claimed.rowCount !== 1) throw unauthorized();
    const refreshToken = await this.issueRefresh(q, row.user_id, row.family_id);
    return { userId: row.user_id, refreshToken };
  }

  async revokeRefresh(q: Queryable, token: string) {
    await q.query(
      `UPDATE refresh_tokens SET revoked_at = $2
       WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
      [sha256(token), new Date(this.clock())],
    );
  }
}
