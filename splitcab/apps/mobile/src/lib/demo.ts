// Set in the public demo (apps/demo): "browser" when the API runs in the page, "server" when it's shared, so
// two people can match each other. No texts are sent and no card is charged.
const mode = process.env.EXPO_PUBLIC_DEMO;
export const DEMO = mode === 'browser' || mode === 'server';
export const DEMO_SHARED = mode === 'server';
