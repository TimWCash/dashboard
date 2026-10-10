import type { ReactNode } from 'react';

// Stripe's React Native SDK has no web build.
export function StripeRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
