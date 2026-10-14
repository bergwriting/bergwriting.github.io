/**
 * Writes THIRD_PARTY_LICENSES.md: the license of every package bundled into the
 * built page (production dependencies and their dependencies).
 *   node scripts/third-party-licenses.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8' }));
const seen = new Map();
const walk = (deps = {}) => {
  for (const [name, info] of Object.entries(deps)) {
    // optional native add-ons (pdf.js canvas for Node) are not installed and never bundled
    if (seen.has(name) || info.missing || name.startsWith('@napi-rs/') || !existsSync(join('node_modules', name, 'package.json'))) continue;
    seen.set(name, info.version);
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

let out = `# Third-party licenses\n\nEssay Anonymizer bundles the following open-source packages into its single HTML file.\nEach is used under the license shown.\n`;
for (const [name, version] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const dir = join('node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f)) : undefined;
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'see package';
  out += `\n---\n\n## ${name} ${version}\n\nLicense: ${license}${pkg.homepage ? `  \nHomepage: ${pkg.homepage}` : ''}\n\n`;
  out += file ? '```\n' + readFileSync(join(dir, file), 'utf8').trim() + '\n```\n' : '_No license file shipped with the package._\n';
}
writeFileSync('THIRD_PARTY_LICENSES.md', out);
console.log(`Wrote THIRD_PARTY_LICENSES.md (${seen.size} packages)`);
