import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

export default function AuthLayout() {
  const { status, me } = useAuth();
  const { c } = useTheme();
  if (status === 'loading') return null;
  if (status === 'signedIn' && me?.profileComplete) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.ink,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerBackVisible: false, gestureEnabled: false }} />
    </Stack>
  );
}
