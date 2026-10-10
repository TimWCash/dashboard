import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { radius, space, type, useTheme } from '../lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  scroll = true,
  footer,
  edges = ['bottom'],
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  edges?: Edge[];
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { borderTopColor: c.line, backgroundColor: c.bg }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

type Variant = keyof typeof type;

export function AppText({
  children,
  variant = 'body',
  muted,
  color,
  style,
  ...rest
}: { children: ReactNode; variant?: Variant; muted?: boolean; color?: string; style?: StyleProp<TextStyle> } & Omit<ComponentProps<typeof Text>, 'style'>) {
  const { c } = useTheme();
  return (
    <Text style={[type[variant], { color: color ?? (muted ? c.muted : c.ink) }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'dark' | 'ghost' | 'link' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const { c } = useTheme();
  const palette = {
    primary: { bg: c.accent, fg: c.accentInk, border: c.accent },
    dark: { bg: c.ink, fg: c.bg, border: c.ink },
    ghost: { bg: 'transparent', fg: c.ink, border: c.line },
    link: { bg: 'transparent', fg: c.muted, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.bad, border: c.line },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' && styles.linkButton,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <Text style={[type.heading, { color: palette.fg, fontSize: 16 }, variant === 'link' && styles.linkText]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'ink' | 'accent';

function toneColors(tone: Tone, c: ReturnType<typeof useTheme>['c']) {
  return {
    neutral: { bg: c.surface2, fg: c.muted, border: c.line },
    good: { bg: c.goodBg, fg: c.good, border: c.goodBg },
    warn: { bg: c.warnBg, fg: c.warn, border: c.warnBg },
    bad: { bg: c.badBg, fg: c.bad, border: c.badBg },
    ink: { bg: c.ink, fg: c.bg, border: c.ink },
    accent: { bg: c.accent, fg: c.accentInk, border: c.accent },
  }[tone];
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[type.caption, { color: t.fg, fontSize: 12 }]}>{label}</Text>
    </View>
  );
}

export function Note({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: Exclude<Tone, 'ink' | 'accent'>; icon?: IconName }) {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  const name: IconName = icon ?? (tone === 'good' ? 'shield-checkmark-outline' : tone === 'bad' ? 'alert-circle-outline' : 'information-circle-outline');
  return (
    <View style={[styles.note, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={name} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <AppText variant="small" color={t.fg}>{children}</AppText> : children}</View>
    </View>
  );
}

export function Field({ label, error, ...input }: { label: string; error?: string | null } & TextInputProps) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <TextInput
        placeholderTextColor={c.muted}
        {...input}
        style={[styles.input, { backgroundColor: c.surface2, borderColor: error ? c.bad : c.line, color: c.ink }, input.style]}
      />
      {error ? (
        <AppText variant="small" color={c.bad}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, { backgroundColor: on ? c.ink : c.surface2, borderColor: on ? c.ink : c.line }]}
          >
            <Text style={[type.caption, { fontSize: 14, color: on ? c.bg : c.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Avatar({ name, size = 44, tone = 'accent' }: { name: string; size?: number; tone?: 'accent' | 'ink' }) {
  const { c } = useTheme();
  const bg = tone === 'accent' ? c.accent : c.ink;
  const fg = tone === 'accent' ? c.accentInk : c.bg;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: fg, fontWeight: '800', fontSize: size * 0.4 }}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: space.sm }} />;
}

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? c.ink} />;
}

const styles = StyleSheet.create({
  screenContent: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  linkButton: { minHeight: 40 },
  linkText: { fontWeight: '600', textDecorationLine: 'underline' },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  pill: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  note: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, fontSize: 17 },
  segmented: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
