import { CONFIG, rideSavings, type MatchView, type TripView } from '@splitcab/core';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { QrCode } from '../../../components/QrCode';
import { RouteMap } from '../../../components/RouteMap';
import { BookingLine, Countdown, MatchFacts, PartnerRow, PriceBreakdown, Pulse, RouteTimeline, SafetyButton, TripHeader } from '../../../components/ride';
import { AppText, Button, Card, Divider, Field, Icon, Note, Row, Screen } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DEMO } from '../../../lib/demo';
import { bookingOptions } from '../../../lib/booking';
import { confirmDestructive } from '../../../lib/confirm';
import { clock, money, parseEuro } from '../../../lib/format';
import { mapPoints } from '../../../lib/mapPoints';
import { useCardPayments } from '../../../lib/payments';
import { updateDraft } from '../../../lib/planDraft';
import { pushStatus, registerForPush, type PushStatus } from '../../../lib/push';
import { useCancelTrip, useComplete, useConfig, useConfirmHold, useDemoFinishRide, useMarkPaid, useRate, useRespond, useTrip } from '../../../lib/queries';
import { revolutLink } from '../../../lib/revolut';
import { space, useTheme } from '../../../lib/theme';

const chatPath = (match: MatchView, trip: TripView, draft?: string) =>
  ({ pathname: '/chat/[matchId]', params: { matchId: match.id, tripId: trip.id, ...(draft ? { draft } : {}) } }) as const;

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const t = trip.data;
  const showSafety = t?.match && ['proposed', 'confirmed', 'completed'].includes(t.match.status);

  return (
    <>
      <Stack.Screen options={{ headerRight: () => (showSafety ? <SafetyButton matchId={t!.match!.id} name={t!.match!.partner.firstName} /> : null) }} />
      <Screen>
        {trip.isError && t ? <Note tone="warn" icon="cloud-offline-outline">{`No connection. Showing the last update from ${clock(trip.dataUpdatedAt)}.`}</Note> : null}
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
      <TripHeader trip={trip} showStatus={false} />
      {error ? <Note tone="bad">{error}</Note> : null}
      {trip.status === 'pending_payment' ? <PendingPayment trip={trip} onError={onError} /> : null}
      {trip.status === 'searching' ? <Searching trip={trip} onError={onError} /> : null}
      {trip.status === 'proposed' && trip.match ? <Proposed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'confirmed' && trip.match ? <Confirmed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'completed' && trip.match ? <Completed trip={trip} match={trip.match} onError={onError} /> : null}
      {trip.status === 'expired' ? (
        <>
          <Note tone="good">{`We couldn't find anyone in time. You weren't charged. Your bank may show ${money(trip.payment?.amount ?? 199)} as pending for a few days; it will drop off.`}</Note>
          <TryAgain trip={trip} />
        </>
      ) : null}
      {trip.status === 'cancelled' ? (
        <>
          {trip.payment?.status === 'captured' ? (
            <Note>{`You cancelled after you'd both said yes, so the ${money(trip.payment.amount)} match fee wasn't refunded.`}</Note>
          ) : (
            <Note tone="good">Cancelled. You weren't charged.</Note>
          )}
          <TryAgain trip={trip} />
        </>
      ) : null}
    </>
  );
}

type Section = { trip: TripView; onError: (e: unknown) => void };

function TryAgain({ trip }: { trip: TripView }) {
  return (
    <Button
      title="Try again"
      icon="refresh"
      onPress={() => {
        updateDraft({
          origin: trip.origin,
          destination: trip.destination,
          timeMode: trip.timeMode,
          flexMin: trip.flexMin,
          seats: trip.seats,
          time: new Date(Math.max(new Date(trip.time).getTime(), Date.now() + 15 * 60_000)),
        });
        router.push('/plan');
      }}
    />
  );
}

function CancelButton({ trip, onError, warning }: Section & { warning: string }) {
  const cancel = useCancelTrip();
  return (
    <Button
      title="Cancel trip"
      variant="link"
      loading={cancel.isPending}
      onPress={() => confirmDestructive({ title: 'Cancel this trip?', message: warning, confirm: 'Cancel trip', onConfirm: () => cancel.mutate(trip.id, { onError }) })}
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
      <Note tone="warn">{`Your bank needs you to confirm the ${money(trip.payment?.amount ?? 199)} hold. We'll start looking as soon as you do.`}</Note>
      {trip.paymentAction ? <Button title="Confirm with my bank" onPress={approve} loading={busy} /> : <AppText muted>Placing the hold…</AppText>}
      <CancelButton trip={trip} onError={onError} warning="You won't be charged." />
    </>
  );
}

