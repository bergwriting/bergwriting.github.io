/**
 * Text normalisation helpers. Matching is done on a "folded" copy of the text
 * (lower-case, accents removed, curly quotes straightened), and every folded
 * character remembers its index in the original so matches map back exactly.
 */

export interface Folded {
  text: string;
  /** map[i] = index in the original string of folded char i; map[text.length] = original length. */
  map: number[];
}

const CHAR_MAP: Record<string, string> = {
  '’': "'",
  '‘': "'",
  'ʼ': "'",
  '´': "'",
  '`': "'",
  '‐': '-',
  '‑': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  'ß': 'ss',
  'ı': 'i',
  'ø': 'o',
  'ł': 'l',
  'æ': 'ae',
};

export function foldChar(ch: string): string {
  const mapped = CHAR_MAP[ch];
  if (mapped !== undefined) return mapped;
  return ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

export function fold(s: string): Folded {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) {
      text += f[k];
      map.push(i);
    }
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

export function foldString(s: string): string {
  return fold(s).text;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns a folded phrase into a regex source: whitespace runs match any whitespace,
 * and a trailing dot on a token (an initial, "J.") is optional.
 */
export function phraseSource(folded: string): string {
  const toks = folded.trim().split(/\s+/);
  let src = '';
  toks.forEach((t, i) => {
    const dotted = t.length > 1 && t.endsWith('.');
    if (i > 0) src += toks[i - 1].endsWith('.') ? '\\s*' : '\\s+';
    src += escapeRegex(dotted ? t.slice(0, -1) : t) + (dotted ? '\\.?' : '');
  });
  return src;
}

const WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_AFTER = '(?![\\p{L}\\p{N}])';

export function wordRegex(source: string): RegExp {
  return new RegExp(`${WORD_BEFORE}(?:${source})${WORD_AFTER}`, 'gu');
}

export interface Match {
  start: number;
  end: number;
}

/** Find all matches of a regex (built for folded text) and map them back to original offsets. */
export function findFolded(f: Folded, re: RegExp): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f.text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = f.map[m.index];
    const endFolded = m.index + m[0].length;
    // end = original index just past the last matched char
    const lastOrig = f.map[endFolded - 1];
    let end = f.map[endFolded];
    if (end === lastOrig) end = lastOrig + 1;
    out.push({ start, end });
  }
  return out;
}

export function isUpperStart(s: string): boolean {
  const c = s.charAt(0);
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

export function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

let counter = 0;
export function uid(prefix = 's'): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Normalises a file name for comparison: no extension, no punctuation, lower-case. */
export function normFileName(name: string): string {
  return foldString(name.replace(/\.[a-z0-9]{2,5}$/i, ''))
    .replace(/\(\d+\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
