import type { Span, Block, RemoveKey, RosterEntry } from './types';
import { escapeRegex, findFolded, fold, foldString, isUpperStart, phraseSource, wordRegex } from './text';
import { nameVariants } from './names';

/** A string that must not survive anywhere in an exported file. */
export interface ScrubTerm {
  label: string;
  re: RegExp;
  /** Single words only count when capitalised in the original text. */
  single: boolean;
}

export function makeTerm(label: string, text: string): ScrubTerm | null {
  const f = foldString(text).trim();
  if (f.length < 2) return null;
  const single = !/\s/.test(f) && !/[@.]/.test(f);
  return { label, re: wordRegex(single ? escapeRegex(f) : phraseSource(f)), single };
}

export function findTerm(s: string, t: ScrubTerm): { start: number; end: number }[] {
  const f = fold(s);
  return findFolded(f, t.re).filter((m) => !t.single || isUpperStart(s.slice(m.start, m.end)));
}

export function scrubString(s: string, terms: ScrubTerm[], replacement = '[REDACTED]'): string {
  if (!s || !terms.length) return s;
  let out = s;
  for (const t of terms) {
    const ms = findTerm(out, t);
    for (const m of ms.reverse()) out = out.slice(0, m.start) + replacement + out.slice(m.end);
  }
  return out;
}

const STRONG = new Set(['STUDENT', 'INSTRUCTOR', 'EMAIL', 'PHONE', 'ID', 'PERSON', 'SCHOOL', 'TERM', 'MANUAL', 'COURSE']);

/**
 * Terms for the hidden-place scrub and the final leak check: the student's roster
 * name forms and email, plus every piece of text the reviewer chose to redact.
 */
export function leakTerms(student: RosterEntry | undefined, blocks: Block[], spans: Span[], remove?: Record<RemoveKey, boolean>): ScrubTerm[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const terms = new Map<string, ScrubTerm>();
  const add = (label: string, text: string) => {
    const t = makeTerm(label, text);
    if (t && !terms.has(t.re.source)) terms.set(t.re.source, t);
  };
  if (student && remove?.studentName !== false) {
    for (const n of [student.name, ...student.otherNames]) {
      const v = nameVariants(n);
      for (const ph of v.phrases) terms.set(ph, { label: 'Student name', re: wordRegex(ph), single: false });
      for (const w of v.words) if (w.length >= 3) terms.set(w, { label: 'Student name', re: wordRegex(escapeRegex(w)), single: true });
    }
  }
  if (student?.email && remove?.email !== false) add('Student email', student.email);
  for (const s of spans) {
    if (s.action !== 'redact' || !STRONG.has(s.category)) continue;
    const b = byId.get(s.blockId);
    if (!b) continue;
    const text = b.text.slice(s.start, s.end).trim();
    if (text.length >= 3) add(s.label, text);
  }
  return [...terms.values()];
}
