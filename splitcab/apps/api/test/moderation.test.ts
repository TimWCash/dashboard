import { describe, expect, test } from 'vitest';
import { createModerator } from '../src/moderation';

describe('chat filter', () => {
  const moderate = createModerator(['eejit']);

  test('lets ordinary coordination through, including phone numbers', () => {
    for (const text of ["I'm at the Grafton St corner", 'Running 2 mins late, sorry!', 'Call me on 087 123 4567', 'Terminal 1 departures, door 3']) {
      expect(moderate(text)).toEqual({ ok: true });
    }
  });

  test('blocks links, which are mostly payment scams', () => {
    for (const text of ['pay here https://bit.ly/abc', 'go to www.example.com', 'revolut.me/someone', 'check paylink.ie/x']) {
      expect(moderate(text)).toEqual({ ok: false, reason: 'link' });
    }
  });

  test('blocks abusive words, including simple disguises and configured extras', () => {
    for (const text of ['you absolute b1tch', 'F*CK off'.replace('*', 'U'), 'what an eejit']) {
      expect(moderate(text)).toEqual({ ok: false, reason: 'abusive' });
    }
    // Words that merely contain a blocked term are fine.
    expect(moderate('See you in Scunthorpe')).toEqual({ ok: true });
  });
});
