import nlp from 'compromise';
import type { Block, Span } from '../core/types';
import { uid } from '../core/text';

/**
 * Other person names (cited authors, historical figures, friends). Found with the
 * compromise lexicon/rule tagger; these are flagged for review, not redacted.
 */
export function otherNameSpans(blocks: Block[]): Span[] {
  const out: Span[] = [];
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    const people = nlp(b.text).people().json({ offset: true }) as { text: string; offset: { start: number; length: number } }[];
    for (const p of people) {
      const { start } = p.offset;
      let { length } = p.offset;
      let text = b.text.slice(start, start + length);
      // compromise may include quotes, trailing punctuation or a possessive
      const trimmed = text
        .split(/["“”(){}[\];:!?]/u)[0]
        .replace(/(?:['’]s)?[\s.,]+$/u, '')
        .replace(/['’]s$/u, '');
      length = trimmed.length;
      text = trimmed;
      if (!/^\p{Lu}/u.test(text) || length < 2 || /^(?:jr|sr|dr|mr|mrs|ms|mx|prof|st)\.?$/i.test(text)) continue;
      out.push({ id: uid(), blockId: b.id, start, end: start + length, category: 'PERSON', action: 'flag', source: 'names', label: 'Person name (check)' });
    }
  }
  return out;
}
