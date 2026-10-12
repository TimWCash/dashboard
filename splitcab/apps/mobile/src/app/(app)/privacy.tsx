import { RETENTION } from '@splitcab/core';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { AppText, Button, Card, LinkRow, Note, Screen } from '../../components/ui';
import { api, ApiError, setSession } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { confirmDestructive } from '../../lib/confirm';
import { DEMO, DEMO_SHARED } from '../../lib/demo';
import { exportMyData } from '../../lib/exportData';
import { useConfig } from '../../lib/queries';
import { space } from '../../lib/theme';

const years = (days: number) => Math.round(days / 365);

// Everything about your data in one place: what's kept and for how long, and your GDPR rights.
export default function Privacy() {
  const { me } = useAuth();
  const config = useConfig();
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const support = config.data?.supportEmail ?? 'support@splitcab.ie';
  const fail = (e: unknown, fallback: string) => setMessage({ tone: 'bad', text: e instanceof ApiError ? e.message : fallback });

  const kept: [string, string][] = [
    [
      'Your account: name, mobile number, Revtag',
      DEMO_SHARED
        ? 'Until you delete it, or after a day without using this demo'
        : `Until you delete it, or after ${years(RETENTION.inactiveAccountDays)} years without using SplitCab`,
    ],
    ['Chat messages', `${RETENTION.messagesDays} days`],
    ['Exact pickup and drop-off places', `${years(RETENTION.exactPlacesDays)} year, then only the rough area`],
    ['Trips, payments and receipts', `${years(RETENTION.recordsDays)} years, as Irish tax law requires`],
    ['Details of safety reports', `${years(RETENTION.reportDetailsDays)} years`],
  ];

  async function download() {
    setMessage(null);
    try {
      await exportMyData();
    } catch (e) {
      fail(e, "Couldn't export your data.");
    }
  }

  async function emailUs() {
    try {
      await Linking.openURL(`mailto:${support}?subject=${encodeURIComponent('Privacy request')}`);
    } catch {
      await Clipboard.setStringAsync(support);
      setMessage({ tone: 'good', text: `No email app found. We copied ${support} for you.` });
    }
  }

  function deleteAccount() {
    confirmDestructive({
      title: 'Delete your account?',
      message: 'Open trips are cancelled and your name, number, Revtag and card are erased. This cannot be undone.',
      confirm: 'Delete account',
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.delete('/v1/me');
          await setSession(null);
        } catch (e) {
          fail(e, "Couldn't delete your account.");
          setDeleting(false);
        }
      },
    });
  }

  return (
    <Screen>
      <Card>
        <AppText variant="heading" accessibilityRole="header">
          What we keep, and for how long
        </AppText>
        {kept.map(([what, howLong]) => (
          <View key={what} style={{ gap: 2 }}>
            <AppText variant="body">{what}</AppText>
            <AppText variant="small" muted>
              {howLong}
            </AppText>
          </View>
        ))}
        <AppText variant="small" muted>
          We never sell your data or use it for advertising, and there are no trackers in the app. Your card details are held by Stripe, not
          by us.
        </AppText>
      </Card>

      {message ? <Note tone={message.tone}>{message.text}</Note> : null}

      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        <LinkRow icon="download-outline" label="Download my data" detail="JSON" onPress={download} />
        <LinkRow icon="create-outline" label="Correct my name" detail={me?.firstName ?? undefined} onPress={() => router.push('/name')} />
        <LinkRow icon="cash-outline" label="Revolut username" detail={me?.revtag ? `@${me.revtag}` : 'Not added'} onPress={() => router.push('/revtag')} />
      </Card>

      <Card>
        <AppText variant="heading">Your rights</AppText>
        <AppText variant="body" muted>
          You can ask us to access, correct, delete, restrict or move your data, or object to how we use it. Email us and we'll reply within a
          month. If you're unhappy with our answer, you can complain to the Data Protection Commission.
        </AppText>
        <Button title="Email us about your data" variant="ghost" icon="mail-outline" onPress={emailUs} />
        {DEMO ? (
          <Button title="How this demo uses your data" variant="link" onPress={() => router.push('/demo-privacy')} />
        ) : (
          <Button title="Privacy Policy" variant="link" onPress={() => config.data && WebBrowser.openBrowserAsync(config.data.privacyUrl)} />
        )}
        <Button title="Data Protection Commission" variant="link" onPress={() => WebBrowser.openBrowserAsync('https://www.dataprotection.ie')} />
      </Card>

      <Button title="Delete my account" variant="danger" loading={deleting} onPress={deleteAccount} />
    </Screen>
  );
}
