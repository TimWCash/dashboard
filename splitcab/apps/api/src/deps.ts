import type { FastifyBaseLogger } from 'fastify';
import type { AlertSender } from './providers/alerts';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { OtpProvider } from './providers/otp';
import type { PaymentGateway } from './providers/payments';
import type { PlacesProvider } from './providers/places';
import type { PushSender } from './providers/push';
import type { TokenService } from './auth/tokens';

export interface Deps {
  config: AppConfig;
  db: Db;
  // Current time in epoch ms. Injected so tests can move time forward.
  clock: () => number;
  log: FastifyBaseLogger;
  tokens: TokenService;
  otp: OtpProvider;
  payments: PaymentGateway;
  push: PushSender;
  places: PlacesProvider;
  alerts: AlertSender;
}
