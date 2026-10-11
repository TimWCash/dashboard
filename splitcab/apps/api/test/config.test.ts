import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';
import { rateLimitKey } from '../src/http';

describe('production configuration', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://db/splitcab',
    JWT_SECRET: 'a-production-secret-that-is-long-enough',
    OTP_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'AC1',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_VERIFY_SERVICE_SID: 'VA1',
    PAYMENTS_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_1',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_1',
    STRIPE_WEBHOOK_SECRET: 'whsec_1',
    PUSH_PROVIDER: 'expo',
  };

  test('needs the proxy hop count to be set explicitly', () => {
    expect(() => loadConfig(production)).toThrow(/TRUST_PROXY_HOPS/);
    expect(loadConfig({ ...production, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
  });

  test('refuses development stand-ins and test keys', () => {
    expect(() => loadConfig({ ...production, TRUST_PROXY_HOPS: '1', OTP_PROVIDER: 'dev' })).toThrow(/OTP_PROVIDER=twilio/);
    expect(() => loadConfig({ ...production, TRUST_PROXY_HOPS: '1', STRIPE_SECRET_KEY: 'sk_test_1' })).toThrow(/test key/);
  });

  test('the review number must be from an allowed country', () => {
    const env = { ...production, TRUST_PROXY_HOPS: '1', REVIEW_CODE: '123456' };
    expect(() => loadConfig({ ...env, REVIEW_PHONE: '+33 6 12 34 56 78' })).toThrow(/ALLOWED_PHONE_COUNTRIES/);
    expect(loadConfig({ ...env, REVIEW_PHONE: '087 000 0001' }).REVIEW_PHONE).toBe('+353870000001');
  });
});

describe('rate limit keys', () => {
  test('IPv4 addresses count on their own, IPv6 addresses by /64', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
    expect(rateLimitKey('2001:0db8:abcd:0012::9')).toBe('2001:db8:abcd:12::/64');
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });
});
