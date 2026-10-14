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

// ---- safety ----------------------------------------------------------------------------------------------------

export interface ReportLine {
  id: string;
  at: string;
  reason: string;
  details: string | null;
  reporter: string;
  reported: string;
  reportedPaused: boolean;
  openReportsAboutThem: number;
  matchId: string | null;
}

// Reports nobody has dealt with yet, newest first, with what's needed to follow up: who made each one, about whom
// (names and numbers, to contact them), and whether the reported account is paused.
export async function openReports(built: Built): Promise<ReportLine[]> {
  const { rows } = await built.deps.db.query<{
    id: string;
    created_at: Date;
    reason: string;
    details: string | null;
    reporter_name: string | null;
    reporter_phone: string | null;
    reported_name: string | null;
    reported_phone: string | null;
    reported_paused: boolean;
    open_about_them: number;
    match_id: string | null;
  }>(
    `SELECT r.id, r.created_at, r.reason, r.details, r.match_id,
            a.first_name AS reporter_name, a.phone AS reporter_phone,
            b.first_name AS reported_name, b.phone AS reported_phone, b.suspended_at IS NOT NULL AS reported_paused,
            (SELECT count(DISTINCT o.reporter_id)::int FROM reports o WHERE o.reported_id = r.reported_id AND o.resolved_at IS NULL) AS open_about_them
     FROM reports r JOIN users a ON a.id = r.reporter_id JOIN users b ON b.id = r.reported_id
     WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`,
  );
  const who = (name: string | null, phone: string | null) => `${name ?? 'Deleted account'}${phone ? ` (${phone})` : ''}`;
  return rows.map((r) => ({
    id: r.id,
    at: r.created_at.toISOString(),
    reason: r.reason,
    details: r.details,
    reporter: who(r.reporter_name, r.reporter_phone),
    reported: who(r.reported_name, r.reported_phone),
    reportedPaused: r.reported_paused,
    openReportsAboutThem: r.open_about_them,
    matchId: r.match_id,
  }));
}

// Pauses an account: no new trips, matches or messages, and open trips are cancelled with holds released.
export async function suspendUser(built: Built, phone: string, reason: string): Promise<void> {
  await built.rides.suspend(await userIdByPhone(built, phone), reason);
}

// Lifts a pause after looking into the reports, which are then marked as dealt with.
export async function unsuspendUser(built: Built, phone: string): Promise<void> {
  await built.rides.unsuspend(await userIdByPhone(built, phone));
}
