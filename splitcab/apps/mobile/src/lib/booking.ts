import type { RouteStopView } from '@splitcab/core';

type Stop = Pick<RouteStopView, 'label' | 'lat' | 'lng'>;

export interface BookingOption {
  id: 'uber' | 'freenow' | 'maps';
  label: string;
  url: string;
  // Whether the other app opens with the trip already filled in.
  prefilled: boolean;
}

const enc = encodeURIComponent;

// Uber's documented universal link: opens the Uber app (or m.uber.com) with pickup and drop-off set.
// Uber deep links take one pickup and one drop-off, so any middle stop is added in the Uber app.
export function uberLink(pickup: Stop, dropoff: Stop): string {
  const clientId = process.env.EXPO_PUBLIC_UBER_CLIENT_ID;
  const params = [
    'action=setPickup',
    clientId ? `client_id=${enc(clientId)}` : null,
    `pickup[latitude]=${pickup.lat}`,
    `pickup[longitude]=${pickup.lng}`,
    `pickup[nickname]=${enc(pickup.label)}`,
    `dropoff[latitude]=${dropoff.lat}`,
    `dropoff[longitude]=${dropoff.lng}`,
    `dropoff[nickname]=${enc(dropoff.label)}`,
  ].filter(Boolean);
  return `https://m.uber.com/ul/?${params.join('&')}`;
}

// Google Maps directions through every stop, to show the driver.
export function mapsRouteLink(route: Stop[]): string {
  const [first, ...rest] = route;
  const last = rest.pop() ?? first!;
  const waypoints = rest.map((s) => `${s.lat},${s.lng}`).join('|');
  return (
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${first!.lat},${first!.lng}` +
    `&destination=${last.lat},${last.lng}${waypoints ? `&waypoints=${enc(waypoints)}` : ''}`
  );
}

export function bookingOptions(route: Stop[]): BookingOption[] {
  const pickup = route[0]!;
  const dropoff = route[route.length - 1]!;
  return [
    { id: 'uber', label: 'Uber', url: uberLink(pickup, dropoff), prefilled: true },
    // FREENOW doesn't publish a deep link format, so this opens FREENOW and the rider enters the pickup.
    { id: 'freenow', label: 'FREENOW', url: process.env.EXPO_PUBLIC_FREENOW_URL ?? 'https://www.free-now.com/ie/', prefilled: false },
    { id: 'maps', label: 'Route for driver', url: mapsRouteLink(route), prefilled: true },
  ];
}
