import { REPORT_REASONS, type ReportReason } from '@splitcab/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
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
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const block = useBlock();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/matches/${matchId}/report`, { reason, details: details.trim() || undefined });
      if (alsoBlock) await block.mutateAsync(matchId);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button title={reason ? 'Send report' : 'Block without reporting'} onPress={reason ? submit : () => block.mutate(matchId, { onSuccess: () => router.back(), onError: (e) => setError(e.message) })} loading={busy || block.isPending} />
        </>
      }
    >
      <Note tone="bad" icon="call-outline">
        If you're in danger, call 112 or 999 now.
      </Note>
      <AppText variant="body" muted>
        Reports go to our safety team. Blocking ends any ride you have planned with this person, refunds both match fees, and stops you being matched again.
      </AppText>
      <View style={{ gap: space.sm }}>
        {REPORT_REASONS.map((r) => {
          const on = reason === r;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setReason(on ? null : r)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.ink : c.line, backgroundColor: c.surface }}
            >
              <Icon name={on ? 'radio-button-on' : 'radio-button-off'} color={on ? c.ink : c.muted} />
              <AppText variant="body">{LABELS[r]}</AppText>
            </Pressable>
          );
        })}
      </View>
      {reason ? <Field label="What happened? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ minHeight: 100, paddingTop: space.md, textAlignVertical: 'top' }} /> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="body">Also block this person</AppText>
        <Switch value={alsoBlock} onValueChange={setAlsoBlock} accessibilityLabel="Also block this person" />
      </Row>
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
