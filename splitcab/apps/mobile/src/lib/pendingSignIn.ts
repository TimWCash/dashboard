// The number being verified is kept in memory rather than in the route, so a link can't open the code
// screen for someone else's number or show a made-up code.
type Pending = { phone: string; devCode?: string };

let pending: Pending | null = null;

export const pendingSignIn = {
  get: () => pending,
  set: (value: Pending) => {
    // Only development builds show the code, even if a misconfigured server sends one.
    pending = { phone: value.phone, ...(__DEV__ && value.devCode ? { devCode: value.devCode } : {}) };
  },
  clear: () => {
    pending = null;
  },
};
