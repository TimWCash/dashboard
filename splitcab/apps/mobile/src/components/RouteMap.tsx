import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, type LatLng } from 'react-native-maps';
import { mapLabel, type MapPoint } from '../lib/mapPoints';
import { radius, useTheme } from '../lib/theme';

// The journey on a map: Apple Maps on iOS, Google Maps on Android (needs GOOGLE_MAPS_ANDROID_API_KEY at build).
// The line joins the stops in order; the taxi's actual road route will differ.
export function RouteMap({ points, height = 180 }: { points: MapPoint[]; height?: number }) {
  const { c } = useTheme();
  const map = useRef<MapView>(null);
  const coords: LatLng[] = useMemo(() => points.map((p) => ({ latitude: p.lat, longitude: p.lng })), [points]);
  const region = useMemo(() => {
    const lats = coords.map((p) => p.latitude);
    const lngs = coords.map((p) => p.longitude);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.6),
    };
  }, [coords]);
  if (!points.length) return null;

  return (
    <View style={[styles.frame, { height, borderColor: c.line }]} accessible accessibilityRole="image" accessibilityLabel={mapLabel(points)}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onMapReady={() => map.current?.fitToCoordinates(coords, { edgePadding: { top: 36, right: 36, bottom: 36, left: 36 }, animated: false })}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        {coords.length > 1 ? <Polyline coordinates={coords} strokeColor="#16181D" strokeWidth={3} lineDashPattern={[8, 6]} /> : null}
        {points.map((p, i) => (
          <Marker key={`${i}-${p.lat}-${p.lng}`} coordinate={coords[i]!} anchor={{ x: 0.5, y: 0.5 }} title={p.label} tracksViewChanges={false}>
            <View style={[styles.dot, p.kind === 'dropoff' && styles.square, { backgroundColor: p.who === 'partner' ? c.accent : '#16181D' }]} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF' },
  square: { borderRadius: 3 },
});
