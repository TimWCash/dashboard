import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { AuthProvider, useAuth } from '../lib/auth';
import { StripeRoot } from '../lib/StripeRoot';
import { useTheme } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      // Don't retry requests the server rejected on purpose.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Refetch when the app comes back to the foreground.
function useAppFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}

function Navigation() {
  const { c, dark } = useTheme();
  const { status } = useAuth();
  useAppFocus();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  const base = dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.ink, border: c.line, primary: c.ink } };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="demo-privacy"
          options={{
            headerShown: true,
            title: 'Privacy',
            presentation: 'modal',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.ink,
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StripeRoot>
            <Navigation />
          </StripeRoot>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
