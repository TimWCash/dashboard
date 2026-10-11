export type PushStatus = 'on' | 'askable' | 'blocked' | 'unsupported';

// Push notifications are a native feature; the web build polls instead.
export async function pushStatus(): Promise<PushStatus> {
  return 'unsupported';
}

export async function registerForPush(_ask: boolean): Promise<boolean> {
  return false;
}

export function listenForNotifications(_onAnyNotification: () => void) {
  return () => {};
}
