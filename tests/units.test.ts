import { describe, expect, it } from 'vitest';
import { fold, findFolded, wordRegex } from '../src/core/text';
import { nameVariants, splitName, looksLikePersonName } from '../src/core/names';
import { findTermSpans } from '../src/detect/terms';
import { patternSpans, DATE_LINE } from '../src/detect/patterns';
import { headerBlockSpans } from '../src/detect/headerBlock';
import { buildEdits, applyEditsToString } from '../src/core/replace';
import { applyEditsToRuns } from '../src/formats/pdfOut';
import { stripJpeg, stripPng } from '../src/formats/images';
import { decryptText, encryptText, keyCsv, uniqueCode } from '../src/key';
import { DEFAULT_SETTINGS, type Block, type Span } from '../src/core/types';
import { resolveSpans, applyRemoveChoices } from '../src/detect';
import { essayLabels, fileNameFor, namesInFileName, sanitizeFileName, uniqueNames } from '../src/naming';
import { DEFAULT_NAMING } from '../src/core/types';

const block = (text: string, kind: Block['kind'] = 'body', id = 'b1'): Block => ({ id, kind, text });
const spanText = (b: Block, s: Span) => b.text.slice(s.start, s.end);

describe('fold', () => {
  it('maps accented text back to original offsets', () => {
    const f = fold('Hello José Martínez!');
    const [m] = findFolded(f, wordRegex('jose martinez'));
    expect('Hello José Martínez!'.slice(m.start, m.end)).toBe('José Martínez');
  });
  it('treats curly apostrophes as straight', () => {
    expect(fold('O’Brien').text).toBe("o'brien");
  });
});

describe('names', () => {
  it('splits "Last, First" and drops titles and suffixes', () => {
    expect(splitName('Smith, Jane')).toMatchObject({ first: 'Jane', last: 'Smith' });
    expect(splitName('Dr. Jane Q. Smith Jr.')).toMatchObject({ first: 'Jane', last: 'Smith', middles: ['Q.'] });
  });

  const b = block("Jane Smith's essay. J. Smith wrote it; Smith, Jane agreed. Jane Q. Smith too. SMITH! the smith forged. Smithson no.");
  const v = nameVariants('Jane Q. Smith');
  const spans = findTermSpans([b], [{ category: 'STUDENT', action: 'redact', label: '', source: 'roster', ...v }]);
  const found = resolveSpans(spans).map((s) => spanText(b, s));

  it('finds full name, initials, reversed and possessive forms', () => {
    expect(found).toEqual(expect.arrayContaining(['Jane Smith', 'J. Smith', 'Smith, Jane', 'Jane Q. Smith', 'SMITH']));
  });
  it('ignores lowercase common-word uses and longer words', () => {
    expect(found).not.toContain('smith');
    expect(found.some((f) => f.includes('Smithson'))).toBe(false);
  });
  it('handles hyphenated surnames part by part', () => {
    const hv = nameVariants('Ana Lopez-Garcia');
    expect(hv.words).toEqual(expect.arrayContaining(['lopez-garcia', 'lopez', 'garcia']));
  });
  it('recognises person-like metadata', () => {
    expect(looksLikePersonName('Jane Smith')).toBe(true);
    expect(looksLikePersonName('Microsoft Office User')).toBe(false);
    expect(looksLikePersonName('python-docx')).toBe(false);
  });
});

describe('patterns', () => {
  const b = block(
    'Mail jane.doe@college.edu, call 610-555-1234 or (484) 555-9876. ID: A0012345. Student ID 7654321. ENG 101-02 and WRT201. ' +
      'See https://docs.google.com/document/d/abc and https://www.jstor.org/stable/123. Published 1999. Page 12345.',
  );
  const spans = patternSpans([b], DEFAULT_SETTINGS);
  const got = (cat: string) => spans.filter((s) => s.category === cat).map((s) => [spanText(b, s), s.action]);
  it('emails and phones', () => {
    expect(got('EMAIL')).toEqual([['jane.doe@college.edu', 'redact']]);
    expect(got('PHONE').map((x) => x[0])).toEqual(['610-555-1234', '(484) 555-9876']);
  });
  it('IDs but not years', () => {
    const ids = got('ID').map((x) => x[0]);
    expect(ids).toEqual(expect.arrayContaining(['A0012345', '7654321']));
    expect(ids).not.toContain('1999');
  });
  it('course codes', () => {
    expect(got('COURSE').map((x) => x[0])).toEqual(['ENG 101-02', 'WRT201']);
  });
  it('redacts personal links, flags cited links', () => {
    expect(got('URL')).toEqual([
      ['https://docs.google.com/document/d/abc', 'redact'],
      ['https://www.jstor.org/stable/123', 'flag'],
    ]);
  });
  it('recognises heading dates', () => {
    for (const d of ['12 October 2025', 'October 12, 2025', 'Oct. 12, 2025', '10/12/2025', 'Fall 2025', 'Date: March 3, 2026']) expect(DATE_LINE.test(d), d).toBe(true);
    expect(DATE_LINE.test('October was cold')).toBe(false);
  });
});

