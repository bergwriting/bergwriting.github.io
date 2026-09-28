/**
 * End-to-end: open the built single HTML file straight from disk, run the whole
 * workflow on the synthetic fixtures, and prove that the page made no network
 * requests and that the downloaded essays contain no identifying text.
 *
 *   npm run build && npm run fixtures && npm run e2e
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORBIDDEN } from '../tests/fixtures/make-fixtures.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = pathToFileURL(join(ROOT, 'dist/essay-anonymizer.html')).href;
const FX = join(ROOT, 'tests/fixtures/files');
const SHOTS = join(ROOT, 'test-results');
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

test('full workflow offline', async ({ page, context }) => {
  const external: string[] = [];
  const errors: string[] = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (/^(file|data|blob):/.test(u)) return route.continue();
    external.push(u);
    return route.abort();
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Essay Anonymizer' })).toBeVisible();

  // 1. roster + settings
  await page.locator('input[type=file]').first().setInputFiles(join(FX, 'roster.csv'));
  await expect(page.getByText('5 students loaded.')).toBeVisible();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByPlaceholder('Muhlenberg College').fill('Muhlenberg College\nMuhlenberg');
  await page.screenshot({ path: join(SHOTS, '1-roster.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next: add essays →' }).click();

  // 2. essays
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(['Okafor_Essay_Final.docx', 'Martinez-Ruiz WRT201.docx', 'young_reading_the_river.pdf', 'nguyen_scan.pdf'].map((f) => join(FX, f)));
  await expect(page.getByText('Reading…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/no selectable text/)).toBeVisible();
  await expect(page.locator('.badge.high')).toHaveCount(3);
  await page.screenshot({ path: join(SHOTS, '2-files.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next: review →' }).click();

  // 3. review: toggle a flagged name on and off, add a manual redaction, then approve all
  await expect(page.locator('.doc')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '3-review.png'), fullPage: true });
  const morrison = page.locator('mark', { hasText: 'Toni Morrison' });
  await expect(morrison).toHaveClass(/flag/);
  await morrison.click();
  await expect(page.locator('mark', { hasText: 'Toni Morrison' })).toHaveClass(/redact/);
  await page.locator('mark', { hasText: 'Toni Morrison' }).click();
  await expect(page.locator('mark', { hasText: 'Toni Morrison' })).toHaveClass(/flag/);
  // select "Allentown" and remove it manually
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('[data-block]')].find((e) => e.textContent!.includes('Allentown'))!;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const i = n.textContent!.indexOf('Allentown');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 'Allentown'.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        break;
      }
    }
  });
  await page.getByRole('button', { name: /Remove selected text/ }).click();
  await expect(page.locator('mark.redact', { hasText: 'Allentown' })).toBeVisible();
  await page.getByRole('button', { name: 'Result' }).click();
  await page.screenshot({ path: join(SHOTS, '3b-result.png'), fullPage: true });
  await page.getByRole('button', { name: 'Highlights' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Looks good → next' }).first().click();

  // 4. export
  await page.getByRole('button', { name: /Create 3 anonymized files/ }).click();
  await expect(page.getByText('✓ No identifying text found')).toHaveCount(3, { timeout: 60_000 });
  await page.screenshot({ path: join(SHOTS, '4-export.png'), fullPage: true });

  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download anonymized essays/ }).click()]);
  const zip = await JSZip.loadAsync(readFileSync(await zipDl.path()));
  const names = Object.keys(zip.files);
  expect(names).toHaveLength(3);
  for (const n of names) expect(n).toMatch(/^WP-[A-Z0-9]{4}\.docx$/);
  const allForbidden = Object.values(FORBIDDEN).flat().concat(['Allentown']);
  for (const n of names) {
    const inner = await JSZip.loadAsync(await zip.file(n)!.async('uint8array'));
    let text = '';
    for (const p of Object.keys(inner.files)) if (inner.file(p)) text += await inner.file(p)!.async('string');
    for (const bad of allForbidden) expect(fold(text).includes(fold(bad)), `${bad} in ${n}`).toBe(false);
  }

  await page.getByLabel('Passphrase (optional, encrypts the key)').fill('blue-harbor-lantern');
  await page.getByLabel('Repeat passphrase').fill('blue-harbor-lantern');
  const [keyDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download key/ }).click()]);
  expect(keyDl.suggestedFilename()).toMatch(/^KEY-CONFIDENTIAL-.*\.enc$/);
  const keyPath = await keyDl.path();
  expect(readFileSync(keyPath, 'utf8')).not.toContain('Okafor');

  // look the key up again
  await page.getByRole('tab', { name: 'Look up key' }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'KEY.enc', mimeType: 'application/json', buffer: readFileSync(keyPath) });
  await page.getByLabel(/Passphrase for/).fill('wrong');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText(/Wrong passphrase/)).toBeVisible();
  await page.getByLabel(/Passphrase for/).fill('blue-harbor-lantern');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('cell', { name: 'Amara Okafor', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /NOT PROCESSED/ })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '5-key.png'), fullPage: true });

  expect(external, 'network requests').toEqual([]);
  expect(errors, 'console errors').toEqual([]);
});

test('the page cannot reach the network even if code tries', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => errors.push(m.text()));
  await page.goto(APP);
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/?leak=1');
      return 'fetched';
    } catch (e) {
      return 'blocked';
    }
  });
  expect(result).toBe('blocked');
  expect(errors.join('\n')).toMatch(/Content Security Policy/);
});

test('essays added before the roster are matched once the roster loads', async ({ page }) => {
  await page.goto(APP);
  await page.getByRole('tab', { name: /Essays/ }).click();
  await page.locator('input[type=file]').first().setInputFiles([join(FX, 'Okafor_Essay_Final.docx'), join(FX, 'young_reading_the_river.pdf')]);
  await expect(page.getByText('Reading…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.badge.high')).toHaveCount(0);
  await page.getByRole('tab', { name: /Roster/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(join(FX, 'roster.csv'));
  await page.getByRole('tab', { name: /Essays/ }).click();
  await expect(page.locator('.badge.high')).toHaveCount(2);
});
