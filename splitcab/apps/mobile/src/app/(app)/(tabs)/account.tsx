import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { AppText, Avatar, Button, Card, Icon, Note, Row } from '../../../components/ui';
import { api, ApiError, setSession } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { registerForPush } from '../../../lib/push';
import { useConfig } from '../../../lib/queries';
import { space, useTheme } from '../../../lib/theme';

function LinkRow({ icon, label, onPress, detail }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; detail?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: space.md }}>
      <Row>
        <Icon name={icon} color={c.muted} />
        <AppText variant="body" style={{ flex: 1 }}>
          {label}
        </AppText>
        {detail ? (
          <AppText variant="small" muted>
            {detail}
          </AppText>
        ) : null}
        <Icon name="chevron-forward" size={16} color={c.muted} />
      </Row>
    </Pressable>
  );
}

export default function Account() {
  const { c } = useTheme();
  const { me, signOut } = useAuth();
  const config = useConfig();
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 6000);
    return () => clearTimeout(t);
  }, [deleteArmed]);

  async function exportData() {
    try {
      const data = await api.get<object>('/v1/me/export');
      await Share.share({ title: 'My SplitCab data', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ApiError ? e.message : "Couldn't export your data." });
    }
  }

  async function deleteAccount() {
    if (!deleteArmed) return setDeleteArmed(true);
    setDeleting(true);
    try {
      await api.delete('/v1/me');
      await setSession(null);
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ApiError ? e.message : "Couldn't delete your account." });
      setDeleting(false);
    }
  }

  const support = config.data?.supportEmail ?? 'support@splitcab.ie';

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card>
        <Row>
          <Avatar name={me?.firstName ?? '?'} tone="ink" size={52} />
          <View style={{ flex: 1 }}>
            <AppText variant="heading">{me?.firstName}</AppText>
            <AppText variant="small" muted>
              {me?.phone}
            </AppText>
            <AppText variant="small" muted>
              {me?.ratingAvg ? `★ ${me.ratingAvg.toFixed(1)} · ` : ''}
              {`${me?.ridesCompleted ?? 0} shared ride${me?.ridesCompleted === 1 ? '' : 's'}`}
            </AppText>
          </View>
        </Row>
      </Card>

      {message ? <Note tone={message.tone}>{message.text}</Note> : null}

      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        <LinkRow
          icon="notifications-outline"
          label="Match notifications"
          onPress={async () => {
            const ok = await registerForPush(true).catch(() => false);
            setMessage(ok ? { tone: 'good', text: "Notifications are on. We'll tell you the moment you're matched." } : { tone: 'bad', text: 'Turn on notifications for SplitCab in your phone settings.' });
          }}
        />
        <LinkRow
          icon="mail-outline"
          label="Contact support"
          detail={support}
          onPress={async () => {
            await Clipboard.setStringAsync(support);
            setMessage({ tone: 'good', text: `Copied ${support}.` });
          }}
        />
        <LinkRow icon="document-text-outline" label="Terms of Service" onPress={() => config.data && WebBrowser.openBrowserAsync(config.data.termsUrl)} />
        <LinkRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => config.data && WebBrowser.openBrowserAsync(config.data.privacyUrl)} />
        <LinkRow icon="download-outline" label="Download my data" onPress={exportData} />
      </Card>

      <Button title="Sign out" variant="ghost" onPress={signOut} />
      <View style={{ gap: space.xs }}>
        <Button title={deleteArmed ? 'Tap again to delete your account' : 'Delete account'} variant="danger" loading={deleting} onPress={deleteAccount} />
        {deleteArmed ? (
          <AppText variant="small" muted style={{ textAlign: 'center' }}>
            Open trips are cancelled and your profile is erased. Payment records are kept as the law requires.
          </AppText>
        ) : null}
      </View>
      <AppText variant="small" muted style={{ textAlign: 'center' }}>
        {`SplitCab ${Constants.expoConfig?.version ?? ''}`}
      </AppText>
    </ScrollView>
  );
}
