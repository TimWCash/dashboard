import type { MatchView, TripView } from '@splitcab/core';

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'dropoff';
  // Whose stop it is: yours, your partner's, or shared.
  who: 'you' | 'partner' | 'both';
}

// The journey's stops in order. Before both people accept, the partner's stops have no coordinates and are left
// out, so the map never shows more than the route list does.
export function mapPoints(trip: TripView, match?: MatchView | null): MapPoint[] {
  if (!match) {
    return [
      { ...trip.origin, kind: 'pickup', who: 'you' },
      { ...trip.destination, kind: 'dropoff', who: 'you' },
    ];
  }
  return match.plan.route.flatMap((s) =>
    s.lat === null || s.lng === null
      ? []
      : [{ lat: s.lat, lng: s.lng, label: s.label, kind: s.kind, who: s.you && s.partner ? 'both' : s.you ? 'you' : 'partner' } as MapPoint],
  );
}

export const mapLabel = (points: MapPoint[]) =>
  points.length ? `Map of the journey: ${points.map((p) => `${p.kind === 'pickup' ? 'pick up at' : 'drop off at'} ${p.label}`).join(', then ')}` : 'Map of the journey';
