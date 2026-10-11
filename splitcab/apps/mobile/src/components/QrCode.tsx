import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';

const QUIET_ZONE = 4;

// A scannable QR code drawn with plain views, so it needs no native module. Always dark on white, even in dark
// mode, because that's what phone cameras read best.
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const runs = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    // Whole pixels per module avoid hairline gaps between rows.
    const cell = Math.max(1, Math.floor(size / (count + QUIET_ZONE * 2)));
    const out: { left: number; top: number; width: number; cell: number }[] = [];
    for (let row = 0; row < count; row++) {
      let start = -1;
      for (let col = 0; col <= count; col++) {
        const dark = col < count && qr.isDark(row, col);
        if (dark && start < 0) start = col;
        if (!dark && start >= 0) {
          out.push({ left: (QUIET_ZONE + start) * cell, top: (QUIET_ZONE + row) * cell, width: (col - start) * cell, cell });
          start = -1;
        }
      }
    }
    return { out, side: (count + QUIET_ZONE * 2) * cell };
  }, [value, size]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: runs.side, height: runs.side, backgroundColor: '#FFFFFF', borderRadius: 12 }}
      testID="qr-code"
    >
      {runs.out.map((r) => (
        <View key={`${r.top}-${r.left}`} style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.cell, backgroundColor: '#000000' }} />
      ))}
    </View>
  );
}
