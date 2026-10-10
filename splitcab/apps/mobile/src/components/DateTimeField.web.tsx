import { createElement } from 'react';
import { View } from 'react-native';
import { radius, space, useTheme } from '../lib/theme';
import { AppText } from './ui';

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

// Development web build only: the browser's own date-time input.
export function DateTimeField({ label, value, onChange, minimumDate, maximumDate }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
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
        style: {
          minHeight: 50,
          borderRadius: radius.md,
          border: `1px solid ${c.line}`,
          background: c.surface2,
          color: c.ink,
          padding: '0 16px',
          fontSize: 17,
          fontFamily: 'inherit',
          colorScheme: 'light dark',
        },
      })}
    </View>
  );
}
