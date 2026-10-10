import type { MeView } from '@splitcab/core';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { AppText, Button, Field, Icon, Row, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useConfig } from '../../lib/queries';
import { space, useTheme } from '../../lib/theme';

export default function Profile() {
  const { c } = useTheme();
  const { me, setMe } = useAuth();
  const config = useConfig();
  const [name, setName] = useState(me?.firstName ?? '');
  const [agreed, setAgreed] = useState(Boolean(me?.termsAcceptedAt));
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
    <AppText variant="small" style={{ textDecorationLine: 'underline', fontWeight: '600' }} onPress={() => url && WebBrowser.openBrowserAsync(url)}>
      {label}
    </AppText>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title="Get started" onPress={save} loading={busy} disabled={!name.trim() || !agreed} />}>
        <AppText variant="title" accessibilityRole="header">
          What should we call you?
        </AppText>
        <AppText variant="body" muted>
          Your travel partner sees your first name and rating. Nothing else until you've both said yes.
        </AppText>
        <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" autoFocus maxLength={40} error={error} testID="name-input" />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((a) => !a)}
          testID="terms-checkbox"
        >
          <Row style={{ alignItems: 'flex-start' }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: agreed ? c.ink : c.muted,
                backgroundColor: agreed ? c.ink : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
              }}
            >
              {agreed ? <Icon name="checkmark" size={16} color={c.bg} /> : null}
            </View>
            <AppText variant="small" style={{ flex: 1, gap: space.xs }}>
              I agree to the {link('Terms of Service', config.data?.termsUrl)} and have read the {link('Privacy Policy', config.data?.privacyUrl)}.
            </AppText>
          </Row>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
