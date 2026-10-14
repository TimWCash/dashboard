import type { ReceiptView } from '@splitcab/core';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { receiptHtml } from './receiptText';

// Saves the receipt as a PDF and opens the share sheet, so it can be emailed, saved to Files or sent on.
export async function shareReceipt(r: ReceiptView) {
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(r) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `SplitCab receipt ${r.number}` });
  } else {
    await Print.printAsync({ uri });
  }
}

export const SHARE_RECEIPT_LABEL = 'Save or send as PDF';
