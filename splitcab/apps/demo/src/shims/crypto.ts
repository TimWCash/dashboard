// The few node:crypto functions the API uses, built on Web Crypto and a pure-JS SHA-256.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const encoder = new TextEncoder();

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`);
  let input = new Uint8Array(0);
  const hash = {
    update(data: string | Uint8Array) {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      const next = new Uint8Array(input.length + bytes.length);
      next.set(input);
      next.set(bytes, input.length);
      input = next;
      return hash;
    },
    digest(encoding: 'hex') {
      if (encoding !== 'hex') throw new Error(`Unsupported digest encoding: ${encoding}`);
      return bytesToHex(sha256(input));
    },
  };
  return hash;
}

export function randomBytes(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return {
    toString(encoding: 'base64url' | 'hex') {
      if (encoding === 'hex') return bytesToHex(bytes);
      return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    },
  };
}

export const randomUUID = () => crypto.randomUUID();

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
