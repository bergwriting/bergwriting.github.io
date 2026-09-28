import { docxAllText } from './formats/docx';
import { findTerm, type ScrubTerm } from './core/scrub';
import { foldString } from './core/text';

export interface LeakHit {
  part: string;
  label: string;
  match: string;
  snippet: string;
  /** The reviewer explicitly chose to keep this text, so it does not block export. */
  allowed: boolean;
}

const PART_NAMES: [RegExp, string][] = [
  [/^word\/document\.xml$/, 'essay text'],
  [/^word\/header/, 'page header'],
  [/^word\/footer/, 'page footer'],
  [/^word\/(foot|end)notes/, 'notes'],
  [/^docProps\//, 'document properties'],
  [/\.rels$/, 'link targets'],
];

export function partName(p: string): string {
  return PART_NAMES.find(([re]) => re.test(p))?.[1] ?? p;
}

/** Re-open an exported .docx and look for any of the terms anywhere in it. */
export async function verifyDocx(bytes: Uint8Array, terms: ScrubTerm[], kept: Set<string>): Promise<LeakHit[]> {
  const keptFolded = new Set([...kept].map((k) => foldString(k).trim()));
  const hits: LeakHit[] = [];
  for (const { part, text } of await docxAllText(bytes)) {
    for (const t of terms) {
      for (const m of findTerm(text, t)) {
        const match = text.slice(m.start, m.end);
        const snippet = text
          .slice(Math.max(0, m.start - 40), Math.min(text.length, m.end + 40))
          .replace(/\s+/g, ' ')
          .trim();
        const allowed = [...keptFolded].some((k) => k.includes(foldString(match).trim()));
        hits.push({ part: partName(part), label: t.label, match, snippet, allowed });
        if (hits.length > 50) return hits;
      }
    }
  }
  return hits;
}
