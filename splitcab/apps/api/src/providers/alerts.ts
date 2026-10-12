import type { AppConfig } from '../config';

// Tells whoever runs SplitCab about a safety report straight away. The message never carries names, numbers or
// what was written in the report: only the reason and an id to look up with the support tool (`ops reports`).
export interface AlertSender {
  send(text: string): Promise<void>;
}

// POSTs to a webhook: a Slack or Discord channel, or any service that turns a webhook into an email or a phone
// notification. Slack and Teams read `text`, Discord reads `content`.
export class WebhookAlerts implements AlertSender {
  constructor(private url: string) {}

  async send(text: string) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
    // A failure is retried by the job queue.
    if (!res.ok) throw new Error(`Alert webhook failed (${res.status})`);
  }
}

// Development and the demo: the alert goes to the log.
export class LogAlerts implements AlertSender {
  constructor(private log: (msg: string) => void) {}

  async send(text: string) {
    this.log(`[safety alert] ${text}`);
  }
}

export class MemoryAlerts implements AlertSender {
  sent: string[] = [];

  async send(text: string) {
    this.sent.push(text);
  }
}

export function createAlertSender(config: AppConfig, log: (msg: string) => void): AlertSender {
  return config.REPORT_ALERT_WEBHOOK_URL ? new WebhookAlerts(config.REPORT_ALERT_WEBHOOK_URL) : new LogAlerts(log);
}
