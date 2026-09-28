import type { ParsedEssay, Span } from '../core/types';
import { foldString } from '../core/text';
import { looksLikePersonName, nameVariants } from '../core/names';
import type { DetectContext } from './index';
import { findTermSpans, literalPhrases, type TermGroup } from './terms';

/** Build the term groups that come from the roster, document metadata and settings. */
export function rosterGroups(essay: ParsedEssay, ctx: DetectContext): TermGroup[] {
  const groups: TermGroup[] = [];
  const s = ctx.student;
  const studentFolded = new Set<string>();

  if (s) {
    const phrases: string[] = [];
    const words: string[] = [];
    for (const n of [s.name, ...s.otherNames]) {
      const v = nameVariants(n);
      phrases.push(...v.phrases);
      words.push(...v.words);
      studentFolded.add(foldString(n));
    }
    groups.push({ category: 'STUDENT', action: 'redact', label: 'Student name (roster)', source: 'roster', phrases, words });
    if (s.email) {
      groups.push({ category: 'EMAIL', action: 'redact', label: 'Student email (roster)', source: 'roster', phrases: literalPhrases([s.email]), words: [] });
    }
    if (s.instructor) {
      const v = nameVariants(s.instructor);
      groups.push({ category: 'INSTRUCTOR', action: 'redact', label: 'Instructor (roster)', source: 'roster', phrases: [...v.phrases, ...literalPhrases([s.instructor])], words: v.words });
    }
    if (s.course) {
      groups.push({ category: 'COURSE', action: 'redact', label: 'Course (roster)', source: 'roster', phrases: literalPhrases([s.course]), words: [] });
    }
  }

  // Names in document properties / comment authors that are not the matched student.
  const meta = essay.metaNames.filter((n) => looksLikePersonName(n) && !studentFolded.has(foldString(n)));
  if (meta.length) {
    const phrases: string[] = [];
    const words: string[] = [];
    for (const n of meta) {
      const v = nameVariants(n);
      phrases.push(...v.phrases);
      // a lone metadata word ("jsmith") is only used if it is name-like and long enough
      words.push(...v.words.filter((w) => w.length >= 3));
    }
    groups.push({ category: 'PERSON', action: 'redact', label: 'Name from document properties', source: 'metadata', phrases, words });
  }

  // Other students on the roster: only full-name forms, to avoid false positives.
  const others = ctx.others.filter((o) => o.id !== s?.id);
  if (others.length) {
    const phrases: string[] = [];
    for (const o of others) for (const n of [o.name, ...o.otherNames]) phrases.push(...nameVariants(n, { singles: false }).phrases);
    groups.push({ category: 'STUDENT', action: 'redact', label: 'Another student on the roster', source: 'roster-other', phrases, words: [] });
    const instr = [...new Set(others.map((o) => o.instructor).filter((x): x is string => !!x && x !== s?.instructor))];
    if (instr.length) {
      const ip: string[] = [];
      for (const n of instr) ip.push(...nameVariants(n, { singles: false }).phrases);
      groups.push({ category: 'INSTRUCTOR', action: 'redact', label: 'Instructor on the roster', source: 'roster-other', phrases: ip, words: [] });
    }
  }

  const lines = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const inst = lines(ctx.settings.institutions);
  if (inst.length) groups.push({ category: 'SCHOOL', action: 'redact', label: 'School name (settings)', source: 'settings', phrases: literalPhrases(inst), words: [] });
  const extra = lines(ctx.settings.extraTerms);
  if (extra.length) groups.push({ category: 'TERM', action: 'redact', label: 'Custom term (settings)', source: 'settings', phrases: literalPhrases(extra), words: [] });

  return groups;
}

export function rosterSpans(essay: ParsedEssay, ctx: DetectContext): Span[] {
  return findTermSpans(essay.blocks, rosterGroups(essay, ctx));
}
