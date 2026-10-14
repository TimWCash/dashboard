import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps';
import { handleGatewayEvent } from '../jobs/handlers';
import type { GatewayEvent } from '../providers/payments';
import type { RideService } from '../rides/service';

export function systemRoutes(app: FastifyInstance, deps: Deps, rides: RideService) {
  app.get('/health', async () => ({ ok: true }));

  // Ready only when the database answers, so load balancers hold traffic until then.
  app.get('/ready', async (_req, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  // Stripe webhooks need the exact raw body to verify the signature, so this route gets its own parser.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/v1/webhooks/stripe', { config: { rateLimit: false } }, async (req, reply) => {
      let event: GatewayEvent;
      try {
        event = deps.payments.parseWebhook(req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, 'rejected webhook');
        return reply.status(400).send({ error: { code: 'invalid_signature', message: 'Invalid signature.' } });
      }
      const seen = await deps.db.query('SELECT 1 FROM webhook_events WHERE id = $1', [event.id]);
      if (seen.rowCount) return { received: true, duplicate: true };
      await handleGatewayEvent(deps, rides, event);
      await deps.db.query('INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [event.id]);
      return { received: true };
    });
  });
}