function FellThrough({ match }: { match: MatchView | null }) {
  if (!match || !['declined', 'expired', 'cancelled'].includes(match.status)) return null;
  const name = match.partner.firstName;
  const why =
    match.status === 'declined'
      ? `You and ${name} didn't both say yes`
      : match.status === 'expired'
        ? `The match with ${name} timed out`
        : match.cancelledByPartner
          ? `${name} cancelled`
          : 'Your last match was cancelled';
  const refund = match.status === 'cancelled' && match.cancelledByPartner && match.confirmedAt ? ' Your match fee is being refunded.' : '';
  return <Note tone="warn">{`${why}, so we're looking again.${refund}`}</Note>;
}

// A match for a trip leaving soon has to be answered within 10 minutes, so someone who pockets their phone needs a
// notification to catch one.
function NotificationsPrompt() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  useEffect(() => {
    pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);
  if (!status || status === 'on' || status === 'unsupported') return null;
  return (
    <Card>
      <Row gap={space.sm}>
        <Icon name="notifications-outline" />
        <AppText variant="heading" style={{ flex: 1 }}>
          Get told the moment we find someone
        </AppText>
      </Row>
      <AppText variant="small" muted>
        {`If your trip leaves soon, you'll have ${CONFIG.accept.minMinutes} minutes to say yes.`}
      </AppText>
      {status === 'askable' ? (
        <Button title="Turn on notifications" variant="dark" onPress={async () => setStatus((await registerForPush(true)) ? 'on' : await pushStatus())} />
      ) : (
        <Button title="Open Settings" variant="ghost" onPress={() => Linking.openSettings()} />
      )}
    </Card>
  );
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
              {`No match by ${clock(trip.searchUntil)}? We release the ${money(trip.payment?.amount ?? 199)} hold and you can take a taxi as usual (about ${money(trip.soloFare)}).`}
            </AppText>
          </View>
        </Row>
        <RouteMap points={mapPoints(trip)} height={150} />
      </Card>
      <NotificationsPrompt />
      <CancelButton trip={trip} onError={onError} warning="The hold on your card is released. You won't be charged." />
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
        <RouteMap points={mapPoints(trip, match)} />
        <RouteTimeline match={match} />
      </Card>
      <PriceBreakdown match={match} />
      <BookingLine match={match} />
      <MatchFacts match={match} />
      {match.youAccepted ? (
        <>
          <Note tone="warn">
            <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
              <AppText variant="small">{`You said yes. Waiting for ${name}`}</AppText>
              <Countdown until={match.expiresAt} prefix=" (" suffix=" left)" longPrefix=" (until " longSuffix=")" />
              <AppText variant="small">{`. You're only charged if ${name} says yes too.`}</AppText>
            </Row>
          </Note>
          <CancelButton trip={trip} onError={onError} warning="You won't be charged." />
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
            <Countdown until={match.expiresAt} prefix="Respond within " longPrefix="Respond by " />
            {match.partnerAccepted ? <AppText variant="small" muted>{` · ${name} has said yes`}</AppText> : null}
          </Row>
          <AppText variant="small" muted style={{ textAlign: 'center' }}>
            {`If you both accept, the ${money(match.plan.you.fee)} is charged. It's refunded if ${name} cancels, but not if you do.`}
          </AppText>
        </>
      )}
    </>
  );
}

