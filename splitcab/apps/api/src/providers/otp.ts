import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config';
import { AppError } from '../errors';

// Compares codes in constant time, so response timing can't reveal how many leading digits were right.
function sameCode(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface OtpProvider {
  // Returns a code to show the developer, only for the development provider.
  start(phone: string): Promise<{ devCode?: string }>;
  check(phone: string, code: string): Promise<boolean>;
}

// Twilio Verify sends the SMS, generates the code and enforces its own attempt limits.
export class TwilioVerifyOtp implements OtpProvider {
  constructor(
    private accountSid: string,
    private authToken: string,
    private serviceSid: string,
  ) {}

  private async call(path: string, body: Record<string, string>) {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${this.serviceSid}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string; code?: number; message?: string };
    return { ok: res.ok, status: res.status, data };
  }

  async start(phone: string) {
    const { ok, status, data } = await this.call('Verifications', { To: phone, Channel: 'sms' });
    if (status === 429) throw new AppError(429, 'rate_limited', 'Too many codes requested. Try again in a few minutes.');
    // 60200: invalid parameter (bad number), 60205: SMS not supported for landlines.
    if (data.code === 60200 || data.code === 60205) throw new AppError(400, 'invalid_phone', "That number can't receive text messages.");
    if (!ok) throw new Error(`Twilio Verify start failed (${status}): ${data.message ?? 'unknown error'}`);
    return {};
  }

  async check(phone: string, code: string) {
    const { ok, status, data } = await this.call('VerificationCheck', { To: phone, Code: code });
    // 404 means the verification expired, was already used, or hit its attempt limit.
    if (status === 404) return false;
    if (status === 429) throw new AppError(429, 'rate_limited', 'Too many attempts. Request a new code.');
    if (!ok) throw new Error(`Twilio Verify check failed (${status}): ${data.message ?? 'unknown error'}`);
    return data.status === 'approved';
  }
}

// Local development only: the code is returned to the caller instead of being texted.
export class DevOtp implements OtpProvider {
  private codes = new Map<string, { code: string; expires: number; attempts: number }>();

  async start(phone: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.codes.set(phone, { code, expires: Date.now() + 10 * 60_000, attempts: 0 });
    return { devCode: code };
  }

  async check(phone: string, code: string) {
    const entry = this.codes.get(phone);
    if (!entry || entry.expires < Date.now() || entry.attempts >= 5) return false;
    entry.attempts++;
    if (!sameCode(entry.code, code)) return false;
    this.codes.delete(phone);
    return true;
  }
}

// Lets store reviewers sign in with a fixed number and code, without an SMS.
export class ReviewAccountOtp implements OtpProvider {
  constructor(
    private inner: OtpProvider,
    private reviewPhone: string,
    private reviewCode: string,
  ) {}

  start(phone: string) {
    return phone === this.reviewPhone ? Promise.resolve({}) : this.inner.start(phone);
  }

  check(phone: string, code: string) {
    return phone === this.reviewPhone ? Promise.resolve(sameCode(code, this.reviewCode)) : this.inner.check(phone, code);
  }
}

export function createOtpProvider(config: AppConfig): OtpProvider {
  const base =
    config.OTP_PROVIDER === 'twilio'
      ? new TwilioVerifyOtp(config.TWILIO_ACCOUNT_SID!, config.TWILIO_AUTH_TOKEN!, config.TWILIO_VERIFY_SERVICE_SID!)
      : new DevOtp();
  return config.REVIEW_PHONE && config.REVIEW_CODE ? new ReviewAccountOtp(base, config.REVIEW_PHONE, config.REVIEW_CODE) : base;
}
