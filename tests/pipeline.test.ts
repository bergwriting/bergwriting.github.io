import { describe, expect, it, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { allFixtures, FORBIDDEN, REQUIRED, ROSTER_CSV } from './fixtures/make-fixtures.mjs';
import { parseEssay, exportEssay } from '../src/pipeline';
import { buildRoster, guessMapping, matchEssay, parseRosterText } from '../src/core/roster';
import { detectAll } from '../src/detect';
import { DEFAULT_SETTINGS, type RosterEntry, type Settings } from '../src/core/types';
import { docxAllText } from '../src/formats/docx';
import { foldString } from '../src/core/text';

const settings: Settings = { ...DEFAULT_SETTINGS, institutions: 'Muhlenberg College\nMuhlenberg' };

let fixtures: Record<string, Uint8Array>;
let roster: RosterEntry[];

beforeAll(async () => {
  fixtures = await allFixtures();
  const table = parseRosterText(ROSTER_CSV);
  roster = buildRoster(table, guessMapping(table.headers));
});

async function allText(bytes: Uint8Array): Promise<string> {
  return (await docxAllText(bytes)).map((p) => p.text).join('\n');
}

async function run(name: string) {
  const essay = await parseEssay(name, fixtures[name]);
  const match = matchEssay(essay, roster);
  const student = roster.find((r) => r.id === match.entryId);
  const spans = detectAll(essay, { student, others: roster, settings });
  const out = await exportEssay(essay, spans, 'WP-TEST', student);
  return { essay, match, student, spans, out, text: await allText(out.bytes) };
}

describe('roster', () => {
  it('guesses columns and reads rows', () => {
    const table = parseRosterText(ROSTER_CSV);
    const m = guessMapping(table.headers);
    expect(m).toMatchObject({ name: 0, otherNames: 1, fileName: 2, instructor: 3, course: 4, email: 5 });
    expect(roster).toHaveLength(5);
    expect(roster[1].otherNames).toEqual(['Pepito']);
  });
});

describe.each(Object.keys(FORBIDDEN))('anonymizing %s', (name) => {
  let r: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    r = await run(name);
  });

  it('matches the right roster row', () => {
    expect(r.essay.fatal).toBeUndefined();
    expect(r.student?.fileName).toBe(name);
    expect(r.match.confidence).toBe('high');
  });

  it('leaves no identifying text anywhere in the output file', () => {
    const folded = foldString(r.text);
    for (const bad of FORBIDDEN[name as keyof typeof FORBIDDEN]) {
      const i = folded.indexOf(foldString(bad));
      expect(i, `"${bad}" found: …${r.text.slice(Math.max(0, i - 60), i + 60)}…`).toBe(-1);
    }
  });

  it('keeps the essay content', () => {
    for (const good of REQUIRED[name as keyof typeof REQUIRED]) expect(r.text).toContain(good);
  });

  it('puts the essay code in the heading and page header', async () => {
    expect(r.text).toContain('Essay WP-TEST');
    const zip = await JSZip.loadAsync(r.out.bytes);
    const headers = Object.keys(zip.files).filter((p) => /word\/header\d*\.xml/.test(p));
    const headerText = (await Promise.all(headers.map((h) => zip.file(h)!.async('string')))).join('');
    expect(headerText).toContain('WP-TEST');
  });

  it('passes its own leak check', () => {
    expect(r.out.hits.filter((h) => !h.allowed)).toEqual([]);
  });

  it('has blank document properties and no comments, thumbnail or custom XML', async () => {
    const zip = await JSZip.loadAsync(r.out.bytes);
    const files = Object.keys(zip.files);
    expect(files.some((f) => /comments|people\.xml|thumbnail|customXml|custom\.xml/.test(f))).toBe(false);
    const core = await zip.file('docProps/core.xml')?.async('string');
    if (core) expect(core).not.toMatch(/<dc:creator>[^<]+|<cp:lastModifiedBy>[^<]+/);
  });

  it('flags (but keeps) other person names', () => {
    const flagged = r.spans.filter((s) => s.action === 'flag').map((s) => r.essay.blocks.find((b) => b.id === s.blockId)!.text.slice(s.start, s.end));
    expect(flagged.length).toBeGreaterThan(0);
  });
});

describe('scanned PDF', () => {
  it('is rejected with a clear message (no OCR)', async () => {
    const essay = await parseEssay('nguyen_scan.pdf', fixtures['nguyen_scan.pdf']);
    expect(essay.fatal).toMatch(/no selectable text/i);
  });
});

describe('unsupported files', () => {
  it('explains how to convert .doc', async () => {
    const essay = await parseEssay('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    expect(essay.fatal).toMatch(/\.docx/);
  });
  it('rejects a corrupt .docx', async () => {
    const essay = await parseEssay('broken.docx', new Uint8Array([1, 2, 3]));
    expect(essay.fatal).toMatch(/not a readable \.docx/);
  });
});

describe('without a roster match', () => {
  const STUDENT_NAMES: Record<string, string[]> = {
    'Okafor_Essay_Final.docx': ['Okafor', 'Amara'],
    'Martinez-Ruiz WRT201.docx': ['Martínez', 'Ruiz', 'José'],
    'young_reading_the_river.pdf': ['Grace Young', 'Young 1', 'Grace,', 'gyoung'],
  };
  it.each(Object.keys(STUDENT_NAMES))('still removes the author name from %s (heading, metadata, page header)', async (name) => {
    const essay = await parseEssay(name, fixtures[name]);
    const spans = detectAll(essay, { student: undefined, others: [], settings: DEFAULT_SETTINGS });
    const out = await exportEssay(essay, spans, 'WP-TEST', undefined);
    const folded = foldString(await allText(out.bytes));
    for (const bad of STUDENT_NAMES[name]) expect(folded.includes(foldString(bad)), bad).toBe(false);
  });
});

describe('"Names only" preset', () => {
  it('removes names but keeps email, course and date', async () => {
    const name = 'Okafor_Essay_Final.docx';
    const remove = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.remove).map((k) => [k, ['studentName', 'instructor', 'classmates'].includes(k)])) as Settings['remove'];
    const s: Settings = { ...settings, remove };
    const essay = await parseEssay(name, fixtures[name]);
    const student = roster.find((r) => r.fileName === name);
    const spans = detectAll(essay, { student, others: roster, settings: s });
    const out = await exportEssay(essay, spans, 'WP-TEST', student, remove);
    const text = await allText(out.bytes);
    // the kept email address itself contains the name, by the committee's choice
    const outsideEmail = foldString(text).replaceAll('amara.okafor@example.edu', '');
    for (const bad of ['Okafor', 'Amara', 'Daniel Reyes', 'Priya Shah']) expect(outsideEmail).not.toContain(foldString(bad));
    for (const kept of ['amara.okafor@example.edu', 'ENG 101-03', '12 October 2025', '555-0142', 'Muhlenberg College']) expect(text).toContain(kept);
    expect(out.hits.filter((h) => !h.allowed)).toEqual([]);
    // switched-off kinds are still highlighted for the reviewer
    expect(spans.some((sp) => sp.category === 'EMAIL' && sp.action === 'flag')).toBe(true);
  });
});