function Confirmed({ trip, match, onError }: Section & { match: MatchView }) {
  const complete = useComplete();
  const finishRide = useDemoFinishRide();
  const [fare, setFare] = useState('');
  const [copied, setCopied] = useState(false);
  const name = match.partner.firstName;
  const route = match.plan.route;
  const myPickup = route.find((s) => s.you && s.kind === 'pickup');
  const partnerStops = route.slice(1, -1).filter((s) => s.partner && !s.you);
  const options = bookingOptions(route);
  const open = (url: string, label: string) => Linking.openURL(url).catch(() => onError(new ApiError(0, 'open', `Couldn't open ${label}.`)));
  // The fare form only makes sense once the ride is about to happen.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const rideStarted = now >= new Date(match.plan.you.pickupAt).getTime() - 10 * 60_000;

  function settle() {
    const cents = parseEuro(fare);
    if (cents === null) return onError(new ApiError(400, 'invalid_fare', 'Enter the total on the meter, for example 36.91.'));
    complete.mutate({ matchId: match.id, actualFare: cents }, { onError });
  }

  return (
    <>
      <Note tone="good">{`You're sharing with ${name}. Your ${money(match.plan.you.fee)} match fee has been charged.`}</Note>

      {match.youBook ? (
        <Card>
          <AppText variant="heading">You book the taxi</AppText>
          <AppText variant="body">
            {`Book a taxi for ${clock(match.plan.startAt)} from ${route[0]!.label}`}
            {partnerStops.length
              ? `, with a stop at ${partnerStops.map((s) => s.label).join(' and ')} for ${name}. Uber fills in your pickup and destination; add ${name}'s stop yourself.`
              : `. ${name} will meet you there.`}
          </AppText>
          <Row>
            {options
              .filter((o) => o.id !== 'maps')
              .map((o, i) => (
                <Button key={o.id} title={o.label} variant={i === 0 ? 'primary' : 'ghost'} icon="open-outline" style={{ flex: 1 }} onPress={() => open(o.url, o.label)} />
              ))}
          </Row>
          <Button title="Show the driver the route" variant="ghost" icon="map-outline" onPress={() => open(options.find((o) => o.id === 'maps')!.url, 'Maps')} />
          <Button
            title={copied ? 'Pickup address copied' : 'Copy pickup address'}
            variant="link"
            onPress={async () => {
              await Clipboard.setStringAsync(route[0]!.label);
              setCopied(true);
            }}
          />
        </Card>
      ) : (
        <Card>
          <AppText variant="heading">{`${name} books the taxi`}</AppText>
          <AppText variant="body">
            {`Be at ${myPickup?.label ?? 'your pickup'} by ${clock(match.plan.you.pickupAt)}`}
            {match.plan.you.walkToPickupMin ? ` (about a ${match.plan.you.walkToPickupMin} min walk).` : '.'}
          </AppText>
        </Card>
      )}

      <Card>
        <PartnerRow match={match} />
        <RouteMap points={mapPoints(trip, match)} />
        <RouteTimeline match={match} />
        <Button title={`Message ${name}`} icon="chatbubble-ellipses-outline" variant="ghost" onPress={() => router.push(chatPath(match, trip))} />
      </Card>

      <Card>
        <AppText variant="heading">After the ride</AppText>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">Your share</AppText>
          <AppText variant="body" style={{ fontWeight: '700' }}>{`about ${money(match.plan.you.share)}`}</AppText>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{`${name}'s share`}</AppText>
          <AppText variant="body">{`about ${money(match.plan.partner.share)}`}</AppText>
        </Row>
        <AppText variant="small" muted>
          {match.youBook
            ? `If the meter total is different, both shares change in proportion. ${name} pays you their share.`
            : `If the meter total is different, both shares change in proportion. You pay ${name} your share.`}
        </AppText>
        {match.youBook ? (
          rideStarted ? (
            <>
              <Divider />
              <Field label="Total on the meter (€)" value={fare} onChangeText={setFare} keyboardType="decimal-pad" placeholder={`e.g. ${(match.plan.fare / 100).toFixed(2)}`} testID="fare-input" />
              <Button title="Split the fare" onPress={settle} loading={complete.isPending} disabled={!fare} />
            </>
          ) : (
            <AppText variant="small" muted>
              After the ride, you'll enter the meter total here.
            </AppText>
          )
        ) : null}
        {DEMO && !rideStarted ? <Button title="Skip to after the ride (demo)" variant="link" onPress={() => finishRide.mutate(match.id, { onError })} loading={finishRide.isPending} /> : null}
      </Card>

      <CancelButton trip={trip} onError={onError} warning={`Your ${money(match.plan.you.fee)} match fee won't be refunded, and ${name} will need to find someone else.`} />
    </>
  );
}

// The person who didn't book pays the booker back directly. SplitCab never holds this money.
function PayBack({ match, onError }: { match: MatchView; onError: (e: unknown) => void }) {
  const markPaid = useMarkPaid();
  const [copied, setCopied] = useState(false);
  const s = match.settlement!;
  const name = match.partner.firstName;
  const amount = money(s.youOwe);
  const revtag = s.bookerRevtag;

  async function copyAmount() {
    await Clipboard.setStringAsync((s.youOwe / 100).toFixed(2));
    setCopied(true);
  }

  return (
    <Card>
      <AppText variant="title">{s.paidAt ? `You paid ${name} ${amount}` : `You owe ${name} ${amount}`}</AppText>
      <AppText variant="small" muted>
        {`That's your share of the ${money(s.actualFare)} fare.`}
      </AppText>
      {s.paidAt ? (
        <Note tone="good">{`We've let ${name} know. Thanks!`}</Note>
      ) : (
        <>
          {revtag ? (
            <>
              <Button title={`Pay ${amount} with Revolut`} icon="open-outline" onPress={() => Linking.openURL(revolutLink(revtag)).catch(onError)} />
              <AppText variant="small" muted>
                {`Opens @${revtag}'s Revolut page. Enter ${amount} and pay with Revolut or any card.`}
              </AppText>
              <Button title={copied ? 'Amount copied' : 'Copy the amount'} variant="link" onPress={copyAmount} />
            </>
          ) : (
            <AppText variant="small" muted>
              {`Pay ${name} in cash, or ask for their Revtag in chat to pay by Revolut.`}
            </AppText>
          )}
          <Button title={`I've paid ${name}`} variant="ghost" icon="checkmark-circle-outline" loading={markPaid.isPending} onPress={() => markPaid.mutate(match.id, { onError })} />
        </>
      )}
    </Card>
  );
}

