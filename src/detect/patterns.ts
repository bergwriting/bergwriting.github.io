import type { Action, Block, Category, Settings, Span } from '../core/types';
import { uid } from '../core/text';

interface Rule {
  re: RegExp;
  category: Category;
  action: Action | ((m: RegExpExecArray, block: Block) => Action);
  label: string;
  /** Use a capture group as the span instead of the whole match. */
  group?: number;
  trim?: boolean;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"()]+[^\s<>"().,;:!?'’]/giu;
const PHONE = /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g;
const ID_LABEL = /\b(?:student\s*)?(?:id|i\.d\.)\s*(?:#|no\.?|number|num\.?)?\s*[:#]?\s*([A-Z]{0,3}\d[\dA-Z-]{3,})\b/giu;
const HANDLE = /(?<![\p{L}\p{N}._%+-])@[A-Za-z0-9_.]{2,30}\b/gu;
const PROFESSOR = /\b(?:Professor|Prof\.)\s+(?:[A-Z][\p{L}'’-]+\s+){0,2}[A-Z][\p{L}'’-]+/gu;
const HONORIFIC = /\b(?:Dr|Mr|Mrs|Ms|Mx)\.?\s+(?:[A-Z][\p{L}'’-]+\s+){0,2}[A-Z][\p{L}'’-]+/gu;
const SCHOOL_GENERIC = /\b(?:(?:St\.|[A-Z][\p{L}'’.-]+)\s+){1,4}(?:High School|Middle School|Elementary School|Preparatory School|Prep School|Academy|Charter School|Senior High|Junior High)\b/gu;

/** URLs that are likely to point at the student themselves rather than a cited source. */
const PERSONAL_URL = /(?:docs|drive|sites)\.google\.com|onedrive|sharepoint|1drv\.ms|dropbox|linkedin\.com|instagram\.com|facebook\.com|tiktok\.com|twitter\.com|\bx\.com|github\.com|youtube\.com\/@|medium\.com\/@|wixsite|weebly|wordpress\.com|substack|canvas|blackboard|moodle|~/i;

function coursePrefixRegex(settings: Settings): RegExp | null {
  const prefixes = settings.coursePrefixes
    .split(/[,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter((p) => /^[A-Z]{1,6}$/.test(p));
  if (!prefixes.length) return null;
  return new RegExp(`\\b(?:${prefixes.join('|')})\\s?-?\\s?\\d{2,4}[A-Z]?(?:\\s?[-.:]\\s?\\d{1,3}[A-Z]?)?\\b`, 'g');
}

function idRegex(settings: Settings): RegExp | null {
  if (!settings.idPattern.trim()) return null;
  try {
    return new RegExp(settings.idPattern, 'gu');
  } catch {
    return null;
  }
}

export function patternSpans(blocks: Block[], settings: Settings): Span[] {
  const rules: Rule[] = [
    { re: EMAIL, category: 'EMAIL', action: 'redact', label: 'Email address' },
    {
      re: URL,
      category: 'URL',
      action: (m) => (PERSONAL_URL.test(m[0]) ? 'redact' : 'flag'),
      label: 'Web link',
    },
    { re: PHONE, category: 'PHONE', action: 'redact', label: 'Phone number' },
    { re: ID_LABEL, category: 'ID', action: 'redact', label: 'ID number' },
    { re: HANDLE, category: 'ID', action: 'flag', label: 'Social media handle' },
    { re: PROFESSOR, category: 'INSTRUCTOR', action: 'redact', label: 'Professor + name' },
    { re: HONORIFIC, category: 'PERSON', action: 'flag', label: 'Title + name (Dr./Mr./Ms.)' },
    { re: SCHOOL_GENERIC, category: 'SCHOOL', action: 'flag', label: 'School name' },
  ];
  const course = coursePrefixRegex(settings);
  if (course) rules.push({ re: course, category: 'COURSE', action: 'redact', label: 'Course code' });
  const id = idRegex(settings);
  if (id) rules.push({ re: id, category: 'ID', action: 'redact', label: 'ID number (pattern in settings)' });

  const out: Span[] = [];
  for (const b of blocks) {
    if (!b.text) continue;
    for (const r of rules) {
      r.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = r.re.exec(b.text))) {
        if (!m[0].length) {
          r.re.lastIndex++;
          continue;
        }
        // Skip email text already covered as part of a URL and vice versa is handled by overlap resolution.
        const action = typeof r.action === 'function' ? r.action(m, b) : r.action;
        let start = m.index;
        let end = m.index + m[0].length;
        if (r.re === ID_LABEL && m[1]) {
          start = m.index + m[0].lastIndexOf(m[1]);
          end = start + m[1].length;
        }
        // years and page ranges are not IDs
        if (r.category === 'ID' && /^(1[5-9]|20)\d{2}$/.test(b.text.slice(start, end))) continue;
        out.push({ id: uid(), blockId: b.id, start, end, category: r.category, action, source: 'pattern', label: r.label });
      }
    }
  }
  return out;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
export const DATE_LINE = new RegExp(
  `^(?:(?:date|due|submitted)\\s*[:\\-]?\\s*)?(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{2,4}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|${MONTH}\\s+\\d{4}|(?:fall|spring|summer|winter)\\s+(?:semester\\s+)?\\d{4})\\.?$`,
  'i',
);
