import { createElement } from 'react';
import { View } from 'react-native';
import { when } from '../lib/format';
import { radius, space, useTheme } from '../lib/theme';
import { AppText, Icon, Row } from './ui';

interface Props {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate: Date;
  maximumDate: Date;
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Development web build only. Looks like the Android field; an invisible browser date input on top does the picking.
export function DateTimeField({ label, value, onChange, minimumDate, maximumDate }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <View style={{ minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface2, paddingHorizontal: space.lg, justifyContent: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{when(value)}</AppText>
          <Icon name="calendar-outline" color={c.muted} />
        </Row>
        {createElement('input', {
          type: 'datetime-local',
          'aria-label': label,
          value: toLocalInput(value),
          min: toLocalInput(minimumDate),
          max: toLocalInput(maximumDate),
          onChange: (e: { target: { value: string } }) => {
            const d = new Date(e.target.value);
            if (!Number.isNaN(d.getTime())) onChange(d);
          },
          style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' },
        })}
      </View>
    </View>
  );
}
