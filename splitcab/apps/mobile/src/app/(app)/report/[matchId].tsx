import { REPORT_REASONS, type ReportReason } from '@splitcab/core';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { AppText, Button, Field, Icon, Note, Row, Screen } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { useBlock } from '../../../lib/queries';
import { radius, space, useTheme } from '../../../lib/theme';

const LABELS: Record<ReportReason, string> = {
  no_show: "They didn't show up",
  unsafe: 'I felt unsafe',
  harassment: 'Harassment or abusive messages',
  payment: "They didn't pay their share",
  other: 'Something else',
};

export default function Report() {
  const { c } = useTheme();
  const { matchId, name: nameParam } = useLocalSearchParams<{ matchId: string; name?: string }>();
  const name = nameParam ?? 'this person';
  const block = useBlock();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    setBusy(false);
  };

  async function sendReport() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/matches/${matchId}/report`, { reason, details: details.trim() || undefined });
      if (alsoBlock) await block.mutateAsync(matchId);
      router.back();
    } catch (e) {
      fail(e);
    }
  }

  async function blockOnly() {
    setBusy(true);
    setError(null);
    try {
      await block.mutateAsync(matchId);
      router.back();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Screen
      footer={
        <>
          {error ? <Note tone="bad">{error}</Note> : null}
          <Button title="Send report" onPress={sendReport} loading={busy && !!reason} disabled={!reason || busy} />
          <Button title={`Block ${name} without reporting`} variant="link" onPress={blockOnly} disabled={busy} />
        </>
      }
    >
      <Stack.Screen
        options={{
          title: 'Safety',
          headerLeft: () => (
            <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingRight: space.lg }}>
              <AppText variant="body" style={{ fontWeight: '600' }}>
                Close
              </AppText>
            </Pressable>
          ),
        }}
      />
      <Button title="In danger? Call 112" variant="danger" icon="call" onPress={() => Linking.openURL('tel:112').catch(() => {})} />
      <AppText variant="heading">Tell us what happened</AppText>
      <AppText variant="small" muted>
        Our safety team reviews every report.
      </AppText>
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {REPORT_REASONS.map((r) => {
          const on = reason === r;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setReason(on ? null : r)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.ink : c.line, backgroundColor: c.surface }}
            >
              <Icon name={on ? 'radio-button-on' : 'radio-button-off'} color={on ? c.ink : c.muted} />
              <AppText variant="body">{LABELS[r]}</AppText>
            </Pressable>
          );
        })}
      </View>
      {reason ? (
        <Field
          label="What happened? (optional)"
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={1000}
          style={{ minHeight: 100, paddingTop: space.md, textAlignVertical: 'top' }}
        />
      ) : null}
      <View style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{`Also block ${name}`}</AppText>
          <Switch
            value={alsoBlock}
            onValueChange={setAlsoBlock}
            accessibilityLabel={`Also block ${name}`}
            trackColor={{ false: c.line, true: c.ink }}
            thumbColor={c.surface}
            ios_backgroundColor={c.line}
          />
        </Row>
        <AppText variant="small" muted>
          Cancels any trip with them, refunds both match fees, and you won't be matched again.
        </AppText>
      </View>
    </Screen>
  );
}
