import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafetyButton } from '../../../components/ride';
import { AppText, Icon, Note } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { clock } from '../../../lib/format';
import { useMessages, useSendMessage, useTrip } from '../../../lib/queries';
import { radius, space, useTheme } from '../../../lib/theme';

export default function Chat() {
  const { c } = useTheme();
  const { matchId, tripId, draft } = useLocalSearchParams<{ matchId: string; tripId: string; draft?: string }>();
  const insets = useSafeAreaInsets();
  const trip = useTrip(tripId);
  const name = trip.data?.match?.partner.firstName ?? 'Your travel partner';
  const messages = useMessages(matchId, true);
  const send = useSendMessage(matchId);
  const [text, setText] = useState(draft ?? '');
  const scroll = useRef<ScrollView>(null);
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [count]);

  function submit(value = text) {
    const body = value.trim();
    if (!body) return;
    send.mutate(body, { onSuccess: () => setText('') });
  }

  const quickReplies = ["I'm here", 'Running 5 min late', 'What are you wearing?'];

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: name, headerRight: () => <SafetyButton matchId={matchId} name={name} /> }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
          <Note>Agree where to meet. Only pay the share shown in the app. Never share card details, PINs or passwords.</Note>
          {count === 0 ? (
            <AppText variant="small" muted style={{ textAlign: 'center', paddingVertical: space.lg }}>
              {`Say hi to ${name}.`}
            </AppText>
          ) : null}
          {messages.data?.map((m) => (
            <View
              key={m.id}
              accessible
              accessibilityLabel={`${m.mine ? 'You' : name}, ${clock(m.at)}: ${m.text}`}
              style={[
                styles.bubble,
                m.mine ? { alignSelf: 'flex-end', backgroundColor: c.accent } : { alignSelf: 'flex-start', backgroundColor: c.surface, borderColor: c.line, borderWidth: 1 },
              ]}
            >
              <AppText variant="body" color={m.mine ? c.accentInk : c.ink}>
                {m.text}
              </AppText>
              <AppText variant="caption" color={m.mine ? c.accentInk : c.muted} style={{ fontWeight: '400', fontSize: 12 }}>
                {clock(m.at)}
              </AppText>
            </View>
          ))}
          {send.error ? <Note tone="bad">{send.error instanceof ApiError ? send.error.message : "Couldn't send that message."}</Note> : null}
        </ScrollView>
        {/* flexGrow 0, or the row takes half the screen from the messages on the web. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.quick} keyboardShouldPersistTaps="handled">
          {quickReplies.map((q) => (
            <Pressable key={q} accessibilityRole="button" accessibilityLabel={`Send: ${q}`} onPress={() => submit(q)} style={[styles.chip, { borderColor: c.line, backgroundColor: c.surface }]}>
              <AppText variant="small">{q}</AppText>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: c.line, backgroundColor: c.surface }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message ${name}`}
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.ink, backgroundColor: c.surface2, borderColor: c.line }]}
            maxLength={500}
            multiline
            testID="chat-input"
            onSubmitEditing={() => submit()}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => submit()}
            disabled={!text.trim() || send.isPending}
            style={[styles.send, { backgroundColor: text.trim() ? c.ink : c.line }]}
            testID="chat-send"
          >
            <Icon name="arrow-up" size={20} color={c.bg} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, gap: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, borderWidth: 1, paddingHorizontal: space.lg, paddingVertical: 10, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quick: { gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center' },
});
