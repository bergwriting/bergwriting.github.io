/**
 * Renders assets/favicon.svg to the PNG sizes browsers expect (for those that
 * don't use SVG favicons, and for the iOS home-screen icon).
 *   node scripts/make-icons.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('assets/favicon.svg', 'utf8');
// iOS rounds the corners itself, so the home-screen icon is a full square.
const square = svg.replace(/<rect width="32" height="32" rx="7"/, '<rect width="32" height="32"');
const dataUrl = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome' });
for (const [size, out, src] of [
  [32, 'assets/favicon-32.png', svg],
  [180, 'assets/apple-touch-icon.png', square],
]) {
  // a fresh page per size: resizing one page between renders produced a doubled image
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><img src="${dataUrl(src)}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
  await page.close();
}
await browser.close();
