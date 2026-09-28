import type { Action, Block, Category, Span } from '../core/types';
import { escapeRegex, findFolded, fold, isUpperStart, phraseSource, uid, wordRegex, foldString } from '../core/text';

/** A group of things to look for that share a category, action and label. */
export interface TermGroup {
  category: Category;
  action: Action;
  label: string;
  source: string;
  /** Regex sources over folded text, matched case-insensitively. */
  phrases: string[];
  /** Folded single words, matched only where the original is capitalised. */
  words: string[];
}

function alternation(sources: string[]): RegExp | null {
  const uniq = [...new Set(sources.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniq.length) return null;
  return wordRegex(uniq.join('|'));
}

export function literalPhrases(items: string[]): string[] {
  return items
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .map((s) => phraseSource(foldString(s)));
}

export function findTermSpans(blocks: Block[], groups: TermGroup[]): Span[] {
  const compiled = groups.map((g) => ({
    g,
    phraseRe: alternation(g.phrases),
    wordRe: alternation(g.words.map(escapeRegex)),
  }));
  const out: Span[] = [];
  for (const b of blocks) {
    if (!b.text) continue;
    const f = fold(b.text);
    for (const { g, phraseRe, wordRe } of compiled) {
      const push = (start: number, end: number) =>
        out.push({ id: uid(), blockId: b.id, start, end, category: g.category, action: g.action, source: g.source, label: g.label });
      if (phraseRe) for (const m of findFolded(f, phraseRe)) push(m.start, m.end);
      if (wordRe) {
        for (const m of findFolded(f, wordRe)) {
          if (isUpperStart(b.text.slice(m.start, m.end))) push(m.start, m.end);
        }
      }
    }
  }
  return out;
}
