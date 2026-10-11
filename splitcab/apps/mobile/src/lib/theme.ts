import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F4EF',
  surface: '#FFFFFF',
  surface2: '#FAF9F6',
  ink: '#16181D',
  muted: '#6B6F78',
  line: '#E6E3DB',
  accent: '#FFC629',
  accentStrong: '#F2B400',
  accentInk: '#1A1A1A',
  good: '#0E6B4C',
  goodBg: '#E6F4EE',
  warn: '#9A5B00',
  warnBg: '#FFF4D6',
  bad: '#B42318',
  badBg: '#FDECEA',
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#101113',
  surface: '#1A1C20',
  surface2: '#202328',
  ink: '#F2F3F5',
  muted: '#A0A4AD',
  line: '#2C2F36',
  accent: '#FFC629',
  accentStrong: '#F2B400',
  accentInk: '#1A1A1A',
  good: '#4CC79A',
  goodBg: '#13291F',
  warn: '#F5C35B',
  warnBg: '#2D2412',
  bad: '#FF8A80',
  badBg: '#331A18',
};

export function useTheme() {
  const scheme = useColorScheme();
  return { c: scheme === 'dark' ? dark : light, dark: scheme === 'dark' };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 12, lg: 16, pill: 999 };
export const type = {
  hero: { fontSize: 34, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  small: { fontSize: 14, lineHeight: 19, fontWeight: '400' as const },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '600' as const },
};
