import nlp from 'compromise';
import type { Block, Category, Span } from '../core/types';
import { uid, wordCount } from '../core/text';
import { DATE_LINE } from './patterns';

interface Line {
  block: Block;
  start: number;
  end: number;
  text: string;
}

const MAX_HEADER_LINES = 8;
const LABELS: [RegExp, Category][] = [
  [/^(?:student(?:\s+name)?|name|author|written\s+by|by|submitted\s+by)\s*[:\-–]/i, 'STUDENT'],
  [/^(?:instructor|professor|prof\.?|teacher|faculty|advisor|nominated\s+by|nominator)\s*[:\-–]/i, 'INSTRUCTOR'],
  [/^(?:course|class|section|seminar|course\s+(?:number|title))\s*[:\-–]/i, 'COURSE'],
  [/^(?:school|college|university|institution)\s*[:\-–]/i, 'SCHOOL'],
  [/^(?:student\s+)?(?:id|number)\s*[:\-–#]/i, 'ID'],
  [/^(?:e-?mail)\s*[:\-–]/i, 'EMAIL'],
];
const HONORIFIC_LINE = /^(?:professor|prof\.|dr\.?|mr\.?|mrs\.?|ms\.?|mx\.?|dean)\s+\p{Lu}/iu;

/** The first short lines of the essay body (MLA/APA heading) before running text starts. */
function headerLines(blocks: Block[]): Line[] {
  const out: Line[] = [];
  let seenBlocks = 0;
  for (const b of blocks) {
    if (b.kind !== 'body') continue;
    if (++seenBlocks > 12) break;
    let pos = 0;
    for (const raw of b.text.split('\n')) {
      const start = pos + (raw.length - raw.trimStart().length);
      const text = raw.trim();
      pos += raw.length + 1;
      if (!text) continue;
      if (wordCount(text) > 14 || text.length > 100) return out;
      out.push({ block: b, start, end: start + text.length, text });
      if (out.length >= MAX_HEADER_LINES) return out;
    }
  }
  return out;
}

function looksLikeNameLine(text: string): boolean {
  const toks = text.split(/\s+/);
  if (toks.length < 1 || toks.length > 4) return false;
  if (!toks.every((t) => /^\p{Lu}[\p{L}.'’-]*$/u.test(t))) return false;
  const doc = nlp(text);
  return doc.has('#FirstName') || doc.people().length > 0;
}

/**
 * Detect the heading block (name / instructor / course / date lines) at the top of an
 * essay and redact those lines whole. `existing` are spans found by other detectors,
 * used to recognise lines that contain the student's or instructor's name.
 */
export function headerBlockSpans(blocks: Block[], existing: Span[]): Span[] {
  const lines = headerLines(blocks);
  const cats: (Category | null)[] = lines.map((l) => {
    for (const [re, c] of LABELS) if (re.test(l.text)) return c;
    const inside = existing.filter((s) => s.action === 'redact' && s.blockId === l.block.id && s.start < l.end && s.end > l.start);
    const hit = (c: Category) => inside.some((s) => s.category === c);
    // a line that is mostly a detected name (not a title that happens to contain one)
    const covered = inside.reduce((n, s) => n + Math.min(s.end, l.end) - Math.max(s.start, l.start), 0);
    const mostly = covered >= l.text.replace(/[\s,.:]/g, '').length * 0.5;
    if (hit('STUDENT') && mostly) return 'STUDENT';
    if (HONORIFIC_LINE.test(l.text) || (hit('INSTRUCTOR') && mostly)) return 'INSTRUCTOR';
    if (hit('COURSE')) return 'COURSE';
    if (DATE_LINE.test(l.text)) return 'DATE';
    if (hit('SCHOOL') && mostly) return 'SCHOOL';
    if (hit('PERSON') && mostly) return 'PERSON';
    return null;
  });
  // A name-like line before other recognised heading lines is probably the student.
  const lastStrong = cats.reduce((acc, c, i) => (c ? i : acc), -1);
  lines.forEach((l, i) => {
    if (!cats[i] && i < lastStrong && i <= 3 && looksLikeNameLine(l.text)) cats[i] = 'PERSON';
  });

  const out: Span[] = [];
  let codePlaced = false;
  lines.forEach((l, i) => {
    const c = cats[i];
    if (!c) return;
    let replacement: string | undefined;
    if ((c === 'STUDENT' || c === 'PERSON') && !codePlaced) {
      replacement = 'Essay {CODE}';
      codePlaced = true;
    }
    out.push({
      id: uid(),
      blockId: l.block.id,
      start: l.start,
      end: l.end,
      category: c === 'PERSON' ? 'STUDENT' : c,
      action: 'redact',
      source: 'header-block',
      label: 'Essay heading line',
      replacement,
    });
  });
  return out;
}

const RUNNING = /^\s*(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?)\s+(?:page\s+)?\d{1,3}\s*$/u;

/** MLA running header "Smith 1" in page headers/footers. */
export function runningHeaderSpans(blocks: Block[]): Span[] {
  const out: Span[] = [];
  for (const b of blocks) {
    if (b.kind !== 'header' && b.kind !== 'footer') continue;
    const m = RUNNING.exec(b.text);
    if (!m || /^page$/i.test(m[1])) continue;
    const start = b.text.indexOf(m[1]);
    out.push({
      id: uid(),
      blockId: b.id,
      start,
      end: start + m[1].length,
      category: 'STUDENT',
      action: 'redact',
      source: 'running-header',
      label: 'Running page header',
      replacement: '{CODE}',
    });
  }
  return out;
}
