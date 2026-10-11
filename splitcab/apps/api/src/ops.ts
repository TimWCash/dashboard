import type { Built } from './app';
import { normalizePhone } from './auth/phone';

// Support tools for data requests that arrive by email instead of through the app (GDPR access and erasure).
// Check the person owns the number first; docs/gdpr.md has the steps.

async function userIdByPhone(built: Built, phone: string): Promise<string> {
  const { rows } = await built.deps.db.query<{ id: string }>('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [normalizePhone(phone)]);
  if (!rows[0]) throw new Error(`No account for ${phone}`);
  return rows[0].id;
}

// Exactly what the person would get from Download my data in the app.
export async function exportUser(built: Built, phone: string): Promise<unknown> {
  const { token } = await built.deps.tokens.signAccess(await userIdByPhone(built, phone));
  const res = await built.app.inject({ method: 'GET', url: '/v1/me/export', headers: { authorization: `Bearer ${token}` } });
  if (res.statusCode !== 200) throw new Error(`Export failed (${res.statusCode}): ${res.body}`);
  return res.json();
}

// The same as Delete account in the app: open trips are cancelled and holds released by the job worker.
export async function deleteUser(built: Built, phone: string): Promise<void> {
  await built.rides.deleteAccount(await userIdByPhone(built, phone));
}
