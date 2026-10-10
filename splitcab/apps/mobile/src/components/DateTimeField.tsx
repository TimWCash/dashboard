import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, View } from 'react-native';
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

export function DateTimeField({ label, value, onChange, minimumDate, maximumDate }: Props) {
  const { c } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <View style={{ gap: space.xs }}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{when(value)}</AppText>
          <DateTimePicker
            value={value}
            mode="datetime"
            display="compact"
            minuteInterval={5}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onValueChange={(_e, d) => onChange(d)}
            accessibilityLabel={label}
          />
        </Row>
      </View>
    );
  }

  // Android shows separate date and time dialogs.
  const pick = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate,
      maximumDate,
      onValueChange: (_e, day) =>
        DateTimePickerAndroid.open({
          value: day,
          mode: 'time',
          is24Hour: true,
          onValueChange: (_e2, time) => onChange(time),
        }),
    });

  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${when(value)}. Change`}
        onPress={pick}
        style={{ minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface2, paddingHorizontal: space.lg, justifyContent: 'center' }}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="body">{when(value)}</AppText>
          <Icon name="calendar-outline" color={c.muted} />
        </Row>
      </Pressable>
    </View>
  );
}
