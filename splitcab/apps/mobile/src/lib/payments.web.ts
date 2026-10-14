import type { AppConfig, MeView, PaymentSetupResponse } from '@splitcab/core';
import { api, ApiError } from './api';

// The web build is for development and QA only. It works with the server's test payment mode.
export function useCardPayments() {
  async function saveCard(config: AppConfig): Promise<MeView | null> {
    if (config.paymentsMode !== 'test') throw new ApiError(0, 'unsupported', 'Add your card in the SplitCab app on your phone.');
    await api.post<PaymentSetupResponse>('/v1/payments/setup');
    return api.post<MeView>('/v1/payments/method/refresh');
  }

  async function approveHold(config: AppConfig, _clientSecret: string): Promise<boolean> {
    if (config.paymentsMode !== 'test') throw new ApiError(0, 'unsupported', 'Approve the hold in the SplitCab app on your phone.');
    return true;
  }

  return { saveCard, approveHold };
}
