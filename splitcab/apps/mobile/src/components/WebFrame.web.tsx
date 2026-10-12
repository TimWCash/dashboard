import type { ReactNode } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { DEMO, DEMO_SHARED } from '../lib/demo';
import { space, useTheme } from '../lib/theme';
import { QrCode } from './QrCode';
import { AppText, Icon, Pill } from './ui';

// The app is designed for phones. In a wide browser window it keeps a phone's width, centred, and in the demo a
// panel beside it explains what to try and offers a QR code to carry on on a phone.
const COLUMN = 420;
const FRAME_FROM = 720;
const PANEL_FROM = { width: 1000, height: 720 };

export function WebFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const { c, dark } = useTheme();
  if (width < FRAME_FROM) return <>{children}</>;
  return (
    <View style={[styles.backdrop, { backgroundColor: dark ? '#0A0B0D' : '#E9E7DF', gap: width >= 1200 ? 88 : 56 }]}>
      {DEMO && width >= PANEL_FROM.width && height >= PANEL_FROM.height ? <DemoPanel /> : null}
      <View
        style={[
          styles.app,
          {
            height: Math.min(height - space.xxl * 2, 880),
            backgroundColor: c.bg,
            borderColor: c.line,
            boxShadow: dark ? '0 30px 80px rgba(0, 0, 0, 0.6)' : '0 30px 80px rgba(22, 24, 29, 0.16), 0 8px 24px rgba(22, 24, 29, 0.08)',
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function DemoPanel() {
  const { c } = useTheme();
  const points: [Parameters<typeof Icon>[0]['name'], string][] = [
    ['phone-portrait-outline', 'Sign in with any Irish mobile number. No text is sent.'],
    ['card-outline', 'Payments are pretend, so nothing is ever charged.'],
    DEMO_SHARED
      ? ['people-outline', "Open it on two phones and you'll be matched with each other. On your own, a pretend traveller joins after a moment."]
      : ['people-outline', "You're matched with a pretend traveller."],
    DEMO_SHARED ? ['time-outline', 'Your demo account is deleted after a day without use.'] : ['lock-closed-outline', 'Everything stays in this browser.'],
  ];
  return (
    <View style={styles.panel}>
      <View style={styles.brand}>
        <View style={[styles.mark, { backgroundColor: c.accent }]}>
          <Image source={require('../../assets/splash-icon.png')} style={{ width: 30, height: 30 }} />
        </View>
        <AppText style={styles.wordmark}>SplitCab</AppText>
      </View>

      <View style={{ gap: space.md, alignItems: 'flex-start' }}>
        <Pill label="Live demo" tone="accent" />
        <AppText style={styles.headline} accessibilityRole="header">
          Try the whole trip, start to finish.
        </AppText>
        <AppText style={styles.lede} muted>
          Plan a trip, get matched, accept, chat, then split the fare and pay back by Revolut. It's the real app, running in your browser.
        </AppText>
      </View>

      <View style={{ gap: space.lg }}>
        {points.map(([icon, text]) => (
          <View key={text} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: c.surface, borderColor: c.line }]}>
              <Icon name={icon} size={18} />
            </View>
            <AppText variant="body" style={{ flex: 1 }}>
              {text}
            </AppText>
          </View>
        ))}
      </View>

      <View style={[styles.qrCard, { backgroundColor: c.surface, borderColor: c.line }]}>
        <QrCode value={window.location.origin} size={112} label="QR code that opens this demo on a phone" />
        <View style={{ flex: 1, gap: space.xs }}>
          <AppText variant="heading">Open it on your phone</AppText>
          <AppText variant="small" muted>
            {DEMO_SHARED ? 'Scan with your camera. Ask a friend to scan it too, and plan the same trip.' : 'Scan with your camera to try it on your phone.'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  app: { width: COLUMN, borderRadius: 28, borderWidth: 1, overflow: 'hidden' },
  panel: { width: 400, gap: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 22, lineHeight: 26, fontWeight: '800', letterSpacing: -0.5 },
  headline: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2 },
  lede: { fontSize: 18, lineHeight: 27 },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pointIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qrCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, borderRadius: 18, borderWidth: 1 },
});
