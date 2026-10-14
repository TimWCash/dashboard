import { CONFIG } from './config';
import type { LatLng } from './types';

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Rough road distance without a routing API.
export function roadKm(a: LatLng, b: LatLng, geo = CONFIG.geo): number {
  return haversineKm(a, b) * geo.circuity;
}

// Slow city streets for the first few km, main roads after that, motorway for long trips.
export function driveMinutes(km: number, geo = CONFIG.geo): number {
  const city = Math.min(km, geo.cityKm);
  const road = Math.min(Math.max(0, km - geo.cityKm), geo.roadKm - geo.cityKm);
  const motorway = Math.max(0, km - geo.roadKm);
  return (city / geo.citySpeedKmh + road / geo.roadSpeedKmh + motorway / geo.motorwaySpeedKmh) * 60;
}

export function walkMinutes(km: number): number {
  return (km / 4.8) * 60;
}

// Degrees of latitude/longitude spanning `km` around a point, for cheap bounding-box prefilters.
export function boxAround(p: LatLng, km: number) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos(rad(p.lat)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
