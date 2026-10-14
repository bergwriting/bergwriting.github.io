export type Category =
  | 'STUDENT'
  | 'INSTRUCTOR'
  | 'COURSE'
  | 'SCHOOL'
  | 'EMAIL'
  | 'PHONE'
  | 'ID'
  | 'URL'
  | 'DATE'
  | 'PERSON'
  | 'TERM'
  | 'MANUAL';

export type Action = 'redact' | 'flag';

export type BlockKind = 'body' | 'header' | 'footer' | 'note' | 'textbox';

/** One paragraph (or paragraph-like unit) of document text. */
export interface Block {
  id: string;
  kind: BlockKind;
  text: string;
}

/** A detected piece of text inside a block. `flag` means "shown to the reviewer, kept by default". */
export interface Span {
  id: string;
  blockId: string;
  start: number;
  end: number;
  category: Category;
  action: Action;
  /** Which detector produced it (roster, metadata, header-block, pattern, names, manual...). */
  source: string;
  /** Human-readable reason, shown in the review screen. */
  label: string;
  /** Optional replacement template; `{CODE}` is replaced with the essay code. */
  replacement?: string;
  /** Set when the reviewer changed or added this span by hand. */
  userSet?: boolean;
}

export interface RosterEntry {
  id: string;
  name: string;
  otherNames: string[];
  fileName?: string;
  instructor?: string;
  course?: string;
  email?: string;
}

export interface Settings {
  /** School / college names, one per line. */
  institutions: string;
  /** Extra words or phrases to always redact (dorms, hometowns...), one per line. */
  extraTerms: string;
  /** Regex source for student ID numbers. */
  idPattern: string;
  /** Course department prefixes, comma separated (ENG, WRT...). */
  coursePrefixes: string;
  /** Flag (not redact) other person names found by the lexicon. */
  flagOtherNames: boolean;
  /** Which kinds of detail to remove. Switched-off kinds are still highlighted (kept) in review. */
  remove: Record<RemoveKey, boolean>;
  /** How essays are labelled inside the document and named on disk. */
  naming: Naming;
  /** Settings format version (for upgrading saved settings). */
  version?: number;
}

export const SETTINGS_VERSION = 2;

/** The kinds of identifying detail a committee can choose to remove. */
export type RemoveKey = 'studentName' | 'instructor' | 'classmates' | 'course' | 'school' | 'email' | 'phone' | 'ids' | 'links' | 'dates';

export const REMOVE_OPTIONS: { key: RemoveKey; label: string; hint: string }[] = [
  { key: 'studentName', label: "Writer's name", hint: 'Every form: full, first, last, initials, nickname. Always recommended.' },
  { key: 'instructor', label: 'Instructor / professor', hint: 'From the roster, and "Professor X" anywhere' },
  { key: 'classmates', label: 'Other students on the roster', hint: 'Classmates, roommates, co-authors named in the essay' },
  { key: 'course', label: 'Course and section', hint: 'e.g. ENG 101-03' },
  { key: 'school', label: 'School / college name', hint: 'Names listed under Settings' },
  { key: 'email', label: 'Email addresses', hint: 'Often contain the writer\'s name' },
  { key: 'phone', label: 'Phone numbers', hint: '' },
  { key: 'ids', label: 'Student ID numbers', hint: 'Format set under Settings' },
  { key: 'links', label: 'Personal links', hint: 'Shared Google Docs, LinkedIn, social media (cited sources are always kept)' },
  { key: 'dates', label: 'Heading dates', hint: 'The date line at the top of the essay' },
];

export const REMOVE_PRESETS: { id: string; label: string; keys: RemoveKey[] }[] = [
  { id: 'writer', label: "Writer's name only", keys: ['studentName'] },
  { id: 'names', label: 'All names (writer, instructor, classmates)', keys: ['studentName', 'instructor', 'classmates'] },
  { id: 'contact', label: 'Names + contact details', keys: ['studentName', 'instructor', 'classmates', 'email', 'phone', 'ids', 'links'] },
  { id: 'all', label: 'Everything', keys: REMOVE_OPTIONS.map((o) => o.key) },
];

export interface Naming {
  /** `code`: random code like WP-7K3Q. `number`: 01, 02… assigned in random order. */
  style: 'code' | 'number';
  /** Text before the code or number, e.g. "WP" or "Essay". */
  prefix: string;
  /** File-name pattern; {label} is replaced with the essay label. */
  pattern: string;
  /** Name of the ZIP file (without .zip); {date} allowed. */
  zipName: string;
  /** Name of the key file (without extension); {date} allowed. */
  keyName: string;
}

export const DEFAULT_NAMING: Naming = {
  style: 'code',
  prefix: 'WP',
  pattern: '{label}',
  zipName: 'anonymized-essays-{date}',
  keyName: 'KEY-CONFIDENTIAL-{date}',
};

export const DEFAULT_SETTINGS: Settings = {
  institutions: '',
  extraTerms: '',
  idPattern: String.raw`\b\d{7,9}\b`,
  coursePrefixes: 'ENG, ENGL, WRT, WRI, WRIT, WRTG, FYS, FYW, FYWS, RHET, COMP, CW, LIT',
  flagOtherNames: false,
  remove: Object.fromEntries(REMOVE_OPTIONS.map((o) => [o.key, o.key === 'studentName'])) as Record<RemoveKey, boolean>,
  naming: DEFAULT_NAMING,
  version: SETTINGS_VERSION,
};

/** Fill in any options missing from settings saved by an older version. */
export function completeSettings(s: Partial<Settings>): Settings {
  // Version 1 removed everything by default; version 2 defaults to the writer's name only.
  const old = (s.version ?? 1) < 2;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    flagOtherNames: old ? DEFAULT_SETTINGS.flagOtherNames : (s.flagOtherNames ?? DEFAULT_SETTINGS.flagOtherNames),
    remove: old ? { ...DEFAULT_SETTINGS.remove } : { ...DEFAULT_SETTINGS.remove, ...(s.remove ?? {}) },
    naming: { ...DEFAULT_NAMING, ...(s.naming ?? {}) },
    version: SETTINGS_VERSION,
  };
}

export interface ParsedEssay {
  fileName: string;
  format: 'docx' | 'pdf';
  blocks: Block[];
  /** Names found in document properties, comment and revision authors, PDF /Author. */
  metaNames: string[];
  /** Just the document's author fields (Word creator / last modified by, PDF Author): likely the writer. */
  authorNames: string[];
  warnings: string[];
  /** Non-recoverable problem (e.g. scanned PDF with no text). */
  fatal?: string;
  /** Original file bytes. Export re-parses from these so it is repeatable. */
  bytes: Uint8Array;
}

export const PLACEHOLDER: Record<Category, string> = {
  STUDENT: '[STUDENT]',
  INSTRUCTOR: '[INSTRUCTOR]',
  COURSE: '[COURSE]',
  SCHOOL: '[SCHOOL]',
  EMAIL: '[EMAIL]',
  PHONE: '[PHONE]',
  ID: '[ID]',
  URL: '[URL]',
  DATE: '[DATE]',
  PERSON: '[NAME]',
  TERM: '[REDACTED]',
  MANUAL: '[REDACTED]',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  STUDENT: 'Student',
  INSTRUCTOR: 'Instructor',
  COURSE: 'Course',
  SCHOOL: 'School',
  EMAIL: 'Email',
  PHONE: 'Phone',
  ID: 'ID number',
  URL: 'Link',
  DATE: 'Date',
  PERSON: 'Person name',
  TERM: 'Custom term',
  MANUAL: 'Manual',
};
