import type { AppConfig } from '../config';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type PushResult = 'sent' | 'invalid_token';

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

// Expo's push service delivers to both APNs and FCM using the token the app registered.
export class ExpoPush implements PushSender {
  constructor(private accessToken?: string) {}

  async send(message: PushMessage): Promise<PushResult> {
    if (!/^Expo(nent)?PushToken\[.+\]$/.test(message.to)) return 'invalid_token';
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ ...message, sound: 'default', priority: 'high', channelId: 'rides' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Expo push failed (${res.status})`);
    const json = (await res.json()) as { data?: { status: string; details?: { error?: string }; message?: string } };
    const ticket = json.data;
    if (ticket?.status === 'error') {
      if (ticket.details?.error === 'DeviceNotRegistered') return 'invalid_token';
      throw new Error(`Expo push error: ${ticket.message ?? ticket.details?.error ?? 'unknown'}`);
    }
    return 'sent';
  }
}

// Development and tests: records messages instead of sending them.
export class MemoryPush implements PushSender {
  sent: PushMessage[] = [];
  constructor(private log?: (msg: string) => void) {}

  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    this.log?.(`push → ${message.to}: ${message.title} — ${message.body}`);
    return 'sent';
  }
}

export function createPushSender(config: AppConfig, log?: (msg: string) => void): PushSender {
  return config.PUSH_PROVIDER === 'expo' ? new ExpoPush(config.EXPO_ACCESS_TOKEN) : new MemoryPush(log);
}
