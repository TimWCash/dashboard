import type { MeView } from '@splitcab/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppText, Button, Field, Note, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function Revtag() {
  const { me, setMe } = useAuth();
  const [value, setValue] = useState(me?.revtag ? `@${me.revtag}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(revtag: string | null) {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.patch<MeView>('/v1/me', { revtag }));
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your Revtag. Please try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <>
            <Button title="Save" onPress={() => save(value)} loading={busy} disabled={!value.trim()} />
            {me?.revtag ? <Button title="Remove my Revtag" variant="link" onPress={() => save(null)} disabled={busy} /> : null}
          </>
        }
      >
        <AppText variant="title" accessibilityRole="header">
          Get paid back by Revolut
        </AppText>
        <AppText variant="body" muted>
          When you book the taxi, your travel partner pays you back. With your Revtag they can pay you on your Revolut page, or by scanning a QR code on
          your phone. They don't need Revolut: they can pay by card.
        </AppText>
        <Field
          label="Your Revtag"
          hint="In Revolut, tap your profile picture to see it, for example @aoife123."
          value={value}
          onChangeText={setValue}
          placeholder="@yourname"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => value.trim() && save(value)}
          error={error}
          testID="revtag-input"
        />
        <Note>Only shown to a travel partner who owes you money, after the ride. Your Revolut page shows your name.</Note>
      </Screen>
    </KeyboardAvoidingView>
  );
}
