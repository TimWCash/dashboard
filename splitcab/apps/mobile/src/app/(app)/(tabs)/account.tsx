import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { AppText, Avatar, Button, Card, Icon, LinkRow, Note, Row } from '../../../components/ui';
import { api, ApiError, setSession } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { confirmDestructive } from '../../../lib/confirm';
import { formatPhone } from '../../../lib/format';
import { useCardPayments } from '../../../lib/payments';
import { pushStatus, registerForPush, type PushStatus } from '../../../lib/push';
import { useConfig } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

export default function Account() {
  const { c } = useTheme();
  const { me, setMe, signOut } = useAuth();
  const config = useConfig();
  const { saveCard } = useCardPayments();
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      pushStatus().then(setPush).catch(() => setPush('unsupported'));
    }, []),
  );

  const support = config.data?.supportEmail ?? 'support@splitcab.ie';
  const fail = (e: unknown, fallback: string) => setMessage({ tone: 'bad', text: e instanceof ApiError ? e.message : fallback });

  async function notifications() {
    if (push === 'askable') {
      setPush((await registerForPush(true).catch(() => false)) ? 'on' : await pushStatus());
    } else {
      Linking.openSettings().catch(() => {});
    }
  }

  async function contact() {
    try {
      await Linking.openURL(`mailto:${support}?subject=${encodeURIComponent('SplitCab help')}`);
    } catch {
      await Clipboard.setStringAsync(support);
      setMessage({ tone: 'good', text: `No email app found. We copied ${support} for you.` });
    }
  }

  function deleteAccount() {
    confirmDestructive({
      title: 'Delete your account?',
      message: 'Open trips are cancelled and your name, number and card are erased. This cannot be undone.',
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

  const card = me?.paymentMethod;
  const trips = me?.ridesCompleted ?? 0;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card>
        <Row>
          <Avatar name={me?.firstName ?? '?'} tone="ink" size={52} />
          <View style={{ flex: 1 }}>
            <AppText variant="heading">{me?.firstName}</AppText>
            <AppText variant="small" muted>
              {me?.phone ? formatPhone(me.phone) : ''}
            </AppText>
            <AppText variant="small" muted>
              {me?.ratingAvg ? `★ ${me.ratingAvg.toFixed(1)} · ` : ''}
              {`${trips} shared trip${trips === 1 ? '' : 's'}`}
            </AppText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit your name" onPress={() => router.push('/name')} hitSlop={12}>
            <Icon name="create-outline" color={c.muted} />
          </Pressable>
        </Row>
      </Card>

      {message ? <Note tone={message.tone}>{message.text}</Note> : null}

      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        <LinkRow
          icon="card-outline"
          label="Payment card"
          detail={card ? `${card.brand.toUpperCase()} •••• ${card.last4}` : 'Add'}
          onPress={async () => {
            if (!config.data) return;
            try {
              const updated = await saveCard(config.data);
              if (updated) setMe(updated);
            } catch (e) {
              fail(e, "Couldn't save your card.");
            }
          }}
        />
        <LinkRow icon="cash-outline" label="Get paid back by Revolut" detail={me?.revtag ? `@${me.revtag}` : 'Add'} onPress={() => router.push('/revtag')} />
        <LinkRow icon="receipt-outline" label="Payments" onPress={() => router.push('/payments')} />
        {push && push !== 'unsupported' ? (
          <LinkRow icon="notifications-outline" label="Match notifications" detail={push === 'on' ? 'On' : 'Off'} onPress={notifications} />
        ) : null}
      </Card>

      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        <LinkRow icon="help-circle-outline" label="How SplitCab works" onPress={() => router.push('/how-it-works')} />
        <LinkRow icon="mail-outline" label="Contact support" onPress={contact} />
        <LinkRow icon="document-text-outline" label="Terms of Service" onPress={() => config.data && WebBrowser.openBrowserAsync(config.data.termsUrl)} />
        <LinkRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => config.data && WebBrowser.openBrowserAsync(config.data.privacyUrl)} />
        <LinkRow icon="shield-checkmark-outline" label="Privacy & your data" onPress={() => router.push('/privacy')} />
      </Card>

      <Button title="Sign out" variant="ghost" onPress={signOut} />
      <Button title="Delete account" variant="danger" loading={deleting} onPress={deleteAccount} />
      <AppText variant="small" muted style={{ textAlign: 'center' }}>
        {`SplitCab ${Constants.expoConfig?.version ?? ''}`}
      </AppText>
    </ScrollView>
  );
}
