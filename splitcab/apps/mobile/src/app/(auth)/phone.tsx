import type { OtpStartResponse } from '@splitcab/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppText, Button, Field, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function Phone() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.public.post<OtpStartResponse>('/v1/auth/otp/start', { phone });
      router.push({ pathname: '/code', params: { phone: res.phone, ...(res.devCode ? { devCode: res.devCode } : {}) } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title="Send code" onPress={send} loading={busy} disabled={phone.replace(/\D/g, '').length < 7} />}>
        <AppText variant="title" accessibilityRole="header">
          What's your mobile number?
        </AppText>
        <AppText variant="body" muted>
          We'll text you a code to sign in. Your number is never shown to other travellers.
        </AppText>
        <Field
          label="Mobile number"
          hint="Irish or international number"
          value={phone}
          onChangeText={setPhone}
          placeholder="087 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={send}
          error={error}
          testID="phone-input"
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
