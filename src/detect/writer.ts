/**
 * Guess who wrote an essay, without a roster and without relying on a first-name
 * list (which misses many names, e.g. "Hamed", "Amara", "Oluwaseun"). Evidence is
 * combined from the file itself: "Name:"/"By" lines, the heading block, the running
 * page header ("Surname 1"), the file name, and the document's author field.
 */
import nlp from 'compromise';
import type { ParsedEssay } from '../core/types';
import { foldString } from '../core/text';
import { looksLikePersonName } from '../core/names';
import { DATE_LINE } from './patterns';
import { HONORIFIC_LINE, headerLines } from './headerBlock';

export interface WriterCandidate {
  name: string;
  score: number;
  reasons: string[];
}

/** Score at which a guess is filled in automatically (the reviewer can still change it). */
export const AUTO_FILL_SCORE = 6;

const NOT_NAME = new Set(
  (
    'the a an of and or in on at for to from with by my our your his her their its this that these those why how what when where who is are was were be not no nor ' +
    'under over into onto upon beyond through after before between without within against about among around across along like as than until while ' +
    'all one two three first last new old little big small great good bad long short high low home love life time day days night world city house river road light dark ' +
    'essay final draft paper assignment reflection response chapter part introduction conclusion analysis untitled document copy revised revision submission project ' +
    'english writing composition seminar prompt title narrative memoir personal statement argument research report proposal portfolio letter poem poems story fiction nonfiction creative'
  ).split(' '),
);

const FILE_NOISE = new Set(
  'essay final draft paper assignment copy revised revision rev submission submitted project english eng engl wrt writ writing comp composition fys fyw seminar class course doc docx pdf google docs microsoft word version ver v new old edit edited clean contest prize award entry nomination nominated'
    .split(' '),
);

const LABEL_LINE = /^(?:student(?:\s+name)?|name|author|written\s+by|by|submitted\s+by)\s*[:\-–]?\s+(.+)$/i;
const COURSE_LIKE = /\b[A-Z]{2,5}\s?-?\d{2,4}\b|\b(?:course|class|section|seminar)\b/i;
const RUNNING = /^\s*(\p{Lu}[\p{L}'’-]+)\s+(?:page\s+)?\d{1,3}\s*$/u;

/** A short line of capitalised words that could be a person's name. */
export function nameShaped(text: string): boolean {
  const toks = text.trim().split(/\s+/);
  if (toks.length < 2 || toks.length > 4) return false;
  return toks.every((t) => /^\p{Lu}[\p{L}'’.-]*$/u.test(t) && t.length <= 24 && !NOT_NAME.has(t.toLowerCase().replace(/[.'’]/g, '')));
}

function titleCase(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "Hamed_Yaghoobian_Essay-final (2).docx" -> "Hamed Yaghoobian" */
export function nameFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\(\d+\)/g, ' ');
  const words = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}'’]+/u)
    .filter((w) => w.length >= 2 && !FILE_NOISE.has(w.toLowerCase()));
  if (words.length < 1 || words.length > 4) return null;
  return words.map((w) => titleCase(w.toLowerCase())).join(' ');
}

