import type { MatchView, TripView } from '@splitcab/core';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Countdown, MatchFacts, PartnerRow, PriceBreakdown, Pulse, RouteTimeline, TripHeader } from '../../../components/ride';
import { AppText, Button, Card, Field, Icon, Note, Row, Screen } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { bookingOptions } from '../../../lib/booking';
import { clock, money, parseEuro, when } from '../../../lib/format';
import { useCardPayments } from '../../../lib/payments';
import { useCancelTrip, useComplete, useConfig, useConfirmHold, useRate, useRespond, useTrip } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

// Destructive actions take a second tap within a few seconds instead of a dialog.
function useArmed() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    armed,
    confirm: (key: string, run: () => void) => {
      if (armed === key) {
        setArmed(null);
        run();
      } else setArmed(key);
    },
  };
}

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const t = trip.data;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            t?.match && ['proposed', 'confirmed', 'completed'].includes(t.match.status) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Report or block"
                onPress={() => router.push({ pathname: '/report/[matchId]', params: { matchId: t.match!.id } })}
                hitSlop={12}
              >
                <Icon name="flag-outline" />
              </Pressable>
            ) : null,
        }}
      />
      <Screen>
        {trip.error && !t ? <Note tone="bad">{trip.error.message}</Note> : null}
        {t ? <TripBody trip={t} /> : null}
      </Screen>
    </>
  );
}

function TripBody({ trip }: { trip: TripView }) {
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
  return (
    <>
      <Card>
        <TripHeader trip={trip} />
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}
      {trip.status === 'pending_payment' ? <PendingPayment trip={trip} onError={onError} /> : null}
      {trip.status === 'searching' ? <Searching trip={trip} onError={onError} /> : null}
      {trip.status === 'proposed' && trip.match ? <Proposed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'confirmed' && trip.match ? <Confirmed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'completed' && trip.match ? <Completed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'expired' ? <Note tone="good">{`We couldn't find anyone in time. Your ${money(trip.payment?.amount ?? 199)} hold was released. You weren't charged.`}</Note> : null}
      {trip.status === 'cancelled' ? (
        trip.payment?.status === 'captured' ? (
          <Note>{`You cancelled after confirming, so the ${money(trip.payment.amount)} match fee wasn't refunded.`}</Note>
        ) : (
          <Note tone="good">Cancelled. You weren't charged.</Note>
        )
      ) : null}
    </>
  );
}

type Section = { trip: TripView; onError: (e: unknown) => void };

function CancelButton({ trip, onError, label = 'Cancel trip', warning }: Section & { label?: string; warning?: string }) {
  const cancel = useCancelTrip();
  const { armed, confirm } = useArmed();
  return (
    <Button
      title={armed ? (warning ?? 'Tap again to cancel') : label}
      variant={armed ? 'danger' : 'link'}
      loading={cancel.isPending}
      onPress={() => confirm('cancel', () => cancel.mutate(trip.id, { onError }))}
    />
  );
}

