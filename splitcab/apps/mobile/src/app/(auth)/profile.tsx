import type { MeView } from '@splitcab/core';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppText, Button, Field, Note, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DEMO } from '../../lib/demo';
import { useConfig } from '../../lib/queries';

export default function Profile() {
  const { me, setMe } = useAuth();
  const config = useConfig();
  const [name, setName] = useState(me?.firstName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<MeView>('/v1/me', { firstName: name.trim(), acceptTerms: true });
      setMe(updated);
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const link = (label: string, url?: string) => (
    <AppText variant="small" style={{ textDecorationLine: 'underline', fontWeight: '600' }} onPress={() => url && WebBrowser.openBrowserAsync(url)} accessibilityRole="link">
      {label}
    </AppText>
  );

  // Someone who agreed to an earlier version sees what changed and agrees again.
  const updated = Boolean(me?.termsUpdated && me.firstName);
  const action = updated ? 'Agree and continue' : 'Get started';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <>
            {DEMO ? (
              <AppText variant="small" muted>
                By tapping {action}, you confirm you're 18 or over and agree to how{' '}
                <AppText variant="small" style={{ textDecorationLine: 'underline', fontWeight: '600' }} onPress={() => router.push('/demo-privacy')} accessibilityRole="link">
                  this demo uses your data
                </AppText>
                .
              </AppText>
            ) : (
              <AppText variant="small" muted>
                By tapping {action}, you confirm you're 18 or over and agree to our {link('Terms of Service', config.data?.termsUrl)} and{' '}
                {link('Privacy Policy', config.data?.privacyUrl)}.
              </AppText>
            )}
            <Button title={action} onPress={save} loading={busy} disabled={!name.trim()} />
          </>
        }
      >
        {updated ? (
          <>
            <AppText variant="title" accessibilityRole="header">
              We've updated our Terms and Privacy Policy
            </AppText>
            <AppText variant="body" muted>
              Please read them before your next trip. You can see what we keep, and download or delete your data, any time under Account → Privacy
              & your data.
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="title" accessibilityRole="header">
              What should we call you?
            </AppText>
            <AppText variant="body" muted>
              Your travel partner sees your first name and rating. Nothing else until you've both said yes.
            </AppText>
            <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" autoFocus maxLength={40} error={error} testID="name-input" />
          </>
        )}
        {updated && error ? <Note tone="bad">{error}</Note> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
