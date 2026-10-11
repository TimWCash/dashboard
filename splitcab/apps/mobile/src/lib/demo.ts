// True in the browser demo (apps/demo), where the API runs in the page: no texts are sent, no card is
// charged, and the travel partner is pretend.
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

// Moves the demo's clock forward (apps/demo/src/server.ts) so visitors needn't wait for the ride to happen.
export function skipTo(time: number) {
  (globalThis as { splitcabDemo?: { skipTo(time: number): void } }).splitcabDemo?.skipTo(time);
}
