import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default(false),
  // PEM certificate of the database's certificate authority, for providers whose certificates aren't signed by a
  // public one (Supabase's pooler, for example). Turns on TLS with full verification against it. Line breaks may
  // be written as \n, for hosts whose settings are a single line.
  DATABASE_SSL_CA: z
    .string()
    .optional()
    .transform((pem) => pem?.replace(/\\n/g, '\n')),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Set when DATABASE_URL goes through a transaction-mode pooler (Supabase's port 6543, PgBouncer), which
  // can't keep per-connection settings. Set the timeouts on the database role instead; see the README.
  DATABASE_TRANSACTION_POOLER: bool.default(false),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),

  // Run the background job worker and sweeper in this process. Turn off to run them in a separate process.
  RUN_WORKER: bool.default(true),
  CORS_ORIGINS: z.string().default(''),
  // How many proxies sit in front of the API (1 behind a typical PaaS load balancer). Client IPs for rate limiting
  // come from X-Forwarded-For only through that many hops, so clients can't spoof their address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // ISO country codes whose mobile numbers can sign in.
  ALLOWED_PHONE_COUNTRIES: z
    .string()
    .default('IE,GB')
    .transform((s) => s.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))
    .refine((list) => list.length > 0 && list.every((c) => isSupportedCountry(c)), 'ALLOWED_PHONE_COUNTRIES must list ISO country codes, e.g. IE,GB'),

  // "demo" codes are derived from the number and shown on screen, so any server instance can check them.
  OTP_PROVIDER: z.enum(['twilio', 'dev', 'demo']).default('dev'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  // A fixed number and code for App Store / Play review accounts. Never set these to a real person's number.
  REVIEW_PHONE: z.string().optional(),
  REVIEW_CODE: z.string().regex(/^\d{6}$/).optional(),
  // The public demo: sign-in codes on screen, pretend payments, a pretend travel partner for anyone who isn't
  // matched within DEMO_PARTNER_AFTER_S, and a button to finish a ride early. Never with live Stripe keys.
  DEMO_MODE: bool.default(false),
  DEMO_PARTNER_AFTER_S: z.coerce.number().int().min(0).max(3600).default(45),
  // Who runs the public demo, named in its privacy notice (a person or company). SUPPORT_EMAIL is the contact.
  DEMO_OPERATOR: z.string().trim().min(1).max(120).optional(),
  // Extra words the chat filter rejects, comma-separated.
  BLOCKED_TERMS: z.string().default(''),
  // Where every safety report is announced the moment it's filed: a Slack or Discord webhook, or any service that
  // turns a webhook into an email or phone notification. Without it, reports only reach the log.
  REPORT_ALERT_WEBHOOK_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'REPORT_ALERT_WEBHOOK_URL must be an https:// URL')
    .optional(),

  PAYMENTS_PROVIDER: z.enum(['stripe', 'test']).default('test'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MERCHANT_DISPLAY_NAME: z.string().default('SplitCab'),
  // Printed on receipts: legal name, address and VAT number, e.g. "SplitCab Ltd, 1 Main St, Dublin 2. VAT IE1234567X".
  RECEIPT_COMPANY_DETAILS: z.string().max(300).optional(),

  PLACES_PROVIDER: z.enum(['google', 'builtin']).default('builtin'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  PUSH_PROVIDER: z.enum(['expo', 'log']).default('log'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  TERMS_URL: z.string().url().default('https://splitcab.ie/terms'),
  // Version of the Terms of Service and Privacy Policy. Change it when either changes, and everyone is asked to
  // agree to the new version before their next trip. Their agreement is recorded with the version.
  TERMS_VERSION: z.string().min(1).max(40).default('2026-10-12'),
  PRIVACY_URL: z.string().url().default('https://splitcab.ie/privacy'),
  SUPPORT_EMAIL: z.string().email().default('support@splitcab.ie'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // A setting left blank (`REVIEW_CODE=` in a .env file) means unset, not an empty value to validate.
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = schema.safeParse(set);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  const problems: string[] = [];
  if (c.OTP_PROVIDER === 'twilio' && !(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_VERIFY_SERVICE_SID)) {
    problems.push('OTP_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID');
  }
  if (c.PAYMENTS_PROVIDER === 'stripe' && !(c.STRIPE_SECRET_KEY && c.STRIPE_PUBLISHABLE_KEY && c.STRIPE_WEBHOOK_SECRET)) {
    problems.push('PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET');
  }
  if (c.PLACES_PROVIDER === 'google' && !c.GOOGLE_MAPS_API_KEY) problems.push('PLACES_PROVIDER=google needs GOOGLE_MAPS_API_KEY');
  if (Boolean(c.REVIEW_PHONE) !== Boolean(c.REVIEW_CODE)) problems.push('Set both REVIEW_PHONE and REVIEW_CODE, or neither');
  if (c.REVIEW_PHONE) {
    const parsed = parsePhoneNumberFromString(c.REVIEW_PHONE, 'IE');
    if (!parsed?.isValid()) problems.push('REVIEW_PHONE is not a valid phone number');
    else if (!c.ALLOWED_PHONE_COUNTRIES.some((cc) => getCountryCallingCode(cc as CountryCode) === parsed.countryCallingCode)) {
      problems.push('REVIEW_PHONE must be from ALLOWED_PHONE_COUNTRIES');
    }
    else c.REVIEW_PHONE = parsed.number;
  }
  if (c.DEMO_MODE) {
    if (c.PAYMENTS_PROVIDER !== 'test' || c.STRIPE_SECRET_KEY?.startsWith('sk_live_')) problems.push('DEMO_MODE only runs with PAYMENTS_PROVIDER=test');
    if (c.OTP_PROVIDER === 'twilio') problems.push('DEMO_MODE shows sign-in codes on screen, so it must not use OTP_PROVIDER=twilio');
  }
  if (c.OTP_PROVIDER === 'demo' && !c.DEMO_MODE) problems.push('OTP_PROVIDER=demo needs DEMO_MODE=true');
  if (c.NODE_ENV === 'production' && !c.DEMO_MODE) {
    // Development stand-ins must never reach real users.
    if (c.OTP_PROVIDER !== 'twilio') problems.push('Production requires OTP_PROVIDER=twilio');
    if (c.PAYMENTS_PROVIDER !== 'stripe') problems.push('Production requires PAYMENTS_PROVIDER=stripe');
    if (c.PUSH_PROVIDER !== 'expo') problems.push('Production requires PUSH_PROVIDER=expo');
    if (c.STRIPE_SECRET_KEY?.startsWith('sk_test_')) problems.push('Production is using a Stripe test key');
    // Someone has to hear about a safety report as soon as it's made.
    if (!c.REPORT_ALERT_WEBHOOK_URL) problems.push('Production requires REPORT_ALERT_WEBHOOK_URL');
  }
  if (c.NODE_ENV === 'production') {
    // Guessing wrong either way breaks rate limiting: too few hops and every request shares the load balancer's
    // address; too many and clients can pick their own.
    if (env.TRUST_PROXY_HOPS === undefined) problems.push('Production requires TRUST_PROXY_HOPS (0 if clients connect directly, 1 behind one load balancer)');
  }
  if (problems.length) throw new Error(`Invalid configuration:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  return c;
}
