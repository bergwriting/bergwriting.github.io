import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The privacy guarantee, enforced by the browser: the built page may not make any
 * network request (fetch, XHR, WebSocket, images, fonts, workers, form posts).
 * Only added to the production build so the dev server's live reload still works.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Favicons, embedded as data URIs (the page may not load anything, not even its own icon file). */
function favicons(): Plugin {
  const b64 = (f: string) => readFileSync(new URL(f, import.meta.url)).toString('base64');
  const svg = readFileSync(new URL('./assets/favicon.svg', import.meta.url), 'utf8').replace(/\s*\n\s*/g, '');
  const tags = [
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${b64('./assets/favicon-32.png')}" />`,
    `<link rel="apple-touch-icon" href="data:image/png;base64,${b64('./assets/apple-touch-icon.png')}" />`,
    `<meta name="theme-color" content="#fffdf9" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="#1e1d1a" media="(prefers-color-scheme: dark)" />`,
  ];
  return {
    name: 'favicons',
    transformIndexHtml(html) {
      return html.replace('</title>', `</title>\n    ${tags.join('\n    ')}`);
    },
  };
}

function offlineCsp(): Plugin {
  return {
    name: 'offline-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// Everything (JS, CSS, pdf.js) is inlined into one HTML file so the tool can be
// emailed or put on a shared drive and double-clicked, with nothing to install.
export default defineConfig({
  plugins: [preact(), favicons(), offlineCsp(), viteSingleFile()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 20_000,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
