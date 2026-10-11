import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { mapLabel, type MapPoint } from '../lib/mapPoints';
import { radius, useTheme } from '../lib/theme';

// OpenStreetMap's own tiles are fine for a demo. For production traffic, use a tile provider and set
// EXPO_PUBLIC_MAP_TILES_URL (OpenStreetMap's usage policy asks heavy users to).
const TILES = process.env.EXPO_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// The journey on a map in a browser, drawn with Leaflet. The line joins the stops in order; the taxi's actual
// road route will differ.
export function RouteMap({ points, height = 180 }: { points: MapPoint[]; height?: number }) {
  const { c } = useTheme();
  const el = useRef<View>(null);
  const key = JSON.stringify(points);

  useEffect(() => {
    const node = el.current as unknown as HTMLElement | null;
    if (!node || !points.length) return;
    const map = L.map(node, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    const latlngs = points.map((p) => L.latLng(p.lat, p.lng));
    if (latlngs.length > 1) L.polyline(latlngs, { color: '#16181D', weight: 3, dashArray: '8 6' }).addTo(map);
    points.forEach((p, i) =>
      L.circleMarker(latlngs[i]!, {
        radius: p.kind === 'pickup' ? 8 : 7,
        color: '#FFFFFF',
        weight: 3,
        fillColor: p.who === 'partner' ? c.accent : '#16181D',
        fillOpacity: 1,
      })
        .bindTooltip(p.label)
        .addTo(map),
    );
    map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36], maxZoom: 15 });
    return () => {
      map.remove();
    };
    // Redraw only when the stops change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, c.accent]);

  if (!points.length) return null;
  return (
    <View
      ref={el}
      accessible
      accessibilityRole="image"
      accessibilityLabel={mapLabel(points)}
      style={{ height, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: c.line, zIndex: 0 }}
      testID="route-map"
    />
  );
}
