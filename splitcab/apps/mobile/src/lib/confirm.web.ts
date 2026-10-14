// Web development build: the browser's own confirm dialog.
export function confirmDestructive({ title, message, onConfirm }: { title: string; message: string; confirm: string; onConfirm: () => void }) {
  if (window.confirm(`${title}\n\n${message}`)) onConfirm();
}
