// Renders the SplitCab icon set and store graphics from one SVG mark.
// Usage: node store/brand/generate-assets.mjs   (needs Playwright with Chromium)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const playwrightPath = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const { chromium } = await import(playwrightPath);

const YELLOW = '#FFC629';
const INK = '#16181D';

// The mark: a taxi roof sign split down the middle, sitting on the taxi's roof line.
// Drawn on a 100×100 grid so it scales to any size.
function mark(color, { gap = 5 } = {}) {
  const g = gap / 2;
  return `
    <path d="M${23} 58 L${29} 34 Q30 30 34 30 L${50 - g} 30 L${50 - g} 58 Z" fill="${color}"/>
    <path d="M${50 + g} 30 L66 30 Q70 30 71 34 L${77} 58 L${50 + g} 58 Z" fill="${color}"/>
    <rect x="16" y="64" width="68" height="9" rx="4.5" fill="${color}"/>`;
}

function svg(size, body, background) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    ${background ? `<rect width="100" height="100" fill="${background}"/>` : ''}${body}</svg>`;
}

// Scale the mark around the centre: scale < 1 adds padding (Android adaptive icons crop the edges).
const scaled = (body, scale) => `<g transform="translate(50 50) scale(${scale}) translate(-50 -51.5)">${body}</g>`;

const assets = [
  // iOS app icon: full bleed, no transparency (Apple rejects alpha).
  { file: 'assets/icon.png', size: 1024, svg: svg(1024, scaled(mark(INK), 0.92), YELLOW) },
  // Android adaptive icon layers: keep the mark inside the 66% safe zone.
  { file: 'assets/android-icon-foreground.png', size: 1024, svg: svg(1024, scaled(mark(INK), 0.62)), transparent: true },
  { file: 'assets/android-icon-background.png', size: 1024, svg: svg(1024, '', YELLOW) },
  { file: 'assets/android-icon-monochrome.png', size: 1024, svg: svg(1024, scaled(mark('#000000'), 0.62)), transparent: true },
  // Splash: the mark alone; the yellow background comes from the splash config.
  { file: 'assets/splash-icon.png', size: 1024, svg: svg(1024, scaled(mark(INK), 0.9)), transparent: true },
  // Android notification icon must be white on transparent.
  { file: 'assets/notification-icon.png', size: 96, svg: svg(96, scaled(mark('#FFFFFF', { gap: 7 }), 0.95)), transparent: true },
  { file: 'assets/favicon.png', size: 48, svg: svg(48, scaled(mark(INK, { gap: 7 }), 0.95), YELLOW) },
  // Google Play listing icon.
  { file: 'store/google-play/icon-512.png', size: 512, svg: svg(512, scaled(mark(INK), 0.92), YELLOW) },
];

const featureGraphic = `<!doctype html><html><head><style>
  body { margin: 0; width: 1024px; height: 500px; background: ${YELLOW}; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: ${INK};
         display: flex; align-items: center; gap: 56px; padding: 0 80px; box-sizing: border-box; }
  h1 { font-size: 76px; line-height: 1; margin: 0 0 18px; letter-spacing: -2px; font-weight: 800; }
  p { font-size: 32px; line-height: 1.25; margin: 0; font-weight: 600; max-width: 520px; }
</style></head><body>
  ${svg(260, mark(INK))}
  <div><h1>SplitCab</h1><p>Share the taxi.<br>Split the fare.</p></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const a of assets) {
  const out = path.join(root, a.file);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.setViewportSize({ width: a.size, height: a.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${a.svg}</body></html>`);
  await page.locator('svg').screenshot({ path: out, omitBackground: Boolean(a.transparent) });
  console.log('wrote', a.file);
}
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(featureGraphic);
const fg = path.join(root, 'store/google-play/feature-graphic.png');
await page.screenshot({ path: fg });
console.log('wrote store/google-play/feature-graphic.png');
await browser.close();
