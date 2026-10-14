import type { ReactNode } from 'react';

// On phones the app fills the screen. On the web, WebFrame.web.tsx frames it on wide windows.
export function WebFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
