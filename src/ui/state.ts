import type { ParsedEssay, RosterEntry, Settings, Span } from '../core/types';
import type { MatchResult } from '../core/roster';
import type { LeakHit } from '../verify';
import { detectAll } from '../detect';

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
  reviewed: boolean;
  result?: EssayResult;
}

export const CHOSEN_BY_YOU = 'Chosen by you';

const sameSpot = (a: Span, b: Span) => a.blockId === b.blockId && a.start === b.start && a.end === b.end;

/** Re-run detection, keeping the reviewer's own toggles and manual redactions. */
export function redetect(item: EssayItem, roster: RosterEntry[], settings: Settings): Span[] {
  if (!item.parsed || item.parsed.fatal) return [];
  const student = roster.find((r) => r.id === item.entryId);
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
