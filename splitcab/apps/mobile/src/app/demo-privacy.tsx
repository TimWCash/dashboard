import { Linking, View } from 'react-native';
import { AppText, Card, Screen } from '../components/ui';
import { DEMO_SHARED } from '../lib/demo';
import { useConfig } from '../lib/queries';
import { space } from '../lib/theme';

// The public demo's privacy notice and terms. The real app links to the full Privacy Policy and Terms instead.
export default function DemoPrivacy() {
  const config = useConfig();
  const operator = config.data?.demo?.operator ?? 'The SplitCab team';
  const email = config.data?.supportEmail;

  const sections: [string, string][] = DEMO_SHARED
    ? [
        ['Who runs this demo', `${operator} runs this demo to show how SplitCab works. For questions or requests about your data, contact us at the address below.`],
        [
          'What it keeps',
          'The mobile number and first name you enter, the trips you plan, your messages, ratings and reports, and your Revtag if you add one. No card details: payments are pretend and nothing is charged. No texts are sent.',
        ],
        [
          'Why',
          "So you can try being matched with someone else. Your travel partner sees what they would in the real app: your first name, and your exact pickup only once you've both accepted. Nothing is used for marketing or shared with anyone else.",
        ],
        ['Where', 'The demo runs on Vercel in Dublin and stores its data with Supabase in Ireland.'],
        [
          'How long',
          'Your account is deleted after a day without use: your name, number, Revtag, messages and sign-in sessions are erased. What remains of your trips no longer identifies you. You can delete your account sooner under Account → Privacy & your data.',
        ],
        [
          "You don't have to use your own number",
          "Any Irish or UK mobile number works and no text is sent, so you can make one up. Anyone who enters the same number gets the same account, so pick one that's unlikely to be used by someone else.",
        ],
        [
          'Your rights',
          'You can see, download, correct or delete your data under Account → Privacy & your data, or ask us by email. You can also complain to the Data Protection Commission at dataprotection.ie.',
        ],
        [
          'Using the demo',
          "It's for trying SplitCab only: no real taxis are booked, nobody is charged, and the pretend traveller isn't a real person. You must be 18 or over. Don't share personal details in chat.",
        ],
      ]
    : [
        ['Your data stays on this device', 'Everything you enter is stored in this browser and never sent anywhere. Clearing your browsing data deletes it.'],
        [
          'Using the demo',
          "It's for trying SplitCab only: no real taxis are booked, nobody is charged, and the traveller you're matched with isn't a real person.",
        ],
      ];

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        This demo and your data
      </AppText>
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
      {DEMO_SHARED && email ? (
        <AppText variant="body" style={{ textDecorationLine: 'underline', fontWeight: '600' }} accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${email}`)}>
          {email}
        </AppText>
      ) : null}
    </Screen>
  );
}
