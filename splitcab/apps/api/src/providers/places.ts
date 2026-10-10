import { placeById, searchKnownPlaces, type Place, type PlaceSuggestion } from '@splitcab/core';
import type { AppConfig } from '../config';
import { notFound } from '../errors';

export interface PlacesProvider {
  readonly kind: 'google' | 'builtin';
  autocomplete(query: string, sessionToken?: string, near?: { lat: number; lng: number }): Promise<PlaceSuggestion[]>;
  details(id: string, sessionToken?: string): Promise<Place>;
}

// Google Places API (New), restricted to Ireland. The key stays on the server.
export class GooglePlaces implements PlacesProvider {
  readonly kind = 'google' as const;
  constructor(private apiKey: string) {}

  async autocomplete(query: string, sessionToken?: string, near?: { lat: number; lng: number }) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        input: query,
        sessionToken,
        includedRegionCodes: ['ie'],
        languageCode: 'en',
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30_000 } } } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Places autocomplete failed (${res.status})`);
    const json = (await res.json()) as {
      suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }[];
    };
    return (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        id: `g:${p.placeId}`,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary: p.structuredFormat?.secondaryText?.text ?? null,
      }));
  }

  async details(id: string, sessionToken?: string) {
    if (!id.startsWith('g:')) return builtinDetails(id);
    const placeId = id.slice(2);
    if (!/^[\w-]+$/.test(placeId)) throw notFound('Place not found.');
    const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    const res = await fetch(url, {
      headers: { 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': 'location,displayName' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) throw notFound('Place not found.');
    if (!res.ok) throw new Error(`Place details failed (${res.status})`);
    const json = (await res.json()) as { location: { latitude: number; longitude: number }; displayName?: { text: string } };
    return { label: json.displayName?.text ?? 'Selected place', lat: json.location.latitude, lng: json.location.longitude };
  }
}

function builtinDetails(id: string): Place {
  const place = placeById(id.replace(/^k:/, ''));
  if (!place) throw notFound('Place not found.');
  return { label: place.label, lat: place.lat, lng: place.lng };
}

// A fixed list of well-known Irish places. Good enough for development and an early pilot.
export class BuiltinPlaces implements PlacesProvider {
  readonly kind = 'builtin' as const;
  async autocomplete(query: string) {
    return searchKnownPlaces(query).map((p) => ({ id: `k:${p.id}`, primary: p.label, secondary: p.group }));
  }
  async details(id: string) {
    return builtinDetails(id);
  }
}

export function createPlacesProvider(config: AppConfig): PlacesProvider {
  return config.PLACES_PROVIDER === 'google' ? new GooglePlaces(config.GOOGLE_MAPS_API_KEY!) : new BuiltinPlaces();
}
