import { router } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TripCard } from '../../../components/ride';
import { AppText, Button, Note } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useConfig, useTrips } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

export default function Trips() {
  const { c } = useTheme();
  const { me } = useAuth();
  const config = useConfig();
  const active = useTrips('active');
  const past = useTrips('past');
  const trips = active.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
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

      {me?.paused ? (
        <Note tone="warn" icon="pause-circle-outline">
          {`Your account is paused while we look into a report, so you can't post trips or send messages. You can still see your trips and settle up. If you think this is a mistake, email ${config.data?.supportEmail ?? 'us'}.`}
        </Note>
      ) : null}
      {active.error ? <Note tone="bad">{active.error.message}</Note> : null}
      {trips.map((t) => (
        <TripCard key={t.id} trip={t} />
      ))}

      {me?.paused ? null : (
        <Button title={trips.length ? 'Plan another trip' : 'Plan a trip'} icon="add" variant={trips.length ? 'ghost' : 'primary'} onPress={() => router.push('/plan')} />
      )}

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
    </SafeAreaView>
  );
}
