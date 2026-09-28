import type { ParsedEssay, RemoveKey, RosterEntry, Settings, Span } from '../core/types';
import { rosterSpans } from './roster';
import { patternSpans } from './patterns';
import { headerBlockSpans, runningHeaderSpans } from './headerBlock';
import { otherNameSpans } from './otherNames';
import { findTermSpans, type TermGroup } from './terms';
import { looksLikePersonName, nameVariants } from '../core/names';
import { foldString } from '../core/text';

export interface DetectContext {
  /** The roster row this essay belongs to (if known). */
  student?: RosterEntry;
  /** The whole roster, used to catch classmates' names. */
  others: RosterEntry[];
  settings: Settings;
}

const SOURCE_RANK: Record<string, number> = {
  manual: 0,
  'header-block': 1,
  'running-header': 2,
  roster: 3,
  metadata: 4,
  'roster-other': 5,
  'heading-name': 3,
  settings: 6,
  pattern: 7,
  names: 8,
};

/**
 * Keep a non-overlapping set of spans. Redactions beat flags; then longer spans
 * (an email beats the user name inside it); then more trusted detectors.
 */
export function resolveSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) =>
      (a.action === 'redact' ? 0 : 1) - (b.action === 'redact' ? 0 : 1) ||
      (a.source === 'manual' ? 0 : 1) - (b.source === 'manual' ? 0 : 1) ||
      b.end - b.start - (a.end - a.start) ||
      (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) ||
      a.start - b.start,
  );
  const byBlock = new Map<string, Span[]>();
  const kept: Span[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    const list = byBlock.get(s.blockId) ?? [];
    if (list.some((k) => k.start < s.end && k.end > s.start)) continue;
    list.push(s);
    byBlock.set(s.blockId, list);
    kept.push(s);
  }
  return kept;
}

export function detectAll(essay: ParsedEssay, ctx: DetectContext): Span[] {
  if (essay.fatal) return [];
  const base = [...rosterSpans(essay, ctx), ...patternSpans(essay.blocks, ctx.settings), ...runningHeaderSpans(essay.blocks)];
  const header = headerBlockSpans(essay.blocks, base);
  const propagated = findTermSpans(essay.blocks, discoveredNameGroups(essay, [...header, ...base], ctx));
  const names = ctx.settings.flagOtherNames ? otherNameSpans(essay.blocks.filter((b) => b.kind === 'body' || b.kind === 'note')) : [];
  const order = new Map(essay.blocks.map((b, i) => [b.id, i]));
  const chosen = applyRemoveChoices([...header, ...base, ...propagated], ctx.settings.remove);
  return resolveSpans([...chosen, ...names]).sort(
    (a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0) || a.start - b.start,
  );
}

const LABEL_PREFIX = /^[^:]{0,24}:\s*/;

/**
 * Names discovered in the essay itself (heading line, running page header) are
 * searched for everywhere else, so the author's name is caught even when the
 * essay is not matched to a roster row.
 */
function discoveredNameGroups(essay: ParsedEssay, spans: Span[], ctx: DetectContext): TermGroup[] {
  const known = new Set(ctx.student ? [ctx.student.name, ...ctx.student.otherNames].map(foldString) : []);
  const byId = new Map(essay.blocks.map((b) => [b.id, b]));
  const phrases: string[] = [];
  const words: string[] = [];
  for (const s of spans) {
    if (s.category !== 'STUDENT' || (s.source !== 'header-block' && s.source !== 'running-header')) continue;
    const text = (byId.get(s.blockId)?.text.slice(s.start, s.end) ?? '').replace(LABEL_PREFIX, '').trim();
    if (!text || known.has(foldString(text)) || !looksLikePersonName(text)) continue;
    const v = nameVariants(text);
    phrases.push(...v.phrases);
    words.push(...v.words.filter((w) => w.length >= 3));
  }
  if (!phrases.length && !words.length) return [];
  return [{ category: 'STUDENT', action: 'redact', label: 'Name from essay heading', source: 'heading-name', phrases, words }];
}

/** Which "what to remove" option controls a span; null = always removed (custom terms, manual). */
export function removeKeyFor(s: Pick<Span, 'category' | 'source'>): RemoveKey | null {
  switch (s.category) {
    case 'STUDENT':
      return s.source === 'roster-other' ? 'classmates' : 'studentName';
    case 'PERSON':
      return 'studentName';
    case 'INSTRUCTOR':
      return 'instructor';
    case 'COURSE':
      return 'course';
    case 'SCHOOL':
      return 'school';
    case 'EMAIL':
      return 'email';
    case 'PHONE':
      return 'phone';
    case 'ID':
      return 'ids';
    case 'URL':
      return 'links';
    case 'DATE':
      return 'dates';
    default:
      return null;
  }
}

/** Kinds the committee chose not to remove are kept, but still highlighted so a reviewer can remove one by hand. */
export function applyRemoveChoices(spans: Span[], remove: Record<RemoveKey, boolean> | undefined): Span[] {
  if (!remove) return spans;
  return spans.map((s) => {
    const key = removeKeyFor(s);
    if (s.action !== 'redact' || !key || remove[key] !== false) return s;
    return { ...s, action: 'flag', label: `${s.label} (kept: switched off in “What to remove”)` };
  });
}