describe('heading block', () => {
  it('redacts name / instructor / course / date lines, keeps the title', () => {
    const blocks = ['Sam Rivera', 'Professor Chen', 'Composition 1', 'September 9, 2025', 'Grace Under Pressure', 'This essay argues that the first paragraph is long enough to count as body text, so the heading stops here.'].map((t, i) => block(t, 'body', `p${i}`));
    const spans = headerBlockSpans(blocks, []);
    const lines = spans.map((s) => blocks.find((b) => b.id === s.blockId)!.text);
    expect(lines).toEqual(['Sam Rivera', 'Professor Chen', 'September 9, 2025']);
    expect(spans[0].replacement).toBe('Essay {CODE}');
  });
  it('handles labelled headings', () => {
    const blocks = [block('Name: Sam Rivera\nInstructor: Dr. Chen\nCourse: Composition 1\nThe Title\n', 'body', 'p0')];
    const spans = headerBlockSpans(blocks, []);
    expect(spans.map((s) => spanText(blocks[0], s))).toEqual(['Name: Sam Rivera', 'Instructor: Dr. Chen', 'Course: Composition 1']);
  });
});

describe('edits', () => {
  it('merge adjacent identical placeholders', () => {
    const b = block('I was Jose Martinez then.');
    const spans: Span[] = [
      { id: '1', blockId: 'b1', start: 6, end: 10, category: 'STUDENT', action: 'redact', source: 'roster', label: '' },
      { id: '2', blockId: 'b1', start: 11, end: 19, category: 'STUDENT', action: 'redact', source: 'roster', label: '' },
    ];
    const edits = buildEdits([b], spans, 'WP-X').get('b1')!;
    expect(applyEditsToString(b.text, edits)).toBe('I was [STUDENT] then.');
  });
  it('apply across styled runs', () => {
    const runs = [{ text: 'The Oka' }, { text: 'for', bold: true }, { text: ' house' }];
    expect(applyEditsToRuns(runs, [{ start: 4, end: 10, text: '[STUDENT]' }])).toEqual([{ text: 'The [STUDENT]' }, { text: ' house' }]);
  });
  it('uses the essay code in page headers', () => {
    const b = block('Smith 3', 'header');
    const edits = buildEdits([b], [{ id: '1', blockId: 'b1', start: 0, end: 5, category: 'STUDENT', action: 'redact', source: 'roster', label: '' }], 'WP-7K3Q').get('b1')!;
    expect(applyEditsToString(b.text, edits)).toBe('WP-7K3Q 3');
  });
});

describe('images', () => {
  it('drops EXIF from JPEG', () => {
    const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, ...exif, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    const out = stripJpeg(jpg);
    expect(out.length).toBe(jpg.length - exif.length);
    expect([...out.slice(0, 2)]).toEqual([0xff, 0xd8]);
  });
  it('drops text chunks from PNG', () => {
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [1, 2]), ...chunk('tEXt', [65, 66, 67]), ...chunk('IEND', [])]);
    const out = stripPng(png);
    expect(new TextDecoder().decode(out)).not.toContain('tEXt');
    expect(out.length).toBe(png.length - 15);
  });
});

