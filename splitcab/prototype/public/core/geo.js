import { CONFIG } from './config.js';

const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Rough road distance without a routing API. Production should call a directions service.
export function roadKm(a, b, geo = CONFIG.geo) {
  return haversineKm(a, b) * geo.circuity;
}

// Slow city streets for the first few km, main roads after that, motorway for long trips.
export function driveMinutes(km, geo = CONFIG.geo) {
  const city = Math.min(km, geo.cityKm);
  const road = Math.min(Math.max(0, km - geo.cityKm), geo.roadKm - geo.cityKm);
  const motorway = Math.max(0, km - geo.roadKm);
  return ((city / geo.citySpeedKmh) + (road / geo.roadSpeedKmh) + (motorway / geo.motorwaySpeedKmh)) * 60;
}

export function walkMinutes(km) {
  return (km / 4.8) * 60;
}
