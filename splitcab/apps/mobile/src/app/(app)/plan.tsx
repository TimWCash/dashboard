import { CONFIG, formatMoney, soloWindow, type TripInput } from '@splitcab/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateTimeField } from '../../components/DateTimeField';
import { AppText, Button, Card, Icon, Note, Row, Screen, Segmented } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { useCardPayments } from '../../lib/payments';
import { resetDraft, updateDraft, usePlanDraft } from '../../lib/planDraft';
import { registerForPush } from '../../lib/push';
import { useConfig, useConfirmHold, usePostTrip } from '../../lib/queries';
import { radius, space, useTheme } from '../../lib/theme';

export default function Plan() {
  const { c } = useTheme();
  const draft = usePlanDraft();
  const { me, setMe } = useAuth();
  const config = useConfig();
  const postTrip = usePostTrip();
  const confirmHold = useConfirmHold();
  const { saveCard, approveHold } = useCardPayments();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const ready = draft.origin && draft.destination;
  const estimate = ready
    ? soloWindow({ origin: draft.origin!, destination: draft.destination!, timeMode: draft.timeMode, time: draft.time.getTime(), flexMin: draft.flexMin, seats: draft.seats }).solo
    : null;
  const fee = formatMoney(config.data?.matchFee ?? CONFIG.matchFee);

  async function addCard() {
    if (!config.data) return false;
    const updated = await saveCard(config.data);
    if (updated) setMe(updated);
    return Boolean(updated?.paymentMethod);
  }

  async function submit() {
    if (!ready || !config.data) return;
    setBusy(true);
    setError(null);
    try {
      if (!me?.paymentMethod && !(await addCard())) {
        setBusy(false);
        return;
      }
      const input: TripInput = {
        origin: draft.origin!,
        destination: draft.destination!,
        timeMode: draft.timeMode,
        time: draft.time.toISOString(),
        flexMin: draft.flexMin,
        seats: draft.seats,
      };
      let trip = await postTrip.mutateAsync(input);
      if (trip.paymentAction && (await approveHold(config.data, trip.paymentAction.clientSecret))) {
        trip = await confirmHold.mutateAsync(trip.id);
      }
      resetDraft();
      router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
      // Now is a good moment to ask: they'll want to know the second someone matches.
      registerForPush(true).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const placeRow = (field: 'origin' | 'destination', label: string, icon: 'radio-button-on' | 'location') => {
    const place = draft[field];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${place?.label ?? 'not set'}`}
        onPress={() => router.push({ pathname: '/place-search', params: { field } })}
        style={[styles.place, { borderColor: c.line, backgroundColor: c.surface2 }]}
        testID={`${field}-button`}
      >
        <Icon name={icon} size={18} color={field === 'origin' ? c.ink : c.accentStrong} />
        <View style={{ flex: 1 }}>
          <AppText variant="caption" muted>
            {label}
          </AppText>
          <AppText variant="body" muted={!place} numberOfLines={1}>
            {place?.label ?? (field === 'origin' ? 'Pickup point' : 'Where are you going?')}
          </AppText>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen
      footer={
        <Button
          title="Find someone to share with"
          onPress={submit}
          loading={busy}
          disabled={!ready || !config.data}
          accessibilityHint={`Places a ${fee} hold on your card`}
        />
      }
    >
      <View style={{ gap: space.sm }}>
        {placeRow('origin', 'From', 'radio-button-on')}
        <Row style={{ justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap pickup and destination"
            onPress={() => updateDraft({ origin: draft.destination, destination: draft.origin })}
            style={[styles.swap, { borderColor: c.line, backgroundColor: c.surface }]}
          >
            <Icon name="swap-vertical" size={18} />
          </Pressable>
        </Row>
        {placeRow('destination', 'To', 'location')}
      </View>

      <Segmented
        label="Time type"
        value={draft.timeMode}
        onChange={(timeMode) => updateDraft({ timeMode })}
        options={[
          { value: 'depart', label: 'Leave around' },
          { value: 'arrive', label: 'Arrive around' },
        ]}
      />
      <DateTimeField
        label={draft.timeMode === 'arrive' ? 'Arrival time' : 'Departure time'}
        value={draft.time}
        onChange={(time) => updateDraft({ time })}
        minimumDate={new Date(now)}
        maximumDate={new Date(now + CONFIG.trips.maxDaysAhead * 86_400_000)}
      />
      <View style={{ gap: space.xs }}>
        <AppText variant="caption" muted>
          How flexible are you?
        </AppText>
        <Segmented
          label="Flexibility"
          value={draft.flexMin}
          onChange={(flexMin) => updateDraft({ flexMin })}
          options={[
            { value: 15, label: '± 15 min' },
            { value: 30, label: '± 30 min' },
            { value: 60, label: '± 1 hr' },
          ]}
        />
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="caption" muted>
          People in your group
        </AppText>
        <Segmented
          label="Group size"
          value={draft.seats}
          onChange={(seats) => updateDraft({ seats })}
          options={[
            { value: 1, label: 'Just me' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
          ]}
        />
      </View>

      {estimate ? (
        <Note>
          {`A taxi on your own is about ${money(estimate.fare)} (~${Math.round(estimate.minutes)} min, ${estimate.tariffLabel}). You'll see your exact share before you agree to anything.`}
        </Note>
      ) : null}
      <Note tone="good">{`We place a ${fee} hold on your card. It's only charged if you're matched and you both accept. Otherwise it's released automatically.`}</Note>

      <Card style={{ paddingVertical: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            <Icon name="card-outline" />
            <AppText variant="body">
              {me?.paymentMethod ? `${me.paymentMethod.brand.toUpperCase()} •••• ${me.paymentMethod.last4}` : 'No card yet'}
            </AppText>
          </Row>
          <Button
            title={me?.paymentMethod ? 'Change' : 'Add card'}
            variant="link"
            onPress={() =>
              addCard().catch((e) => setError(e instanceof ApiError ? e.message : 'Could not save your card.'))
            }
          />
        </Row>
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 60 },
  swap: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginVertical: -space.md, zIndex: 1 },
});
