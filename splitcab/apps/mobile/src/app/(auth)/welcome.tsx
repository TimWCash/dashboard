import { formatMoney } from '@splitcab/core';
import { router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Note, Screen } from '../../components/ui';
import { DEMO, DEMO_SHARED } from '../../lib/demo';
import { useConfig } from '../../lib/queries';
import { space, useTheme } from '../../lib/theme';

const STEPS = [
  ['Post your trip', 'Pickup, destination, and roughly when you want to leave or arrive.'],
  ['Get matched', "We pair you with someone nearby heading your way and show exactly what you'll each pay."],
  ['Share one taxi', 'One of you books the taxi (Uber, FREENOW or a rank). After the ride, the other pays the booker back in one tap with Revolut, or in cash.'],
] as const;

export default function Welcome() {
  const { c } = useTheme();
  const config = useConfig();
  const fee = formatMoney(config.data?.matchFee ?? 199);
  return (
    <Screen edges={['top', 'bottom']} footer={<Button title="Continue with your phone number" onPress={() => router.push('/phone')} />}>
      <View style={{ gap: space.md, paddingTop: space.xl }}>
        <View style={[styles.mark, { backgroundColor: c.accent }]} accessibilityLabel="SplitCab">
          <Image source={require('../../../assets/splash-icon.png')} style={{ width: 40, height: 40 }} />
        </View>
        <AppText variant="hero" accessibilityRole="header">
          Share the taxi.{'\n'}Split the fare.
        </AppText>
      </View>
      <Card>
        {STEPS.map(([title, body], i) => (
          <View key={title} style={styles.step}>
            <View style={[styles.num, { backgroundColor: c.accent }]}>
              <AppText variant="caption" color={c.accentInk}>
                {i + 1}
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="heading">{title}</AppText>
              <AppText variant="small" muted>
                {body}
              </AppText>
            </View>
          </View>
        ))}
        <Note tone="good">
          <AppText variant="small" color={c.good}>
            <AppText variant="small" color={c.good} style={{ fontWeight: '700' }}>
              No match, no charge.{' '}
            </AppText>
            We only charge a {fee} match fee when you and your travel partner both say yes.
          </AppText>
        </Note>
      </Card>
      {DEMO ? (
        <Note>
          {DEMO_SHARED
            ? "This is a demo. Use any Irish mobile number: no text is sent and no card is charged. Try it with a friend on another phone and you'll be matched with each other. If nobody else is looking, a pretend traveller joins after a moment."
            : "This is a demo. Use any Irish mobile number: no text is sent and no card is charged. You'll be matched with a pretend traveller, and everything stays in this browser."}
        </Note>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mark: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', gap: space.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
