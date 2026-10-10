import type { PaymentStatus } from '@splitcab/core';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { AppText, Button, Card, Icon, Note, Pill, Row, type Tone } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { clock, money, when } from '../../../lib/format';
import { useCardPayments } from '../../../lib/payments';
import { useConfig, usePayments } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

const STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  requires_action: { label: 'Needs approval', tone: 'warn' },
  authorized: { label: 'On hold', tone: 'warn' },
  captured: { label: 'Charged', tone: 'ink' },
  released: { label: 'Not charged', tone: 'good' },
  refunded: { label: 'Refunded', tone: 'good' },
  failed: { label: 'Declined', tone: 'bad' },
};
const EVENT: Record<PaymentStatus, string> = {
  pending: 'Started',
  requires_action: 'Approval needed',
  authorized: 'Hold placed',
  captured: 'Charged',
  released: 'Hold released',
  refunded: 'Refunded',
  failed: 'Declined',
};

export default function Wallet() {
  const { c } = useTheme();
  const { me, setMe } = useAuth();
  const config = useConfig();
  const payments = usePayments();
  const { saveCard } = useCardPayments();
  const [error, setError] = useState<string | null>(null);
  const list = payments.data ?? [];
  const total = (s: PaymentStatus) => list.filter((p) => p.status === s).reduce((sum, p) => sum + p.amount, 0);

  async function changeCard() {
    if (!config.data) return;
    setError(null);
    try {
      const updated = await saveCard(config.data);
      if (updated) setMe(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your card.");
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      refreshControl={<RefreshControl refreshing={payments.isRefetching} onRefresh={() => payments.refetch()} />}
    >
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            <Icon name="card-outline" />
            <AppText variant="body">{me?.paymentMethod ? `${me.paymentMethod.brand.toUpperCase()} •••• ${me.paymentMethod.last4}` : 'No card saved'}</AppText>
          </Row>
          <Button title={me?.paymentMethod ? 'Change' : 'Add card'} variant="link" onPress={changeCard} />
        </Row>
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}

      <Row>
        <Card style={{ flex: 1 }}>
          <AppText variant="caption" muted>
            Charged
          </AppText>
          <AppText variant="title">{money(total('captured'))}</AppText>
        </Card>
        <Card style={{ flex: 1 }}>
          <AppText variant="caption" muted>
            On hold
          </AppText>
          <AppText variant="title">{money(total('authorized'))}</AppText>
        </Card>
      </Row>

      <Note tone="good">{`You're only charged the ${money(config.data?.matchFee ?? 199)} match fee when you and your travel partner both accept. Holds on trips without a match drop off automatically.`}</Note>

      {list.length ? (
        <Card style={{ gap: 0, paddingVertical: space.sm }}>
          {list.map((p, i) => {
            const s = STATUS[p.status];
            return (
              <View key={p.id} style={{ paddingVertical: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, gap: 4 }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" style={{ fontWeight: '600' }}>
                      {`${p.trip.from} → ${p.trip.to}`}
                    </AppText>
                    <AppText variant="small" muted>
                      {when(p.trip.time)}
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <AppText
                      variant="body"
                      style={[{ fontWeight: '700' }, (p.status === 'released' || p.status === 'refunded') && { textDecorationLine: 'line-through', color: c.muted }]}
                    >
                      {money(p.amount)}
                    </AppText>
                    <Pill label={s.label} tone={s.tone} />
                  </View>
                </Row>
                <AppText variant="small" muted style={{ fontSize: 12 }}>
                  {p.history.map((h) => `${EVENT[h.status]} ${clock(h.at)}`).join(' · ')}
                </AppText>
              </View>
            );
          })}
        </Card>
      ) : (
        <AppText variant="small" muted style={{ textAlign: 'center' }}>
          {payments.isLoading ? 'Loading…' : 'No payments yet.'}
        </AppText>
      )}
    </ScrollView>
  );
}
