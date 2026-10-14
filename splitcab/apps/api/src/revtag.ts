import { badRequest } from './errors';

// Revolut usernames ("Revtags") are 3 to 16 letters and digits. People type them with an @, or paste their
// revolut.me link, so both are accepted. An empty value removes it.
export function normalizeRevtag(input: string): string | null {
  const tag = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?revolut\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!tag) return null;
  if (!/^[a-z0-9]{3,16}$/.test(tag)) throw badRequest('invalid_revtag', 'Enter your Revtag as it appears in Revolut: 3 to 16 letters and numbers.');
  return tag;
}
