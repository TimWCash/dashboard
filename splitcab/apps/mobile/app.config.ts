import type { ExpoConfig } from 'expo/config';

// APP_VARIANT picks the build: development and preview builds install alongside production.
const variant = (process.env.APP_VARIANT ?? 'development') as 'development' | 'preview' | 'production';
const suffix = variant === 'production' ? '' : `.${variant}`;
const bundleId = `${process.env.APP_BUNDLE_ID ?? 'ie.splitcab.app'}${suffix}`;
const applePayMerchantId = process.env.APPLE_PAY_MERCHANT_ID;

const config: ExpoConfig = {
  name: variant === 'production' ? 'SplitCab' : `SplitCab ${variant === 'preview' ? 'Preview' : 'Dev'}`,
  slug: 'splitcab',
  scheme: 'splitcab',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      backgroundColor: '#FFC629',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Only coarse location is needed to fill in a pickup point.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    'expo-sharing',
    // Apple Maps on iOS needs no key; Android's Google Maps does.
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
    'expo-font',
    '@react-native-community/datetimepicker',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#FFC629' }],
    ['expo-location', { locationWhenInUsePermission: 'SplitCab uses your location to fill in your pickup point.' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#FFC629', defaultChannel: 'rides' }],
    ['@stripe/stripe-react-native', { merchantIdentifier: applePayMerchantId ?? '', enableGooglePay: true }],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    applePayMerchantId: applePayMerchantId ?? null,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
  runtimeVersion: { policy: 'appVersion' },
};

export default config;