// The booker gets paid back: a QR code of their Revolut page to scan in person, or a reminder.
function GetPaidBack({ trip, match }: { trip: TripView; match: MatchView }) {
  const { me } = useAuth();
  const [showQr, setShowQr] = useState(false);
  const s = match.settlement!;
  const name = match.partner.firstName;
  const amount = money(s.owedToYou);

  return (
    <Card>
      <AppText variant="title">{s.paidAt ? `${name} says they've paid you ${amount}` : `${name} owes you ${amount}`}</AppText>
      <AppText variant="small" muted>
        {`That's their share of the ${money(s.actualFare)} fare.`}
      </AppText>
      {s.paidAt ? (
        <Note tone="good">Check your Revolut or bank app to make sure it arrived.</Note>
      ) : (
        <>
          {me?.revtag ? (
            <>
              {showQr ? (
                <View style={{ alignItems: 'center', gap: space.sm }}>
                  <QrCode value={revolutLink(me.revtag)} label={`QR code to pay @${me.revtag} on Revolut`} />
                  <AppText variant="small" muted style={{ textAlign: 'center' }}>
                    {`${name} scans this with their phone camera and pays you ${amount}.`}
                  </AppText>
                </View>
              ) : (
                <AppText variant="small" muted>
                  {`${name} can pay you from the Revolut app, or by card on your Revolut page.`}
                </AppText>
              )}
              <Button title={showQr ? 'Hide the QR code' : 'Show my Revolut QR code'} variant={showQr ? 'link' : 'dark'} icon={showQr ? undefined : 'qr-code-outline'} onPress={() => setShowQr(!showQr)} />
            </>
          ) : (
            <Button title="Add your Revtag to get paid by Revolut" variant="dark" icon="cash-outline" onPress={() => router.push('/revtag')} />
          )}
          <Button title={`Remind ${name}`} variant="ghost" icon="chatbubble-ellipses-outline" onPress={() => router.push(chatPath(match, trip, `Hi ${name}, your share of the taxi is ${amount}. Thanks!`))} />
        </>
      )}
    </Card>
  );
}

function Completed({ trip, match, onError }: Section & { match: MatchView }) {
  const { c } = useTheme();
  const rate = useRate();
  const [stars, setStars] = useState(0);
  const s = match.settlement;
  const name = match.partner.firstName;
  const myShare = s ? (match.youBook ? s.actualFare - s.owedToYou : s.youOwe) : match.plan.you.share;
  const saved = rideSavings(match.plan.you, myShare, match.plan.you.fee);

  function pick(n: number) {
    setStars(n);
    rate.mutate({ matchId: match.id, stars: n }, { onError: (e) => (setStars(0), onError(e)) });
  }

  return (
    <>
      {s && (s.youOwe > 0 || s.owedToYou > 0) ? (match.youBook ? <GetPaidBack trip={trip} match={match} /> : <PayBack match={match} onError={onError} />) : null}
      {saved > 0 ? <Note tone="good">{`You saved about ${money(saved)} compared with taking a taxi alone.`}</Note> : null}
      <Card>
        <AppText variant="heading">{match.youRated || (stars && rate.isSuccess) ? 'Thanks for rating' : `How was sharing with ${name}?`}</AppText>
        {match.youRated ? null : (
          <Row style={{ justifyContent: 'space-between' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                accessibilityState={{ selected: n <= stars }}
                disabled={rate.isPending || rate.isSuccess}
                onPress={() => pick(n)}
                hitSlop={8}
              >
                <Icon name={n <= stars ? 'star' : 'star-outline'} size={34} color={c.accentStrong} />
              </Pressable>
            ))}
          </Row>
        )}
        {stars > 0 && stars <= 2 ? (
          <Button title="Report a problem" variant="link" onPress={() => router.push({ pathname: '/report/[matchId]', params: { matchId: match.id, name } })} />
        ) : null}
      </Card>
      <Button title="View receipt" variant="ghost" icon="receipt-outline" onPress={() => router.push({ pathname: '/receipt/[tripId]', params: { tripId: trip.id } })} />
      <Button title={`Message ${name}`} variant="ghost" icon="chatbubble-ellipses-outline" onPress={() => router.push(chatPath(match, trip))} />
    </>
  );
}
