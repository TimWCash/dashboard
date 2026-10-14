import { createHmac } from 'node:crypto';
import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { badRequest } from '../errors';

// Accepts local Irish formats ("087 123 4567") and international ones ("+44 7700 900123"), returns E.164.
// Only numbers from the allowed countries can sign in, which also keeps SMS costs (and SMS fraud) in check.
export function normalizePhone(input: string, allowedCountries?: readonly string[]): string {
  const parsed = parsePhoneNumberFromString(input.trim(), 'IE');
  if (!parsed || !parsed.isValid()) throw badRequest('invalid_phone', 'Enter a valid mobile number, for example 087 123 4567.');
  // Compared by calling code, so GB also covers +44 numbers in Jersey, Guernsey and the Isle of Man.
  if (allowedCountries && !allowedCountries.some((c) => getCountryCallingCode(c as CountryCode) === parsed.countryCallingCode)) {
    throw badRequest('unsupported_country', 'SplitCab works with Irish and UK mobile numbers for now.');
  }
  return parsed.number;
}

// For logs and support views: +353 87 ••• 4567.
export function maskPhone(e164: string): string {
  return e164.length > 7 ? `${e164.slice(0, -7)}•••${e164.slice(-4)}` : '•••';
}

// A keyed hash of a number, for remembering that a deleted account was paused without keeping the number. Keyed,
// because there are few enough mobile numbers to hash them all and look one up.
export function phoneHash(secret: string, e164: string): string {
  return createHmac('sha256', secret).update(`paused-number:${e164}`).digest('hex');
}
