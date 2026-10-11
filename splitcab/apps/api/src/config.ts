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
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

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

  OTP_PROVIDER: z.enum(['twilio', 'dev']).default('dev'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  // A fixed number and code for App Store / Play review accounts. Never set these to a real person's number.
  REVIEW_PHONE: z.string().optional(),
  REVIEW_CODE: z.string().regex(/^\d{6}$/).optional(),
  // Extra words the chat filter rejects, comma-separated.
  BLOCKED_TERMS: z.string().default(''),

  PAYMENTS_PROVIDER: z.enum(['stripe', 'test']).default('test'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MERCHANT_DISPLAY_NAME: z.string().default('SplitCab'),

  PLACES_PROVIDER: z.enum(['google', 'builtin']).default('builtin'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  PUSH_PROVIDER: z.enum(['expo', 'log']).default('log'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  TERMS_URL: z.string().url().default('https://splitcab.ie/terms'),
  PRIVACY_URL: z.string().url().default('https://splitcab.ie/privacy'),
  SUPPORT_EMAIL: z.string().email().default('support@splitcab.ie'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
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
  if (c.NODE_ENV === 'production') {
    // Development stand-ins must never reach real users.
    if (c.OTP_PROVIDER !== 'twilio') problems.push('Production requires OTP_PROVIDER=twilio');
    if (c.PAYMENTS_PROVIDER !== 'stripe') problems.push('Production requires PAYMENTS_PROVIDER=stripe');
    if (c.PUSH_PROVIDER !== 'expo') problems.push('Production requires PUSH_PROVIDER=expo');
    if (c.STRIPE_SECRET_KEY?.startsWith('sk_test_')) problems.push('Production is using a Stripe test key');
    // Guessing wrong either way breaks rate limiting: too few hops and every request shares the load balancer's
    // address; too many and clients can pick their own.
    if (env.TRUST_PROXY_HOPS === undefined) problems.push('Production requires TRUST_PROXY_HOPS (0 if clients connect directly, 1 behind one load balancer)');
  }
  if (problems.length) throw new Error(`Invalid configuration:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  return c;
}