function PendingPayment({ trip, onError }: Section) {
  const config = useConfig();
  const confirmHold = useConfirmHold();
  const { approveHold } = useCardPayments();
  const [busy, setBusy] = useState(false);
  async function approve() {
    if (!trip.paymentAction || !config.data) return;
    setBusy(true);
    try {
      if (await approveHold(config.data, trip.paymentAction.clientSecret)) await confirmHold.mutateAsync(trip.id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Note tone="warn">{`Your bank wants you to approve the ${money(trip.payment?.amount ?? 199)} hold before we start looking.`}</Note>
      {trip.paymentAction ? <Button title="Approve hold" onPress={approve} loading={busy} /> : <AppText muted>Placing the hold…</AppText>}
      <CancelButton trip={trip} onError={onError} />
    </>
  );
}

function FellThrough({ match }: { match: MatchView | null }) {
  if (!match || !['declined', 'expired', 'cancelled'].includes(match.status)) return null;
  const name = match.partner.firstName;
  const why =
    match.status === 'declined'
      ? `You and ${name} didn't both accept`
      : match.status === 'expired'
        ? `The match with ${name} timed out`
        : match.cancelledByPartner
          ? `${name} cancelled`
          : 'Your last match was cancelled';
  const refund = match.status === 'cancelled' && match.cancelledByPartner && match.confirmedAt ? ' Your match fee is being refunded.' : '';
  return <Note tone="warn">{`${why}, so we're looking again.${refund}`}</Note>;
}

function Searching({ trip, onError }: Section) {
  return (
    <>
      <FellThrough match={trip.match} />
      <Card>
        <Row>
          <Pulse />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading">Looking for someone heading your way</AppText>
            <AppText variant="small" muted>
              {`We'll keep looking until ${when(trip.searchUntil)} and let you know as soon as there's a match.`}
            </AppText>
          </View>
        </Row>
      </Card>
      <Note tone="good">{`${money(trip.payment?.amount ?? 199)} on hold. Not charged unless you're matched and both accept.`}</Note>
      <AppText variant="small" muted>
        {`On your own this trip costs about ${money(trip.soloFare)}.`}
      </AppText>
      <CancelButton trip={trip} onError={onError} />
    </>
  );
}

function Proposed({ trip, match, onError }: Section & { match: MatchView }) {
  const respond = useRespond();
  const name = match.partner.firstName;
  return (
    <>
      <Card>
        <PartnerRow match={match} />
        <RouteTimeline match={match} />
      </Card>
      <PriceBreakdown match={match} />
      <MatchFacts match={match} />
      {match.youAccepted ? (
        <>
          <Note tone="warn">
            <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
              <AppText variant="small">{`You're in. Waiting for ${name} to accept.`}</AppText>
              <Countdown until={match.expiresAt} prefix="Time left " />
            </Row>
          </Note>
          <CancelButton trip={trip} onError={onError} />
        </>
      ) : (
        <>
          <Row>
            <Button
              title="Decline"
              variant="ghost"
              style={{ flex: 1 }}
              loading={respond.isPending && respond.variables?.accept === false}
              disabled={respond.isPending}
              onPress={() => respond.mutate({ matchId: match.id, accept: false }, { onError })}
            />
            <Button
              title={`Accept · ${money(match.plan.you.fee)}`}
              style={{ flex: 1 }}
              loading={respond.isPending && respond.variables?.accept === true}
              disabled={respond.isPending}
              onPress={() => respond.mutate({ matchId: match.id, accept: true }, { onError })}
            />
          </Row>
          <Row style={{ justifyContent: 'center' }} gap={space.xs}>
            <Countdown until={match.expiresAt} prefix="Respond within " />
            {match.partnerAccepted ? <AppText variant="small" muted>{` · ${name} has accepted`}</AppText> : null}
          </Row>
        </>
      )}
    </>
  );
}

function Confirmed({ trip, match, onError }: Section & { match: MatchView }) {
  const { c } = useTheme();
  const complete = useComplete();
  const [fare, setFare] = useState('');
  const [copied, setCopied] = useState(false);
  const name = match.partner.firstName;
  const route = match.plan.route;
  const myPickup = route.find((s) => s.you && s.kind === 'pickup');
  const middle = route.slice(1, -1);

  function settle() {
    const cents = parseEuro(fare);
    if (cents === null) return onError(new ApiError(400, 'invalid_fare', 'Enter the total on the meter or receipt, for example 26.40.'));
    complete.mutate({ matchId: match.id, actualFare: cents }, { onError });
  }

  return (
    <>
      <Note tone="good">{`You're riding with ${name}. Your ${money(match.plan.you.fee)} match fee has been charged.`}</Note>
      <Card>
        <PartnerRow match={match} />
        <RouteTimeline match={match} />
        <Button
          title={`Message ${name}`}
          icon="chatbubble-ellipses-outline"
          variant="dark"
          onPress={() => router.push({ pathname: '/chat/[matchId]', params: { matchId: match.id, tripId: trip.id } })}
        />
      </Card>

      {match.youBook ? (
        <Card>
          <AppText variant="heading">You book the taxi</AppText>
          <AppText variant="small" muted>
            {`Book for ${clock(match.plan.startAt)} from ${route[0]!.label}.`}
            {middle.length ? ` Add ${middle.map((s) => s.label).join(' and ')} as a stop on the way.` : ` ${name} will meet you at the pickup.`}
          </AppText>
          <View style={{ gap: space.sm }}>
            {bookingOptions(route).map((o) => (
              <Button
                key={o.id}
                title={o.id === 'maps' ? o.label : `Open ${o.label}`}
                variant={o.id === 'maps' ? 'ghost' : 'dark'}
                icon={o.id === 'maps' ? 'map-outline' : 'open-outline'}
                onPress={() => Linking.openURL(o.url).catch(() => onError(new ApiError(0, 'open', `Couldn't open ${o.label}.`)))}
              />
            ))}
            <Button
              title={copied ? 'Pickup address copied' : 'Copy pickup address'}
              variant="link"
              onPress={async () => {
                await Clipboard.setStringAsync(route[0]!.label);
                setCopied(true);
              }}
            />
          </View>
          <AppText variant="small" muted>
            Uber opens with the pickup and destination filled in. In FREENOW, enter the pickup yourself.
          </AppText>
        </Card>
      ) : (
        <Card>
          <AppText variant="heading">{`${name} books the taxi`}</AppText>
          <AppText variant="small" muted>
            {`Be at ${myPickup?.label ?? 'your pickup'} by ${clock(match.plan.you.pickupAt)}`}
            {match.plan.you.walkToPickupMin ? ` (about a ${match.plan.you.walkToPickupMin} min walk)` : ''}
            {`. You'll pay ${name} your share after the ride.`}
          </AppText>
        </Card>
      )}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">Estimated fare</AppText>
          <AppText variant="body">{money(match.plan.fare)}</AppText>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">Your share</AppText>
          <AppText variant="body" style={{ fontWeight: '700' }}>
            {money(match.plan.you.share)}
          </AppText>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{`${name}'s share`}</AppText>
          <AppText variant="body">{money(match.plan.partner.share)}</AppText>
        </Row>
        <AppText variant="small" muted>
          The final split follows the meter, at the same ratio.
        </AppText>
      </Card>

      {match.youBook ? (
        <Card>
          <AppText variant="heading">After the ride</AppText>
          <Field
            label="Total on the meter (€)"
            value={fare}
            onChangeText={setFare}
            keyboardType="decimal-pad"
            placeholder={(match.plan.fare / 100).toFixed(2)}
            testID="fare-input"
          />
          <Button title="Split the fare" onPress={settle} loading={complete.isPending} disabled={!fare} />
        </Card>
      ) : (
        <AppText variant="small" muted style={{ color: c.muted }}>
          {`${name} enters the final fare after the ride and we'll show what you owe.`}
        </AppText>
      )}

      <CancelButton trip={trip} onError={onError} label="Cancel ride" warning="Tap again to cancel. Your fee won't be refunded" />
    </>
  );
}

function Completed({ trip, match, onError }: Section & { match: MatchView }) {
  const { c } = useTheme();
  const rate = useRate();
  const s = match.settlement;
  const name = match.partner.firstName;
  const myShare = s ? (match.youBook ? s.actualFare - s.owedToYou : s.youOwe) : match.plan.you.share;
  const saved = match.plan.you.soloFare - myShare - match.plan.you.fee;
  return (
    <>
      {s ? (
        <Card>
          <AppText variant="heading">{match.youBook ? `${name} owes you ${money(s.owedToYou)}` : `You owe ${name} ${money(s.youOwe)}`}</AppText>
          <AppText variant="small" muted>
            {`That's ${match.youBook ? 'their' : 'your'} share of the ${money(s.actualFare)} fare. Settle up with Revolut, cash or any payment app.`}
          </AppText>
        </Card>
      ) : null}
      {saved > 0 ? <Note tone="good">{`You saved about ${money(saved)} compared with taking a taxi alone.`}</Note> : null}
      <Card>
        <AppText variant="heading">{match.youRated ? 'Thanks for rating' : `How was riding with ${name}?`}</AppText>
        {match.youRated ? null : (
          <Row style={{ justifyContent: 'space-between' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                disabled={rate.isPending}
                onPress={() => rate.mutate({ matchId: match.id, stars: n }, { onError })}
                hitSlop={8}
              >
                <Icon name="star-outline" size={34} color={c.accentStrong} />
              </Pressable>
            ))}
          </Row>
        )}
      </Card>
      <Button
        title={`Message ${name}`}
        variant="ghost"
        icon="chatbubble-ellipses-outline"
        onPress={() => router.push({ pathname: '/chat/[matchId]', params: { matchId: match.id, tripId: trip.id } })}
      />
    </>
  );
}
