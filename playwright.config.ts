import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { channel: 'chrome', headless: true, acceptDownloads: true, viewport: { width: 1360, height: 900 } },
  reporter: 'list',
});
