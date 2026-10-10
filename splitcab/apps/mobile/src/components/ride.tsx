import type { MatchView, TripView } from '@splitcab/core';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { clock, countdown, money, pct, tripTimeLine } from '../lib/format';
import { radius, space, useTheme } from '../lib/theme';
import { AppText, Avatar, Card, Icon, Pill, Row, type Tone } from './ui';

export const STATUS: Record<TripView['status'], { label: string; tone: Tone }> = {
  pending_payment: { label: 'Confirm card', tone: 'warn' },
  searching: { label: 'Searching', tone: 'warn' },
  proposed: { label: 'Match found', tone: 'accent' },
  confirmed: { label: 'Confirmed', tone: 'ink' },
  completed: { label: 'Done', tone: 'good' },
  expired: { label: 'No match', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function TripHeader({ trip }: { trip: TripView }) {
  const s = STATUS[trip.status];
  return (
    <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="heading">
          {trip.origin.label} → {trip.destination.label}
        </AppText>
        <AppText variant="small" muted>
          {tripTimeLine(trip)}
        </AppText>
      </View>
      <Pill label={s.label} tone={s.tone} />
    </Row>
  );
}

// A trip in the list. Tapping opens its detail screen.
export function TripCard({ trip }: { trip: TripView }) {
  const { c } = useTheme();
  const m = trip.match;
  let line: string | null = null;
  if (trip.status === 'searching') line = `Looking for someone heading your way until ${clock(trip.searchUntil)}`;
  if (trip.status === 'proposed' && m) line = m.youAccepted ? `Waiting for ${m.partner.firstName} to accept` : `${m.partner.firstName} can share. Save ${money(m.plan.you.savings)}`;
  if (trip.status === 'confirmed' && m) line = `Riding with ${m.partner.firstName} · pickup ${clock(m.plan.you.pickupAt)}`;
  if (trip.status === 'pending_payment') line = 'Your bank needs you to approve the hold';
  return (
    <Link href={{ pathname: '/trip/[id]', params: { id: trip.id } }} asChild>
      <Pressable accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <Card>
          <TripHeader trip={trip} />
          {line ? (
            <Row gap={space.sm}>
              {trip.status === 'searching' ? <Pulse size={18} /> : <Icon name="chevron-forward" size={16} color={c.muted} />}
              <AppText variant="small" style={{ flex: 1 }}>
                {line}
              </AppText>
            </Row>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}

// Expanding rings while we search.
export function Pulse({ size = 56 }: { size?: number }) {
  const { c } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(anim, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const ring = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2,
    borderColor: c.accentStrong,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
  };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Searching">
      <Animated.View style={ring} />
      <View style={{ width: size * 0.36, height: size * 0.36, borderRadius: size, backgroundColor: c.accent }} />
    </View>
  );
}

export function Countdown({ until, prefix = '' }: { until: string; prefix?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <AppText variant="small" muted style={{ fontVariant: ['tabular-nums'] }}>
      {prefix}
      {countdown(until, now)}
    </AppText>
  );
}

export function PartnerRow({ match }: { match: MatchView }) {
  const p = match.partner;
  const meta = p.ratingAvg ? `★ ${p.ratingAvg.toFixed(1)} · ${p.ridesCompleted} shared rides` : 'New to SplitCab';
  return (
    <Row>
      <Avatar name={p.firstName} />
      <View style={{ flex: 1 }}>
        <AppText variant="heading">{p.firstName}</AppText>
        <AppText variant="small" muted>
          {meta}
          {p.seats > 1 ? ` · group of ${p.seats}` : ''}
        </AppText>
      </View>
    </Row>
  );
}

export function RouteTimeline({ match }: { match: MatchView }) {
  const { c } = useTheme();
  const name = match.partner.firstName;
  const action = (s: MatchView['plan']['route'][number]) => {
    const out = s.kind === 'dropoff';
    if (s.you && s.partner) return out ? 'You both get out' : `You and ${name} get in`;
    if (s.you) return out ? 'You get out' : 'You get in';
    return out ? `${name} gets out` : `${name} gets in`;
  };
  const stops = match.plan.route;
  return (
    <View accessibilityRole="list">
      {stops.map((s, i) => (
        <View key={`${s.kind}-${i}`} style={styles.stop}>
          <AppText variant="small" muted style={styles.stopTime}>
            {clock(s.at)}
          </AppText>
          <View style={styles.rail}>
            <View
              style={[
                styles.dot,
                { borderColor: c.ink, backgroundColor: s.kind === 'dropoff' ? c.ink : c.surface, borderRadius: s.kind === 'dropoff' ? 3 : 7 },
              ]}
            />
            {i < stops.length - 1 ? <View style={[styles.line, { backgroundColor: c.line }]} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: space.md }}>
            <AppText variant="body" style={{ fontWeight: '600' }}>
              {action(s)}
            </AppText>
            <AppText variant="small" muted>
              {s.label}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

export function PriceBreakdown({ match }: { match: MatchView }) {
  const { c } = useTheme();
  const y = match.plan.you;
  const line = (label: string, value: string, opts: { strike?: boolean; strong?: boolean; color?: string } = {}) => (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText variant="body" color={opts.color} style={opts.strong ? { fontWeight: '800' } : undefined}>
        {label}
      </AppText>
      <AppText
        variant="body"
        color={opts.color ?? (opts.strike ? c.muted : undefined)}
        style={[{ fontVariant: ['tabular-nums'] }, opts.strike && { textDecorationLine: 'line-through' }, opts.strong && { fontWeight: '800' }]}
      >
        {value}
      </AppText>
    </Row>
  );
  return (
    <View style={[styles.prices, { backgroundColor: c.surface2, borderColor: c.line }]}>
      {line('Taxi on your own', money(y.soloFare), { strike: true })}
      {line('Your share of the fare', money(y.share))}
      {line('Match fee', money(y.fee))}
      <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: c.line, marginVertical: 4 }} />
      {line('You save', `${money(y.savings)} (${pct(y.savings / y.soloFare)})`, { strong: true, color: c.good })}
    </View>
  );
}

export function MatchFacts({ match }: { match: MatchView }) {
  const y = match.plan.you;
  const facts: string[] = [];
  if (y.walkToPickupMin > 0) facts.push(`${y.walkToPickupMin} min walk to pickup`);
  if (y.walkFromDropMin > 0) facts.push(`${y.walkFromDropMin} min walk after drop-off`);
  facts.push(y.detourPct > 0.02 ? `Ride is ${pct(y.detourPct)} longer than alone` : 'No detour for you');
  facts.push(`Total fare about ${money(match.plan.fare)}`);
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      {facts.map((f) => (
        <Pill key={f} label={f} />
      ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  stop: { flexDirection: 'row', gap: space.sm },
  stopTime: { width: 64, textAlign: 'right', fontVariant: ['tabular-nums'], paddingTop: 2 },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 14, height: 14, borderWidth: 3, marginTop: 4, zIndex: 1 },
  line: { position: 'absolute', top: 18, bottom: 0, width: 2 },
  prices: { borderRadius: radius.md, borderWidth: 1, padding: space.md, gap: 6 },
});
