import type { AppConfig, MeView, PaymentSetupResponse } from '@splitcab/core';
import { useStripe } from '@stripe/stripe-react-native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { api, ApiError } from './api';

const returnURL = Linking.createURL('stripe-redirect');

// Saving a card uses Stripe's PaymentSheet in setup mode, so card details never touch our servers.
export function useCardPayments() {
  const { initPaymentSheet, presentPaymentSheet, handleNextAction } = useStripe();

  // Returns the updated profile, or null if the rider closed the sheet.
  async function saveCard(config: AppConfig): Promise<MeView | null> {
    const setup = await api.post<PaymentSetupResponse>('/v1/payments/setup');
    if (setup.mode === 'test') return api.post<MeView>('/v1/payments/method/refresh');

    const applePay = Boolean(Constants.expoConfig?.extra?.applePayMerchantId);
    const init = await initPaymentSheet({
      merchantDisplayName: config.merchantDisplayName,
      customerId: setup.customerId!,
      customerEphemeralKeySecret: setup.ephemeralKey!,
      setupIntentClientSecret: setup.setupIntentClientSecret!,
      returnURL,
      style: 'automatic',
      ...(applePay ? { applePay: { merchantCountryCode: config.merchantCountryCode } } : {}),
      googlePay: { merchantCountryCode: config.merchantCountryCode, currencyCode: config.currency, testEnv: __DEV__ },
    });
    if (init.error) throw new ApiError(0, 'card_setup', init.error.message);
    const result = await presentPaymentSheet();
    if (result.error) {
      if (result.error.code === 'Canceled') return null;
      throw new ApiError(0, 'card_setup', result.error.message);
    }
    return api.post<MeView>('/v1/payments/method/refresh');
  }

  // Lets the rider approve a hold with their bank (3-D Secure). Returns false if they backed out.
  async function approveHold(config: AppConfig, clientSecret: string): Promise<boolean> {
    // The server's test payment mode has no real bank to talk to.
    if (config.paymentsMode === 'test') return true;
    const result = await handleNextAction(clientSecret, returnURL);
    if (result.error) {
      if (result.error.code === 'Canceled') return false;
      throw new ApiError(0, 'card_auth', result.error.message);
    }
    return true;
  }

  return { saveCard, approveHold };
}
