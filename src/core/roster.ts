import Papa from 'papaparse';
import type { ParsedEssay, RosterEntry } from './types';
import { fold, foldString, findFolded, normFileName, wordRegex } from './text';
import { nameVariants, splitName } from './names';

export interface RosterTable {
  headers: string[];
  rows: string[][];
}

export type RosterField = 'name' | 'first' | 'last' | 'otherNames' | 'fileName' | 'instructor' | 'course' | 'email';

export type ColumnMapping = Partial<Record<RosterField, number>>;

export const FIELD_LABELS: Record<RosterField, string> = {
  name: 'Student full name',
  first: 'First name (if split)',
  last: 'Last name (if split)',
  otherNames: 'Preferred / other names',
  fileName: 'File name',
  instructor: 'Instructor',
  course: 'Course / section',
  email: 'Student email',
};

/** Parse CSV or tab-separated text (pasted from Excel / Google Sheets). */
export function parseRosterText(text: string): RosterTable {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimiter: '' });
  const data = (res.data as string[][]).map((r) => r.map((c) => (c ?? '').toString().trim()));
  if (!data.length) return { headers: [], rows: [] };
  return { headers: data[0], rows: data.slice(1).filter((r) => r.some((c) => c)) };
}

const GUESSES: [RosterField, RegExp][] = [
  ['email', /e-?mail/i],
  ['fileName', /file|attachment|document|submission|upload/i],
  ['instructor', /instructor|professor|teacher|faculty|prof\b|nominat/i],
  ['course', /course|class|section|seminar/i],
  ['otherNames', /preferred|nick|other name|goes by|aka/i],
  ['first', /^(?:student\s*)?first|given/i],
  ['last', /^(?:student\s*)?last|surname|family/i],
  ['name', /name|student|author/i],
];

export function guessMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  const used = new Set<number>();
  for (const [field, re] of GUESSES) {
    const idx = headers.findIndex((h, i) => !used.has(i) && re.test(h));
    if (idx >= 0 && m[field] === undefined) {
      m[field] = idx;
      used.add(idx);
    }
  }
  return m;
}

export function buildRoster(table: RosterTable, mapping: ColumnMapping): RosterEntry[] {
  const get = (row: string[], f: RosterField) => {
    const i = mapping[f];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const out: RosterEntry[] = [];
  table.rows.forEach((row, i) => {
    let name = get(row, 'name');
    const first = get(row, 'first');
    const last = get(row, 'last');
    if (!name && (first || last)) name = `${first} ${last}`.trim();
    else if (name && first && last && !foldString(name).includes(foldString(last))) name = `${first} ${last}`;
    if (!name) return;
    const other = get(row, 'otherNames')
      .split(/[;,/]|\bor\b/)
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({
      id: `r${i}`,
      name,
      otherNames: other,
      fileName: get(row, 'fileName') || undefined,
      instructor: get(row, 'instructor') || undefined,
      course: get(row, 'course') || undefined,
      email: get(row, 'email') || undefined,
    });
  });
  return out;
}

export interface MatchResult {
  entryId: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reason: string;
  candidates: string[];
}

/** Guess which roster row an essay belongs to: by file name, then by names inside the document. */
export function matchEssay(essay: ParsedEssay, roster: RosterEntry[]): MatchResult {
  if (!roster.length) return { entryId: null, confidence: 'none', reason: 'No roster loaded', candidates: [] };
  const fn = normFileName(essay.fileName);

  // 1. exact file-name match from a roster column
  const byFile = roster.filter((r) => {
    if (!r.fileName) return false;
    const rf = normFileName(r.fileName.split(/[\\/]/).pop() ?? r.fileName);
    return rf.length > 0 && (rf === fn || (rf.length >= 6 && (fn.includes(rf) || rf.includes(fn))));
  });
  if (byFile.length === 1) return { entryId: byFile[0].id, confidence: 'high', reason: 'File name matches roster', candidates: [] };

  // 2. score by names in file name, document text header and metadata
  const fnWords = new Set(
    foldString(essay.fileName.replace(/\.[a-z0-9]+$/i, ''))
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length >= 2),
  );
  const headText = essay.blocks
    .filter((b) => b.kind !== 'body')
    .map((b) => b.text)
    .concat(essay.blocks.filter((b) => b.kind === 'body').slice(0, 12).map((b) => b.text))
    .join('\n');
  const allText = essay.blocks.map((b) => b.text).join('\n');
  const headF = fold(headText);
  const allF = fold(allText);
  const metaF = fold(essay.metaNames.join('\n'));

  const scored = roster.map((r) => {
    let score = 0;
    const why: string[] = [];
    const names = [r.name, ...r.otherNames];
    const p = splitName(r.name);
    if (p) {
      const first = foldString(p.first);
      const last = foldString(p.last);
      if (fnWords.has(last) && last.length >= 2) {
        score += 3;
        why.push('last name in file name');
      }
      if (fnWords.has(first) && first.length >= 2) {
        score += 1;
        if (!why.length) why.push('first name in file name');
      }
    }
    for (const n of names) {
      const v = nameVariants(n, { singles: false });
      for (const ph of v.phrases) {
        const re = wordRegex(ph);
        if (findFolded(headF, re).length) {
          score += 4;
          why.push('name in essay header');
          break;
        }
        if (findFolded(allF, re).length) {
          score += 2;
          why.push('name in essay text');
          break;
        }
        if (findFolded(metaF, re).length) {
          score += 3;
          why.push('name in document properties');
          break;
        }
      }
    }
    if (r.email && foldString(allText).includes(foldString(r.email))) {
      score += 4;
      why.push('email in essay');
    }
    return { r, score, why };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const cands = scored.filter((s) => s.score > 0).slice(0, 5).map((s) => s.r.id);
  if (!top || top.score === 0) return { entryId: null, confidence: 'none', reason: 'No roster name found in file', candidates: [] };
  const second = scored[1];
  if (second && second.score === top.score) {
    return { entryId: null, confidence: 'low', reason: 'Several roster names match equally', candidates: cands };
  }
  const conf = top.score >= 4 ? 'high' : top.score >= 3 ? 'medium' : 'low';
  return { entryId: top.r.id, confidence: conf, reason: [...new Set(top.why)].join(', '), candidates: cands };
}
