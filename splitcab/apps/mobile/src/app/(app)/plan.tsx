import { CONFIG, bestCaseSavings, formatMoney, soloWindow, type TripInput } from '@splitcab/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateTimeField } from '../../components/DateTimeField';
import { AppText, Button, Card, Divider, Icon, Note, Row, Screen, Segmented } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { useCardPayments } from '../../lib/payments';
import { resetDraft, updateDraft, usePlanDraft } from '../../lib/planDraft';
import { useConfig, useConfirmHold, usePostTrip } from '../../lib/queries';
import { radius, space, useTheme } from '../../lib/theme';

const FLEX_LABEL: Record<number, string> = { 15: '±15 min', 30: '±30 min', 60: '±1 hr' };
const EARLY_LABEL: Record<number, string> = { 15: 'up to 15 min early', 30: 'up to 30 min early', 60: 'up to 1 hr early' };

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
  const [showOptions, setShowOptions] = useState(false);

  // The default time was set when the app started; move it forward if it has gone stale.
  useEffect(() => {
    if (draft.time.getTime() < Date.now() + 5 * 60_000) {
      const quarter = 15 * 60_000;
      updateDraft({ time: new Date(Math.ceil((Date.now() + 60 * 60_000) / quarter) * quarter) });
    }
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  const ready = Boolean(draft.origin && draft.destination);
  const like = ready
    ? { origin: draft.origin!, destination: draft.destination!, timeMode: draft.timeMode, time: draft.time.getTime(), flexMin: draft.flexMin, seats: draft.seats }
    : null;
  const estimate = like ? soloWindow(like).solo : null;
  // A partner making exactly the same trip; anyone else saves you less. Below the minimum nobody can be matched.
  const upTo = like ? bestCaseSavings(like) : null;
  const worthSharing = upTo === null || upTo >= CONFIG.matching.minNetSavings;
  const fee = formatMoney(config.data?.matchFee ?? CONFIG.matchFee);
  const card = me?.paymentMethod;
  const arrive = draft.timeMode === 'arrive';
  // Further ahead than a card hold lasts: the trip is saved and the search (and hold) starts later.
  const planned = draft.time.getTime() - CONFIG.trips.maxDaysAhead * 86_400_000 > now;

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
      if (!card && !(await addCard())) {
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
        // The rider agrees below the button, which is what the law asks for before a paid service can start.
        startNow: true,
      };
      let trip = await postTrip.mutateAsync(input);
      if (trip.paymentAction && (await approveHold(config.data, trip.paymentAction.clientSecret))) {
        trip = await confirmHold.mutateAsync(trip.id);
      }
      resetDraft();
      router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
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

  const optionsSummary = [
    arrive ? `Arrive by, ${EARLY_LABEL[draft.flexMin] ?? ''}` : `Leaving around, ${FLEX_LABEL[draft.flexMin] ?? ''}`,
    draft.seats === 1 ? 'just me' : `${draft.seats} people`,
  ].join(' · ');

  return (
    <Screen
      footer={
        <>
          {error ? <Note tone="bad">{error}</Note> : null}
          <Button
            title={planned ? (card ? 'Plan this trip' : 'Add card and plan this trip') : card ? 'Find someone to share with' : 'Add card and find a match'}
            onPress={submit}
            loading={busy}
            disabled={!ready || !config.data || !worthSharing}
            accessibilityHint={`Places a ${fee} hold on your card, only charged if you're matched`}
          />
          <AppText variant="small" muted style={{ textAlign: 'center' }}>
            {planned
              ? `We'll start looking ${CONFIG.trips.maxDaysAhead} days before your trip and place the ${fee} hold then. Once you're matched and you both accept, the ${fee} is charged and, as the service is then complete, you can't cancel it for a refund.`
              : `This asks us to start looking straight away. Once you're matched and you both accept, the ${fee} is charged and, as the service is then complete, you can't cancel it for a refund.`}
          </AppText>
        </>
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

      <DateTimeField
        label={arrive ? 'Arrive by' : 'Leave around'}
        value={draft.time}
        onChange={(time) => updateDraft({ time })}
        minimumDate={new Date(now)}
        maximumDate={new Date(now + CONFIG.trips.maxPlanDaysAhead * 86_400_000)}
      />

      {showOptions ? (
        <Card>
          <Segmented
            label="Time type"
            value={draft.timeMode}
            onChange={(timeMode) => updateDraft({ timeMode })}
            options={[
              { value: 'depart', label: 'Leave around' },
              { value: 'arrive', label: 'Arrive by' },
            ]}
          />
          <View style={{ gap: space.xs }}>
            <AppText variant="caption" muted>
              {arrive ? 'How early could you arrive?' : 'How flexible are you?'}
            </AppText>
            <Segmented
              label="Flexibility"
              value={draft.flexMin}
              onChange={(flexMin) => updateDraft({ flexMin })}
              options={[15, 30, 60].map((v) => ({ value: v, label: arrive ? (v === 60 ? '1 hr' : `${v} min`) : FLEX_LABEL[v]! }))}
            />
          </View>
          <View style={{ gap: space.xs }}>
            <AppText variant="caption" muted>
              People travelling with you
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
          <Button title="Done" variant="link" onPress={() => setShowOptions(false)} />
        </Card>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`${optionsSummary}. Change`} onPress={() => setShowOptions(true)} style={[styles.options, { borderColor: c.line }]}>
          <AppText variant="body" style={{ flex: 1 }}>
            {optionsSummary.charAt(0).toUpperCase() + optionsSummary.slice(1)}
          </AppText>
          <AppText variant="body" style={{ fontWeight: '600', textDecorationLine: 'underline' }}>
            Change
          </AppText>
        </Pressable>
      )}

      <Card>
        {estimate && upTo !== null ? (
          <>
            <AppText variant="body">{`About ${money(estimate.fare)} on your own (~${Math.round(estimate.minutes)} min)`}</AppText>
            {worthSharing ? (
              <AppText variant="small" muted>{`Sharing saves you up to ${money(upTo)} after the fee.`}</AppText>
            ) : (
              <Note tone="warn">{`Sharing this trip would save you less than ${money(CONFIG.matching.minNetSavings)}, so we don't match it. Sharing pays on longer trips, like to or from the airport.`}</Note>
            )}
            <Divider />
          </>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="body">{card ? `${card.brand.toUpperCase()} •••• ${card.last4}` : 'No card yet'}</AppText>
            <AppText variant="small" muted>{`${fee}, only if you're matched and both say yes`}</AppText>
          </View>
          {card ? <Button title="Change" variant="link" onPress={() => addCard().catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't save your card."))} /> : null}
        </Row>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 60 },
  swap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginVertical: -space.lg, zIndex: 1 },
  options: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 52 },
});
