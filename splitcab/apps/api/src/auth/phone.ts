import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { badRequest } from '../errors';

// Accepts local Irish formats ("087 123 4567") and international ones ("+44 7700 900123"), returns E.164.
export function normalizePhone(input: string): string {
  const parsed = parsePhoneNumberFromString(input.trim(), 'IE');
  if (!parsed || !parsed.isValid()) throw badRequest('invalid_phone', 'Enter a valid mobile number, for example 087 123 4567.');
  return parsed.number;
}

// For logs and support views: +353 87 ••• 4567.
export function maskPhone(e164: string): string {
  return e164.length > 7 ? `${e164.slice(0, -7)}•••${e164.slice(-4)}` : '•••';
}
