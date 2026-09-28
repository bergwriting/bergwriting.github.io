import type { Block, Span } from './types';
import { PLACEHOLDER } from './types';

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export function replacementFor(span: Span, block: Block | undefined, code: string): string {
  if (span.replacement) return span.replacement.replace(/\{CODE\}/g, code);
  if (block && (block.kind === 'header' || block.kind === 'footer') && span.category === 'STUDENT') return code;
  return PLACEHOLDER[span.category];
}

/** Redaction edits grouped per block, sorted by position, non-overlapping. */
export function buildEdits(blocks: Block[], spans: Span[], code: string): Map<string, Edit[]> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out = new Map<string, Edit[]>();
  for (const s of spans) {
    if (s.action !== 'redact') continue;
    const list = out.get(s.blockId) ?? [];
    list.push({ start: s.start, end: s.end, text: replacementFor(s, byId.get(s.blockId), code) });
    out.set(s.blockId, list);
  }
  for (const [k, list] of out) {
    list.sort((a, b) => a.start - b.start);
    const merged: Edit[] = [];
    const text = byId.get(k)?.text ?? '';
    for (const e of list) {
      const prev = merged[merged.length - 1];
      if (prev && e.start < prev.end) {
        prev.end = Math.max(prev.end, e.end);
        continue;
      }
      // "Jose Martinez" found as two words -> one "[STUDENT]", not "[STUDENT] [STUDENT]"
      if (prev && prev.text === e.text && /^[ \t ]+$/.test(text.slice(prev.end, e.start))) {
        prev.end = e.end;
        continue;
      }
      merged.push({ ...e });
    }
    out.set(k, merged);
  }
  return out;
}

export function applyEditsToString(text: string, edits: Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
