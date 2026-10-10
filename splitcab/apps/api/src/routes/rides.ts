import { REPORT_REASONS, type MessageView, type TripView } from '@splitcab/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps';
import { authenticate, parse, placeSchema, uuidParam } from '../http';
import type { RideService } from '../rides/service';
import { listTripViews, tripViewById } from '../rides/views';

const tripInput = z.object({
  origin: placeSchema,
  destination: placeSchema,
  timeMode: z.enum(['depart', 'arrive']),
  time: z.iso.datetime({ offset: true }),
  flexMin: z.number().int().min(5).max(120),
  seats: z.number().int().min(1).max(3),
});

export function rideRoutes(app: FastifyInstance, deps: Deps, rides: RideService) {
  const auth = { preHandler: authenticate(deps) };
  const view = (userId: string, tripId: string) => tripViewById(deps.db, userId, tripId);

  app.post('/v1/trips', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<TripView> => {
    const tripId = await rides.postTrip(req.userId, parse(tripInput, req.body));
    reply.status(201);
    return view(req.userId, tripId);
  });

  app.get('/v1/trips', auth, async (req): Promise<TripView[]> => {
    const { scope } = parse(z.object({ scope: z.enum(['active', 'past']).default('active') }), req.query);
    return listTripViews(deps.db, req.userId, scope);
  });

  app.get('/v1/trips/:id', auth, async (req): Promise<TripView> => view(req.userId, parse(uuidParam, req.params).id));

  app.post('/v1/trips/:id/payment-confirmed', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    await rides.confirmPayment(req.userId, id);
    return view(req.userId, id);
  });

  app.post('/v1/trips/:id/cancel', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    await rides.cancelTrip(req.userId, id);
    return view(req.userId, id);
  });

  app.post('/v1/matches/:id/respond', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
    return view(req.userId, await rides.respond(req.userId, id, accept));
  });

  app.get('/v1/matches/:id/messages', auth, async (req): Promise<MessageView[]> => {
    const { id } = parse(uuidParam, req.params);
    const { after } = parse(z.object({ after: z.string().max(40).optional() }), req.query);
    return rides.listMessages(req.userId, id, after);
  });

  app.post('/v1/matches/:id/messages', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply): Promise<MessageView> => {
    const { id } = parse(uuidParam, req.params);
    const { text } = parse(z.object({ text: z.string().max(500) }), req.body);
    reply.status(201);
    return rides.sendMessage(req.userId, id, text);
  });

  app.post('/v1/matches/:id/complete', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    const { actualFare } = parse(z.object({ actualFare: z.number().int() }), req.body);
    return view(req.userId, await rides.complete(req.userId, id, actualFare));
  });

  app.post('/v1/matches/:id/rating', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    const { stars } = parse(z.object({ stars: z.number().int().min(1).max(5) }), req.body);
    return view(req.userId, await rides.rate(req.userId, id, stars));
  });

  app.post('/v1/matches/:id/report', auth, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(z.object({ reason: z.enum(REPORT_REASONS), details: z.string().max(1000).optional() }), req.body);
    await rides.report(req.userId, id, body.reason, body.details);
    return reply.status(204).send();
  });

  app.post('/v1/matches/:id/block', auth, async (req): Promise<TripView> => {
    const { id } = parse(uuidParam, req.params);
    return view(req.userId, await rides.blockPartner(req.userId, id));
  });
}
