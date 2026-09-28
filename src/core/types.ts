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
}

export const DEFAULT_SETTINGS: Settings = {
  institutions: '',
  extraTerms: '',
  idPattern: String.raw`\b\d{7,9}\b`,
  coursePrefixes: 'ENG, ENGL, WRT, WRI, WRIT, WRTG, FYS, FYW, FYWS, RHET, COMP, CW, LIT',
  flagOtherNames: true,
};

export interface ParsedEssay {
  fileName: string;
  format: 'docx' | 'pdf';
  blocks: Block[];
  /** Names found in document properties, comment and revision authors, PDF /Author. */
  metaNames: string[];
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
