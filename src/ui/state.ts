import type { ParsedEssay, RosterEntry, Settings, Span } from '../core/types';
import type { MatchResult } from '../core/roster';
import type { LeakHit } from '../verify';
import { detectAll } from '../detect';
import { autoWriter, guessWriter, type WriterCandidate } from '../detect/writer';

export interface EssayResult {
  bytes?: Uint8Array;
  hits: LeakHit[];
  error?: string;
  /** Reviewer chose to include the essay despite possible leaks. */
  override: boolean;
  /** The label written into this file; if the label setting changes, the file must be re-created. */
  label: string;
}

export interface EssayItem {
  key: string;
  fileName: string;
  status: 'reading' | 'ready' | 'error';
  parsed?: ParsedEssay;
  entryId: string | null;
  match?: MatchResult;
  spans: Span[];
  /** Random 4-character tag; the visible label is built from it (see naming.ts). */
  code: string;
  /** Random position used when essays are numbered. */
  rank: number;
  /** File name typed by the reviewer for this essay (without .docx). */
  fileNameOverride?: string;
  /** Writer's name when not taken from a roster row; "Name; nickname" for extra forms. */
  writer?: string;
  /** Where `writer` came from. */
  writerSource?: 'guess' | 'typed';
  /** Likely writer names found in the file (for the autocomplete). */
  candidates?: WriterCandidate[];
  reviewed: boolean;
  result?: EssayResult;
}

export const CHOSEN_BY_YOU = 'Chosen by you';

const sameSpot = (a: Span, b: Span) => a.blockId === b.blockId && a.start === b.start && a.end === b.end;

/** The writer of an essay: its roster row, or a name typed/guessed for it. */
export function studentFor(item: EssayItem, roster: RosterEntry[]): RosterEntry | undefined {
  if (item.entryId) {
    const r = roster.find((x) => x.id === item.entryId);
    if (r) return r;
  }
  const parts = (item.writer ?? '')
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  return { id: `writer:${item.key}`, name: parts[0], otherNames: parts.slice(1) };
}

/** The writer's name as shown in the interface. */
export function writerLabel(item: EssayItem, roster: RosterEntry[]): string {
  return studentFor(item, roster)?.name ?? '';
}

/** Fill in the writer from the roster match, or else from the best guess in the file. */
export function assignWriter(item: EssayItem): EssayItem {
  if (item.entryId || item.writerSource === 'typed') return item;
  const cands = item.parsed ? guessWriter(item.parsed) : [];
  const auto = autoWriter(cands);
  return { ...item, candidates: cands, writer: auto?.name, writerSource: auto ? 'guess' : undefined };
}

/** Re-run detection, keeping the reviewer's own toggles and manual redactions. */
export function redetect(item: EssayItem, roster: RosterEntry[], settings: Settings): Span[] {
  if (!item.parsed || item.parsed.fatal) return [];
  const student = studentFor(item, roster);
  const fresh = detectAll(item.parsed, { student, others: roster, settings });
  const userSet = item.spans.filter((s) => s.userSet);
  const merged = fresh.map((s) => {
    const u = userSet.find((x) => sameSpot(x, s));
    return u ? { ...s, action: u.action, userSet: true } : s;
  });
  for (const m of userSet.filter((s) => s.source === 'manual')) {
    const clash = (x: Span) => x.blockId === m.blockId && x.start < m.end && x.end > m.start;
    for (let i = merged.length - 1; i >= 0; i--) if (clash(merged[i])) merged.splice(i, 1);
    merged.push(m);
  }
  return merged;
}
