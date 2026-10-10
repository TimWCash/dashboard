import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, Note } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { clock } from '../../../lib/format';
import { useMessages, useSendMessage, useTrip } from '../../../lib/queries';
import { radius, space, useTheme } from '../../../lib/theme';

export default function Chat() {
  const { c } = useTheme();
  const { matchId, tripId } = useLocalSearchParams<{ matchId: string; tripId: string }>();
  const trip = useTrip(tripId);
  const name = trip.data?.match?.partner.firstName ?? 'Your travel partner';
  const messages = useMessages(matchId, true);
  const send = useSendMessage(matchId);
  const [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [count]);

  function submit() {
    const body = text.trim();
    if (!body) return;
    send.mutate(body, { onSuccess: () => setText('') });
  }

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: name }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
          <Note>Agree where to meet. Never share bank details or pay outside what the app shows.</Note>
          {count === 0 ? (
            <AppText variant="small" muted style={{ textAlign: 'center', paddingVertical: space.lg }}>
              {`Say hi to ${name}.`}
            </AppText>
          ) : null}
          {messages.data?.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.mine ? { alignSelf: 'flex-end', backgroundColor: c.accent } : { alignSelf: 'flex-start', backgroundColor: c.surface, borderColor: c.line, borderWidth: 1 },
              ]}
            >
              <AppText variant="body" color={m.mine ? c.accentInk : c.ink}>
                {m.text}
              </AppText>
              <AppText variant="caption" color={m.mine ? c.accentInk : c.muted} style={{ opacity: 0.7, fontWeight: '400', fontSize: 11 }}>
                {clock(m.at)}
              </AppText>
            </View>
          ))}
          {send.error ? <Note tone="bad">{send.error instanceof ApiError ? send.error.message : "Couldn't send that message."}</Note> : null}
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
            onSubmitEditing={submit}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={submit}
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
});
