import { StripeProvider } from '@stripe/stripe-react-native';
import Constants from 'expo-constants';
import type { ReactNode } from 'react';
import { useConfig } from './queries';

// The publishable key comes from the API so test and live builds can't get mixed up.
export function StripeRoot({ children }: { children: ReactNode }) {
  const config = useConfig();
  const key = config.data?.stripePublishableKey ?? 'pk_test_unconfigured';
  const merchantIdentifier = (Constants.expoConfig?.extra?.applePayMerchantId as string | null) ?? undefined;
  return (
    <StripeProvider publishableKey={key} merchantIdentifier={merchantIdentifier} urlScheme="splitcab">
      <>{children}</>
    </StripeProvider>
  );
}
