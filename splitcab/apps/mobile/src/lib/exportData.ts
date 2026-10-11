import { Share } from 'react-native';
import { api } from './api';

// GDPR access and portability: everything SplitCab holds about you, as JSON you can save or send on.
export async function exportMyData() {
  const data = await api.get<object>('/v1/me/export');
  await Share.share({ title: 'My SplitCab data', message: JSON.stringify(data, null, 2) });
}
