// Builds captioned store screenshots from raw app captures.
// Usage: node store/screenshots/compose.mjs <raw-captures-dir>
// Raw captures are 1170×2532 PNGs of the app (390×844 points at 3x), named as listed in SHOTS.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const raw = process.argv[2];
if (!raw) throw new Error('Pass the folder of raw captures');

const SHOTS = [
  { file: '01-welcome.png', title: 'Share the taxi.<br>Split the fare.', sub: 'No match, no charge.' },
  { file: '08-plan-filled.png', title: 'Tell us where<br>and roughly when', sub: 'Leave around a time, or arrive by one.' },
  { file: '11-trip-proposed.png', title: 'See your share<br>before you say yes', sub: 'And who books the taxi.' },
  { file: '13-trip-confirmed.png', title: 'One taxi,<br>one clear plan', sub: 'Booking links, pickup times and chat.' },
  { file: '16-trip-completed.png', title: 'Split the fare<br>fairly', sub: 'Each pays in proportion to going alone.' },
];

// iPhone 6.7" display (App Store APP_IPHONE_67) and a 9:16 Android phone.
const TARGETS = [
  { dir: 'ios', width: 1290, height: 2796, title: 104, sub: 52, top: 170, phone: 1010, gap: 70 },
  { dir: 'android', width: 1080, height: 1920, title: 78, sub: 40, top: 110, phone: 720, gap: 50 },
];

const html = (t, shot, img) => `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${t.width}px; height: ${t.height}px; overflow: hidden; background: #FFC629; color: #16181D;
         font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; display: flex; flex-direction: column; align-items: center; }
  h1 { margin-top: ${t.top}px; font-size: ${t.title}px; line-height: 1.04; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
  p { margin-top: ${Math.round(t.sub * 0.6)}px; font-size: ${t.sub}px; font-weight: 600; opacity: 0.8; text-align: center; }
  .phone { margin-top: ${t.gap}px; width: ${t.phone}px; border: ${Math.round(t.phone * 0.018)}px solid #16181D; border-bottom: 0;
           border-radius: ${Math.round(t.phone * 0.1)}px ${Math.round(t.phone * 0.1)}px 0 0; overflow: hidden; background: #16181D; flex: 1; }
  .phone img { width: 100%; display: block; }
</style></head><body><h1>${shot.title}</h1><p>${shot.sub}</p><div class="phone"><img src="${img}"></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of TARGETS) {
  const out = path.join(here, t.dir);
  mkdirSync(out, { recursive: true });
  for (const [i, shot] of SHOTS.entries()) {
    const img = `data:image/png;base64,${readFileSync(path.join(raw, shot.file)).toString('base64')}`;
    await page.setViewportSize({ width: t.width, height: t.height });
    await page.setContent(html(t, shot, img));
    await page.locator('img').evaluate((el) => (el.complete ? null : new Promise((r) => (el.onload = r))));
    const file = path.join(out, `${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', path.relative(process.cwd(), file));
  }
}
await browser.close();
