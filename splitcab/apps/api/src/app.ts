import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { TokenService } from './auth/tokens';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { Deps } from './deps';
import { registerErrorHandler } from './http';
import { createJobHandlers } from './jobs/handlers';
import { JobWorker } from './jobs/queue';
import { createOtpProvider, type OtpProvider } from './providers/otp';
import { createPaymentGateway, type PaymentGateway } from './providers/payments';
import { createPlacesProvider, type PlacesProvider } from './providers/places';
import { createPushSender, type PushSender } from './providers/push';
import { RideService } from './rides/service';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { rideRoutes } from './routes/rides';
import { systemRoutes } from './routes/system';

export interface BuildOptions {
  config: AppConfig;
  db: Db;
  clock?: () => number;
  otp?: OtpProvider;
  payments?: PaymentGateway;
  push?: PushSender;
  places?: PlacesProvider;
}

export interface Built {
  app: FastifyInstance;
  deps: Deps;
  rides: RideService;
  worker: JobWorker;
}

export async function buildApp(opts: BuildOptions): Promise<Built> {
  const { config } = opts;
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["stripe-signature"]'],
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });

  const clock = opts.clock ?? Date.now;
  const deps: Deps = {
    config,
    db: opts.db,
    clock,
    log: app.log,
    tokens: new TokenService(config, clock),
    otp: opts.otp ?? createOtpProvider(config),
    payments: opts.payments ?? createPaymentGateway(config),
    push: opts.push ?? createPushSender(config, (msg) => app.log.info(msg)),
    places: opts.places ?? createPlacesProvider(config),
  };
  const rides = new RideService(deps);
  const worker = new JobWorker(deps, createJobHandlers(deps, rides));

  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  // The native app doesn't need CORS; allow listed origins for a web build during development.
  await app.register(cors, { origin: origins.length ? origins : false });
  if (config.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.headers.authorization?.slice(-24) ?? req.ip,
    });
  }

  registerErrorHandler(app);
  systemRoutes(app, deps, rides);
  authRoutes(app, deps);
  meRoutes(app, deps, rides);
  rideRoutes(app, deps, rides);

  return { app, deps, rides, worker };
}
