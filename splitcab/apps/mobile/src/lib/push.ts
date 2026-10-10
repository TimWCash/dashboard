import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Sends this device's push token to the API. Only shows the permission prompt when `ask` is true, so we
// can ask at a moment that makes sense (after posting a trip) and stay quiet on launch.
export async function registerForPush(ask: boolean): Promise<boolean> {
  if (!Device.isDevice) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rides', {
      name: 'Rides and matches',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return false;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.patch('/v1/me', { pushToken: token });
  return true;
}

// Opens the right screen when someone taps a notification, and refreshes data when one arrives.
export function listenForNotifications(onAnyNotification: () => void) {
  const open = (data: Record<string, unknown> | undefined) => {
    const tripId = typeof data?.tripId === 'string' ? data.tripId : null;
    const matchId = typeof data?.matchId === 'string' ? data.matchId : null;
    if (data?.kind === 'new_message' && matchId && tripId) router.push({ pathname: '/chat/[matchId]', params: { matchId, tripId } });
    else if (tripId) router.push({ pathname: '/trip/[id]', params: { id: tripId } });
  };

  const received = Notifications.addNotificationReceivedListener(() => onAnyNotification());
  const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
    onAnyNotification();
    open(response.notification.request.content.data);
  });
  // A tap that launched the app from closed.
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last.notification.request.content.data);

  return () => {
    received.remove();
    tapped.remove();
  };
}
