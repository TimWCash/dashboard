import type { MeView } from '@splitcab/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppText, Button, Field, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

// Correcting your name (GDPR right to rectification).
export default function EditName() {
  const { me, setMe } = useAuth();
  const [name, setName] = useState(me?.firstName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.patch<MeView>('/v1/me', { firstName: name.trim() }));
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your name. Please try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title="Save" onPress={save} loading={busy} disabled={!name.trim() || name.trim() === me?.firstName} />}>
        <AppText variant="body" muted>
          Your travel partner sees your first name.
        </AppText>
        <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" autoFocus maxLength={40} error={error} testID="name-edit-input" />
      </Screen>
    </KeyboardAvoidingView>
  );
}
