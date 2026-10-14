import type { Place, PlaceSuggestion } from '@splitcab/core';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { AppText, Field, Icon, Note, Row } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { updateDraft } from '../../lib/planDraft';
import { space, useTheme } from '../../lib/theme';

export default function PlaceSearch() {
  const { c } = useTheme();
  const { field } = useLocalSearchParams<{ field: 'origin' | 'destination' }>();
  // One session token per search, so the places provider bills autocomplete + details as one lookup.
  const session = useMemo(() => Crypto.randomUUID(), []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await api.get<PlaceSuggestion[]>(`/v1/places/autocomplete?q=${encodeURIComponent(query)}&session=${session}`);
        if (!cancelled) {
          setResults(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Search failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, session]);

  function choose(place: Place) {
    updateDraft({ [field === 'destination' ? 'destination' : 'origin']: place });
    router.back();
  }

  async function pick(s: PlaceSuggestion) {
    try {
      choose(await api.get<Place>(`/v1/places/details?id=${encodeURIComponent(s.id)}&session=${session}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load that place.");
    }
  }

  async function useCurrentLocation() {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setError('Allow location access in Settings to use where you are now.');
      return;
    }
    setLoading(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let label = 'Current location';
      try {
        const [addr] = await Location.reverseGeocodeAsync(pos.coords);
        const street = [addr?.streetNumber, addr?.street].filter(Boolean).join(' ');
        label = street || addr?.name || addr?.district || addr?.city || label;
      } catch {
        // Reverse geocoding isn't available everywhere; the coordinates are what matter.
      }
      choose({ label, lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setError("Couldn't get your location. Try searching instead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: field === 'destination' ? 'Where to?' : 'Pickup point' }} />
      <Field accessibilityLabel="Search for a place" value={query} onChangeText={setQuery} placeholder="Address, place or Eircode" autoFocus autoCorrect={false} testID="place-query" />
      {field !== 'destination' ? (
        <Pressable accessibilityRole="button" onPress={useCurrentLocation} style={{ paddingVertical: space.sm }}>
          <Row gap={space.sm}>
            <Icon name="navigate" size={18} color={c.accentStrong} />
            <AppText variant="body" style={{ fontWeight: '600' }}>
              Use where I am now
            </AppText>
          </Row>
        </Pressable>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
      {loading ? <ActivityIndicator color={c.muted} /> : null}
      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.line }} />}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => pick(item)} style={{ paddingVertical: space.md }} testID={`place-${item.id}`}>
            <AppText variant="body" style={{ fontWeight: '600' }}>
              {item.primary}
            </AppText>
            {item.secondary ? (
              <AppText variant="small" muted>
                {item.secondary}
              </AppText>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          !loading && query.length > 1 ? (
            <AppText variant="small" muted>
              No places found. Try a street name or Eircode.
            </AppText>
          ) : null
        }
      />
    </View>
  );
}