export function guessWriter(essay: ParsedEssay): WriterCandidate[] {
  const cands = new Map<string, WriterCandidate>();
  const add = (name: string, score: number, reason: string) => {
    const clean = name.replace(/\s+/g, ' ').replace(/[,.;:]+$/, '').trim();
    if (!clean || clean.length > 60) return;
    const k = foldString(clean);
    const c = cands.get(k) ?? { name: clean, score: 0, reasons: [] };
    c.score += score;
    if (!c.reasons.includes(reason)) c.reasons.push(reason);
    cands.set(k, c);
  };

  const fileName = nameFromFileName(essay.fileName);
  const fileWords = new Set((fileName ?? '').split(' ').map((w) => foldString(w)));
  const runningSurnames = new Set<string>();
  for (const b of essay.blocks) {
    if (b.kind !== 'header' && b.kind !== 'footer') continue;
    const m = RUNNING.exec(b.text);
    if (m && !/^page$/i.test(m[1])) runningSurnames.add(foldString(m[1]));
  }

  // 1. The heading block at the top of the essay.
  const lines = headerLines(essay.blocks);
  const support = lines.filter((l) => HONORIFIC_LINE.test(l.text) || DATE_LINE.test(l.text) || COURSE_LIKE.test(l.text)).length;
  lines.slice(0, 6).forEach((l, i) => {
    const labelled = LABEL_LINE.exec(l.text);
    if (labelled && looksLikePersonName(labelled[1])) {
      add(labelled[1], 10, `“${l.text.split(/[:\s]/)[0]}” line in the heading`);
      return;
    }
    if (!nameShaped(l.text) || HONORIFIC_LINE.test(l.text)) return;
    const toks = l.text.split(/\s+/).map(foldString);
    let score = i === 0 ? 4 : i <= 2 ? 2 : 1;
    const reasons = [i === 0 ? 'first line of the essay' : 'essay heading'];
    // "Name" on the first line, then a title that is not name-shaped, then the essay
    if (i === 0 && lines.length >= 2 && !nameShaped(lines[1].text)) {
      score += 2;
      reasons[0] = 'first line, above the title';
    }
    if (support > 0 && i < 4) {
      score += 3;
      reasons.push('next to course/instructor/date lines');
    }
    if (toks.some((t) => fileWords.has(t))) {
      score += 4;
      reasons.push('matches the file name');
    }
    if (toks.some((t) => runningSurnames.has(t))) {
      score += 4;
      reasons.push('matches the page header');
    }
    if (nlp(l.text).has('#FirstName')) score += 1;
    for (const r of reasons) add(l.text, 0, r);
    add(l.text, score, reasons[0]);
  });

  // 2. "By …" / "Name: …" anywhere in the first few paragraphs (title pages, cover sheets).
  for (const b of essay.blocks.filter((x) => x.kind === 'body').slice(0, 15)) {
    for (const line of b.text.split('\n')) {
      const m = /^\s*(?:written\s+)?by\s+(\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,3})\s*$/u.exec(line);
      if (m) add(m[1], 8, '“By …” line');
    }
  }

  // 3. The document's author field (often blank in Google Docs exports).
  for (const a of essay.authorNames) {
    if (!looksLikePersonName(a)) continue;
    add(a, a.trim().includes(' ') ? 8 : 2, 'author in the file’s properties');
  }

  // 4. The file name.
  if (fileName && fileName.includes(' ')) add(fileName, 2, 'file name');

  // 5. Running page header surname on its own.
  for (const s of runningSurnames) {
    const full = [...cands.values()].find((c) => c.name.split(' ').some((t) => foldString(t) === s));
    if (!full) add(titleCase(s), 3, 'page header (“Surname 1”)');
  }

  // Merge a surname-only or first-name-only candidate into a fuller one that contains it.
  const list = [...cands.values()];
  for (const c of list) {
    if (c.name.includes(' ')) continue;
    const fuller = list.find((o) => o !== c && o.name.includes(' ') && o.name.split(' ').some((t) => foldString(t) === foldString(c.name)));
    if (fuller) {
      fuller.score += c.score;
      fuller.reasons.push(...c.reasons.filter((r) => !fuller.reasons.includes(r)));
      cands.delete(foldString(c.name));
    }
  }
  return [...cands.values()].filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
}

/** The guess to fill in automatically, if one is clearly ahead. */
export function autoWriter(cands: WriterCandidate[]): WriterCandidate | null {
  const [top, second] = cands;
  if (!top || top.score < AUTO_FILL_SCORE) return null;
  if (second && second.score >= top.score) return null;
  return top;
}

/** Names mentioned in the essay (for the autocomplete), most frequent first. */
export function namesInEssay(essay: ParsedEssay, limit = 40): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  const bump = (name: string, w = 1) => {
    const k = foldString(name);
    const c = counts.get(k) ?? { name, n: 0 };
    c.n += w;
    counts.set(k, c);
  };
  for (const b of essay.blocks) {
    if (!b.text.trim()) continue;
    for (const p of nlp(b.text).people().out('array') as string[]) {
      const t = p.replace(/['’]s$/, '').replace(/[.,;:!?"“”()]+$/g, '').trim();
      if (/^\p{Lu}/u.test(t) && t.length > 2) bump(t, 2);
    }
    // capitalised words that are not at the start of a sentence
    for (const m of b.text.matchAll(/(?<=[\p{Ll},;:]\s)(\p{Lu}[\p{Ll}'’-]{2,}(?:\s+\p{Lu}[\p{Ll}'’-]{2,}){0,2})/gu)) {
      if (!NOT_NAME.has(m[1].toLowerCase())) bump(m[1]);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.name);
}
