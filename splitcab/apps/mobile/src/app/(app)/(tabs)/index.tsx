import { formatMoney } from '@splitcab/core';
import { router } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { TripCard } from '../../../components/ride';
import { AppText, Button, Card, Note } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useConfig, useTrips } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

export default function Rides() {
  const { c } = useTheme();
  const { me } = useAuth();
  const active = useTrips('active');
  const past = useTrips('past');
  const config = useConfig();
  const fee = formatMoney(config.data?.matchFee ?? 199);
  const trips = active.data ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={() => (active.refetch(), past.refetch())} />}
    >
      <View style={{ gap: 2 }}>
        <AppText variant="title" accessibilityRole="header">
          {trips.length ? 'Your trips' : `Where to, ${me?.firstName ?? 'traveller'}?`}
        </AppText>
        {!trips.length ? (
          <AppText variant="body" muted>
            Post a trip and we'll look for someone heading the same way.
          </AppText>
        ) : null}
      </View>

      {active.error ? <Note tone="bad">{active.error.message}</Note> : null}
      {trips.map((t) => (
        <TripCard key={t.id} trip={t} />
      ))}

      <Button title={trips.length ? 'Plan another trip' : 'Plan a trip'} icon="add" variant={trips.length ? 'ghost' : 'primary'} onPress={() => router.push('/plan')} />

      {!trips.length && !active.isLoading ? (
        <Card>
          <AppText variant="heading">How it works</AppText>
          <AppText variant="small" muted>
            We place a {fee} hold on your card when you post. If we match you and you both accept, that's your only charge. If not, the hold drops
            off automatically. Your share of the taxi fare is paid to whoever books it.
          </AppText>
        </Card>
      ) : null}

      {past.data?.length ? (
        <View style={{ gap: space.md }}>
          <AppText variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Past trips
          </AppText>
          {past.data.slice(0, 10).map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
