import { foldString, phraseSource } from './text';

const HONORIFICS = /^(?:prof(?:essor)?|dr|mr|mrs|ms|mx|miss|dean|rev|sr|sra|srta|mme|mlle|herr|frau)\.?$/i;
const SUFFIXES = /^(?:jr|sr|ii|iii|iv|v|phd|ph\.d|md|esq)\.?$/i;
const PARTICLES = new Set(['de', 'da', 'del', 'della', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'den', 'dos', 'das', 'al', 'el', 'bin', 'ibn', 'st', 'st.']);

export interface NameParts {
  tokens: string[];
  first: string;
  last: string;
  middles: string[];
}

/** Splits "Dr. Jane Q. Smith Jr." or "Smith, Jane" into cleaned tokens. */
export function splitName(raw: string): NameParts | null {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // "Last, First Middle" -> "First Middle Last" (but not "Smith, Jr.")
  const comma = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (comma.length === 2 && !SUFFIXES.test(comma[1]) && comma[1].split(' ').length <= 3) {
    s = `${comma[1]} ${comma[0]}`;
  } else {
    s = s.replace(/,/g, ' ');
  }
  const tokens = s
    .split(' ')
    .map((t) => t.replace(/^[("']+|[)"']+$/g, ''))
    .filter((t) => t && !HONORIFICS.test(t) && !SUFFIXES.test(t));
  if (!tokens.length) return null;
  return {
    tokens,
    first: tokens[0],
    last: tokens[tokens.length - 1],
    middles: tokens.slice(1, -1),
  };
}

export interface NameVariants {
  /** Multi-word forms, matched case-insensitively. Regex sources over folded text. */
  phrases: string[];
  /** Single-word forms, matched only when capitalised. Folded words. */
  words: string[];
}

/** Build the forms under which a person's name may appear in an essay. */
export function nameVariants(raw: string, opts: { singles?: boolean } = {}): NameVariants {
  const singles = opts.singles ?? true;
  const p = splitName(raw);
  if (!p) return { phrases: [], words: [] };
  const f = (x: string) => foldString(x);
  const first = f(p.first);
  const last = f(p.last);
  const mids = p.middles.map(f);
  const phr = new Set<string>();
  const add = (x: string) => {
    if (x.trim().split(/\s+/).length > 1) phr.add(phraseSource(x));
  };
  if (p.tokens.length > 1) {
    add(p.tokens.map(f).join(' '));
    add(`${first} ${last}`);
    add(`${last}, ${first}`);
    add(`${first[0]}. ${last}`);
    add(`${first} ${last[0]}.`);
    if (mids.length) {
      add(`${first} ${mids.map((m) => m[0] + '.').join(' ')} ${last}`);
      add(`${first[0]}. ${mids.map((m) => m[0] + '.').join(' ')} ${last}`);
      add(`${last}, ${first} ${mids.join(' ')}`);
      // compound surname: "Garcia Lopez" in "Maria Garcia Lopez"
      const nonParticle = mids.filter((m) => !PARTICLES.has(m));
      if (nonParticle.length) add(`${first} ${mids[mids.length - 1]}`);
      add(`${mids.join(' ')} ${last}`);
    }
  }
  const words = new Set<string>();
  if (singles) {
    for (const t of p.tokens) {
      const ft = f(t).replace(/\.$/, '');
      if (ft.length >= 2 && !PARTICLES.has(ft)) words.add(ft);
      for (const part of ft.split(/[-']/)) {
        if (part.length >= 3 && !PARTICLES.has(part)) words.add(part);
      }
    }
  }
  return { phrases: [...phr], words: [...words] };
}

/** Rough "looks like a person name" test used for metadata and filenames. */
export function looksLikePersonName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 60) return false;
  if (/@|\d|\\|\//.test(t)) return false;
  const bad = /^(?:microsoft|office|user|admin|administrator|owner|unknown|author|word|google|docs|apple|pages|windows|student|python|docx|pdf|writer|libreoffice|openoffice|preview|quartz|acrobat|adobe|compaq|hp|dell|lenovo|asus|home|default|guest|test)\b/i;
  if (bad.test(t)) return false;
  const toks = t.split(/[\s,]+/).filter(Boolean);
  if (toks.length < 1 || toks.length > 5) return false;
  return toks.every((x) => /^[\p{L}][\p{L}.'’-]*$/u.test(x));
}
