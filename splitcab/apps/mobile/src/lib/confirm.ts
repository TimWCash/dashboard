import { Alert } from 'react-native';

// A native confirmation for anything that can't be undone.
export function confirmDestructive({ title, message, confirm, onConfirm }: { title: string; message: string; confirm: string; onConfirm: () => void }) {
  Alert.alert(title, message, [
    { text: 'Keep it', style: 'cancel' },
    { text: confirm, style: 'destructive', onPress: onConfirm },
  ]);
}
