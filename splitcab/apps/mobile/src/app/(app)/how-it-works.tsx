import { formatMoney } from '@splitcab/core';
import { View } from 'react-native';
import { AppText, Card, Screen } from '../../components/ui';
import { useConfig } from '../../lib/queries';
import { space } from '../../lib/theme';

export default function HowItWorks() {
  const config = useConfig();
  const fee = formatMoney(config.data?.matchFee ?? 199);
  const sections: [string, string][] = [
    ['Post your trip', "Tell us where you're going and roughly when you want to leave, or when you need to arrive by."],
    ['Get matched', "We pair you with someone nearby heading your way and show exactly what you'll each pay before you say yes."],
    ['The match fee', `We place a ${fee} hold on your card when you post. It's only charged if you're matched and you both say yes. Otherwise it's released, though your bank may show it as pending for a few days.`],
    ['Booking the taxi', 'The person picked up first books the taxi in Uber, FREENOW or at a rank. The app tells you who books.'],
    ['Paying your share', 'After the ride, the booker enters the meter total. Each share changes in proportion, and the other person pays their share to the booker by Revolut, bank transfer or cash.'],
    ['If plans change', "If your match cancels after you've both said yes, your fee is refunded and we look again. If you cancel, your fee isn't refunded."],
    ['Safety', 'Your exact pickup point is only shared once you both say yes. Tap Safety on any trip to report or block someone. In an emergency, call 112.'],
  ];
  return (
    <Screen>
      {sections.map(([title, body]) => (
        <Card key={title}>
          <View style={{ gap: space.xs }}>
            <AppText variant="heading">{title}</AppText>
            <AppText variant="body" muted>
              {body}
            </AppText>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