describe('key', () => {
  it('codes are unique and unambiguous', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 500; i++) uniqueCode(taken);
    expect(taken.size).toBe(500);
    for (const c of taken) expect(c).toMatch(/^WP-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/);
  });
  it('encrypts and decrypts', async () => {
    const enc = await encryptText('secret key rows', 'correct horse');
    expect(enc).not.toContain('secret');
    expect(await decryptText(enc, 'correct horse')).toBe('secret key rows');
    await expect(decryptText(enc, 'wrong')).rejects.toThrow(/passphrase/);
  });
  it('writes CSV safely', () => {
    const csv = keyCsv([{ code: 'WP-AAAA', outputFile: 'WP-AAAA.docx', originalFile: 'a,b.docx', student: '=cmd()', instructor: '', course: '', email: '', status: 'ok', redactions: 'x "y"', notes: '' }]);
    expect(csv).toContain('"a,b.docx"');
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('"x ""y"""');
  });
});

describe('what to remove', () => {
  const mk = (category: Span['category'], source = 'pattern'): Span => ({ id: category, blockId: 'b', start: 0, end: 1, category, action: 'redact', source, label: 'x' });
  it('keeps (as highlights) the kinds that are switched off', () => {
    const remove = { ...DEFAULT_SETTINGS.remove, email: false, dates: false, classmates: false };
    const out = applyRemoveChoices([mk('STUDENT', 'roster'), mk('EMAIL'), mk('DATE', 'header-block'), mk('STUDENT', 'roster-other'), mk('MANUAL', 'manual')], remove);
    expect(out.map((s) => `${s.category}:${s.source}:${s.action}`)).toEqual([
      'STUDENT:roster:redact',
      'EMAIL:pattern:flag',
      'DATE:header-block:flag',
      'STUDENT:roster-other:flag',
      'MANUAL:manual:redact',
    ]);
  });
});

describe('naming', () => {
  const items = [
    { key: 'a', code: '7K3Q', rank: 0.9 },
    { key: 'b', code: 'M4XP', rank: 0.1 },
    { key: 'c', code: 'T9AC', rank: 0.5 },
  ];
  it('codes use the prefix', () => {
    expect([...essayLabels(items, DEFAULT_NAMING).values()]).toEqual(['WP-7K3Q', 'WP-M4XP', 'WP-T9AC']);
    expect(essayLabels(items, { ...DEFAULT_NAMING, prefix: '' }).get('a')).toBe('7K3Q');
  });
  it('numbers follow the random rank, not the upload order', () => {
    const l = essayLabels(items, { ...DEFAULT_NAMING, style: 'number', prefix: 'Essay' });
    expect([l.get('a'), l.get('b'), l.get('c')]).toEqual(['Essay 03', 'Essay 01', 'Essay 02']);
  });
  it('builds safe file names from the pattern', () => {
    expect(fileNameFor('WP-7K3Q', '{label}', '2026-09-28')).toBe('WP-7K3Q');
    expect(fileNameFor('Essay 01', 'Writing Award {date} - {label}', '2026-09-28')).toBe('Writing Award 2026-09-28 - Essay 01');
    expect(fileNameFor('WP-7K3Q', 'Prize', 'd')).toBe('Prize WP-7K3Q');
    expect(sanitizeFileName('a/b:c*?"<>|d')).toBe('a b c d');
    expect(uniqueNames(['x', 'X', 'y', 'x'])).toEqual(['x', 'X (2)', 'y', 'x (3)']);
  });
  it('spots student names in file names', () => {
    const roster = [{ id: 'r', name: 'Grace Young', otherNames: [], instructor: 'Alan Whitfield', email: 'gyoung@example.edu' }];
    expect(namesInFileName('young_final', roster)).toEqual(['Grace Young']);
    expect(namesInFileName('Essay by Whitfield student', roster)).toEqual(['Alan Whitfield']);
    expect(namesInFileName('gyoung-essay', roster)).toEqual(['Grace Young', 'gyoung@example.edu']);
    expect(namesInFileName('Writing Award - WP-7K3Q', roster)).toEqual([]);
  });
  it('does not write "Essay Essay 01" in the heading', () => {
    const b = block('Grace Young');
    const span: Span = { id: '1', blockId: 'b1', start: 0, end: 11, category: 'STUDENT', action: 'redact', source: 'header-block', label: '', replacement: 'Essay {CODE}' };
    expect(applyEditsToString(b.text, buildEdits([b], [span], 'Essay 01').get('b1')!)).toBe('Essay 01');
    expect(applyEditsToString(b.text, buildEdits([b], [span], 'WP-7K3Q').get('b1')!)).toBe('Essay WP-7K3Q');
  });
});
