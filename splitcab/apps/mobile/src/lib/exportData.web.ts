import { api } from './api';

// In a browser, download everything SplitCab holds about you as a JSON file.
export async function exportMyData() {
  const data = await api.get<object>('/v1/me/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'splitcab-my-data.json';
  link.click();
  URL.revokeObjectURL(url);
}
