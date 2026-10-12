import type { AuthResponse, OtpStartResponse } from '@splitcab/core';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppText, Button, Field, Note, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DEMO } from '../../lib/demo';
import { formatPhone } from '../../lib/format';
import { pendingSignIn } from '../../lib/pendingSignIn';

const RESEND_AFTER_S = 30;

export default function Code() {
  const [pending] = useState(pendingSignIn.get);
  const phone = pending?.phone ?? '';
  const { signIn } = useAuth();
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(pending?.devCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER_S);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(value = code) {
    setBusy(true);
    setError(null);
    try {
      const auth = await api.public.post<AuthResponse>('/v1/auth/otp/verify', { phone, code: value });
      await signIn(auth);
      pendingSignIn.clear();
      router.replace(auth.user.profileComplete ? '/' : '/profile');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await api.public.post<OtpStartResponse>('/v1/auth/otp/start', { phone });
      pendingSignIn.set(res);
      setDevCode(pendingSignIn.get()?.devCode);
      setWait(RESEND_AFTER_S);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  }

  // Opened directly (a link, or the app restarted here): start again from the number.
  if (!pending) return <Redirect href="/phone" />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <>
            <Button title="Continue" onPress={() => verify()} loading={busy} disabled={code.length < 6} />
            <Button title={wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'} variant="link" onPress={resend} disabled={wait > 0} />
          </>
        }
      >
        <AppText variant="title" accessibilityRole="header">
          Enter the code
        </AppText>
        <AppText variant="body" muted>
          {DEMO ? `No text is sent in the demo. Your code for ${formatPhone(phone)} is below.` : `We texted a 6-digit code to ${formatPhone(phone)}.`}
        </AppText>
        <Field
          label="Code"
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            if (digits.length === 6) verify(digits);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={6}
          error={error}
          testID="code-input"
          style={{ letterSpacing: 6, fontSize: 22 }}
        />
        {devCode ? <Note>{DEMO ? `Your code is ${devCode}.` : `Development server: no text is sent. Your code is ${devCode}.`}</Note> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
