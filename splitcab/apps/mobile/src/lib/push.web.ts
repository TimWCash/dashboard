// Push notifications are a native feature; the web build polls instead.
export async function registerForPush(_ask: boolean): Promise<boolean> {
  return false;
}

export function listenForNotifications(_onAnyNotification: () => void) {
  return () => {};
}
