import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText, Button, Card, Divider, Note, Row, Screen } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { useReceipt } from '../../../lib/queries';
import { SHARE_RECEIPT_LABEL, shareReceipt } from '../../../lib/receipt';
import { receiptDate, receiptLines, rideLine, settleUpLine } from '../../../lib/receiptText';
import { space } from '../../../lib/theme';

export default function Receipt() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const receipt = useReceipt(tripId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = receipt.data;

  async function share() {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await shareReceipt(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the PDF.");
    } finally {
      setBusy(false);
    }
  }

  if (!r) {
    return (
      <Screen>
        {receipt.error ? (
          <Note tone="bad">{receipt.error instanceof ApiError ? receipt.error.message : "Couldn't load your receipt."}</Note>
        ) : (
          <ActivityIndicator style={{ marginTop: space.xl }} />
        )}
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title={SHARE_RECEIPT_LABEL} icon="share-outline" onPress={share} loading={busy} />}>
      <Card>
        <View style={{ gap: space.xs }}>
          <AppText variant="heading">{`${r.ride.from} → ${r.ride.to}`}</AppText>
          <AppText variant="small" muted>
            {`${rideLine(r)} · shared with ${r.ride.partner}`}
          </AppText>
        </View>
        <Divider />
        {receiptLines(r).map((l) => (
          <Row key={l.label} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <AppText variant="body" style={{ flex: 1, fontWeight: l.strong ? '700' : undefined }}>
              {l.label}
            </AppText>
            <AppText variant="body" style={{ fontWeight: l.strong ? '700' : undefined }}>
              {l.value}
            </AppText>
          </Row>
        ))}
        {r.fare.meterTotal === null ? (
          <AppText variant="small" muted>
            The fare wasn't entered after the ride, so these are the estimates you both accepted.
          </AppText>
        ) : null}
        <Divider />
        <AppText variant="body">{settleUpLine(r)}</AppText>
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}
      <AppText variant="small" muted style={{ textAlign: 'center' }}>
        {`Receipt ${r.number} · issued ${receiptDate(r.issuedAt)}`}
        {r.merchant.details ? `\n${r.merchant.details}` : ''}
      </AppText>
    </Screen>
  );
}
