/** Essay labels (the ID written inside each essay) and output file names. */
import type { Naming, RosterEntry } from './core/types';
import { findFolded, fold, wordRegex, escapeRegex, foldString } from './core/text';
import { nameVariants } from './core/names';

export interface Labelled {
  key: string;
  /** Random 4-character tag, e.g. 7K3Q. */
  code: string;
  /** Random number fixing each essay's place when numbering. */
  rank: number;
}

/**
 * Label for every essay. Codes: "WP-7K3Q". Numbers: "Essay 01", "Essay 02"…, handed out
 * in a random order (by `rank`), never in upload or alphabetical order.
 */
export function essayLabels(items: Labelled[], naming: Naming): Map<string, string> {
  const prefix = naming.prefix.trim();
  const out = new Map<string, string>();
  if (naming.style === 'number') {
    const sorted = [...items].sort((a, b) => a.rank - b.rank);
    const width = Math.max(2, String(sorted.length).length);
    sorted.forEach((it, i) => out.set(it.key, `${prefix ? `${prefix} ` : ''}${String(i + 1).padStart(width, '0')}`));
  } else {
    for (const it of items) out.set(it.key, `${prefix ? `${prefix}-` : ''}${it.code}`);
  }
  return out;
}

export function fillDate(pattern: string, date: string): string {
  return pattern.replace(/\{date\}/gi, date);
}

/** Make a string safe as a file name on Windows and macOS. */
export function sanitizeFileName(s: string): string {
  const clean = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
    .trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `${clean}_` : clean;
}

/** File name (without extension) for an essay, from the pattern. `{label}` is required; it is appended if missing. */
export function fileNameFor(label: string, pattern: string, date: string): string {
  const p = pattern.trim() || '{label}';
  const withLabel = /\{label\}/i.test(p) ? p.replace(/\{label\}/gi, label) : `${p} ${label}`;
  return sanitizeFileName(fillDate(withLabel, date)) || sanitizeFileName(label);
}

/** De-duplicate names (case-insensitively) by adding " (2)", " (3)"… */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c === 1) return n;
    let alt = `${n} (${c})`;
    while (seen.has(alt.toLowerCase())) alt = `${n} (${c}_)`;
    seen.set(alt.toLowerCase(), 1);
    return alt;
  });
}

/** Roster names (any student or instructor) that appear in a proposed file name. */
export function namesInFileName(name: string, roster: RosterEntry[]): string[] {
  const f = fold(name.replace(/[_.]+/g, ' '));
  const found = new Set<string>();
  for (const r of roster) {
    for (const person of [r.name, ...r.otherNames, ...(r.instructor ? [r.instructor] : [])]) {
      const v = nameVariants(person);
      const sources = [...v.phrases, ...v.words.filter((w) => w.length >= 3).map(escapeRegex)];
      if (sources.some((src) => findFolded(f, wordRegex(src)).length)) found.add(person);
    }
    const local = r.email ? foldString(r.email.split('@')[0]) : '';
    if (local.length >= 4 && foldString(name).includes(local)) found.add(r.email!);
  }
  return [...found];
}
