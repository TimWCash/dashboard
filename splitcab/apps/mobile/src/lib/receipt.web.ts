import type { ReceiptView } from '@splitcab/core';
import { receiptHtml } from './receiptText';

// In a browser, open the receipt on its own and print it; "Save as PDF" is in the print dialog.
export async function shareReceipt(r: ReceiptView) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups to print your receipt.');
  win.document.write(receiptHtml(r));
  win.document.close();
  win.focus();
  win.print();
}

export const SHARE_RECEIPT_LABEL = 'Print or save as PDF';
