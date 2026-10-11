import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { listenForNotifications, registerForPush } from '../../lib/push';
import { useTheme } from '../../lib/theme';

export default function AppLayout() {
  const { status, me } = useAuth();
  const { c } = useTheme();
  const qc = useQueryClient();
  const signedIn = status === 'signedIn' && !!me?.profileComplete;

  useEffect(() => {
    if (!signedIn) return;
    // Keep the push token fresh if notifications are already allowed; we ask after the first trip.
    registerForPush(false).catch(() => {});
    return listenForNotifications(() => qc.invalidateQueries());
  }, [signedIn, qc]);

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (!me?.profileComplete) return <Redirect href="/profile" />;

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.ink,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="plan" options={{ presentation: 'modal', title: 'Plan a trip' }} />
      <Stack.Screen name="place-search" options={{ presentation: 'modal', title: 'Search' }} />
      <Stack.Screen name="trip/[id]" options={{ title: 'Your trip' }} />
      <Stack.Screen name="chat/[matchId]" options={{ title: 'Messages' }} />
      <Stack.Screen name="report/[matchId]" options={{ presentation: 'modal', title: 'Safety' }} />
      <Stack.Screen name="payments" options={{ title: 'Payments' }} />
      <Stack.Screen name="how-it-works" options={{ title: 'How SplitCab works' }} />
      <Stack.Screen name="revtag" options={{ presentation: 'modal', title: 'Revolut' }} />
    </Stack>
  );
}
