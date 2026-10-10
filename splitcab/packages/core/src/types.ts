export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  label: string;
}

export type TimeMode = 'depart' | 'arrive';

// What the matching engine needs to know about a trip. Times are epoch milliseconds.
export interface TripLike {
  id: string;
  riderId: string;
  origin: Place;
  destination: Place;
  timeMode: TimeMode;
  time: number;
  flexMin: number;
  seats: number;
}

export interface RiderPlan {
  soloFare: number;
  share: number;
  fee: number;
  savings: number;
  detourPct: number;
  pickupAt: number;
  dropoffAt: number;
  walkToPickupMin: number;
  walkFromDropMin: number;
}

export interface RouteStop {
  kind: 'pickup' | 'dropoff';
  tripIds: string[];
  label: string;
  lat: number;
  lng: number;
  at: number;
}

export interface SharedPlan {
  score: number;
  startAt: number;
  fare: number;
  totalKm: number;
  totalMin: number;
  extraStops: number;
  savingsPct: number;
  meetUp: boolean;
  sharedDrop: boolean;
  bookerTripId: string;
  route: RouteStop[];
  riders: Record<string, RiderPlan>;
}
