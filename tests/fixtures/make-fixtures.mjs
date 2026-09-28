/**
 * Builds synthetic test essays (all names are fictional). Each one hides identity in
 * the places real submissions do: heading block, running page header, document
 * properties, comments, tracked changes, split formatting runs, footnotes, template
 * path, thumbnail, custom XML, email hyperlinks, PDF metadata.
 *
 *   node tests/fixtures/make-fixtures.mjs   -> writes tests/fixtures/files/*
 */
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AlignmentType, Document, Header, Packer, PageNumber, Paragraph, TextRun } from 'docx';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const ROSTER_CSV = [
  'Student Name,Preferred Name,File Submitted,Instructor,Course,Email',
  'Amara Okafor,,Okafor_Essay_Final.docx,Daniel Reyes,ENG 101-03,amara.okafor@example.edu',
  'José Martínez-Ruiz,Pepito,Martinez-Ruiz WRT201.docx,Dr. Helen Park,WRT 201,',
  'Grace Young,,young_reading_the_river.pdf,Alan Whitfield,FYS 150-02,gyoung@example.edu',
  'Priya Shah,,shah_memoir.docx,Daniel Reyes,ENG 101-03,',
  'Tom Nguyen,,nguyen_scan.pdf,Alan Whitfield,FYS 150-02,',
].join('\n');

/** Names that must not appear anywhere in each anonymized output. */
export const FORBIDDEN = {
  'Okafor_Essay_Final.docx': ['Okafor', 'Amara', 'amara.okafor', 'Daniel Reyes', 'Reyes', 'Priya Shah', 'Muhlenberg', '555-0142', '20231234', 'aokafor', 'Okafor Family'],
  'Martinez-Ruiz WRT201.docx': ['Martínez', 'Martinez', 'Ruiz', 'José', 'Jose Martinez', 'Pepito', 'Helen Park', 'Park said'],
  'young_reading_the_river.pdf': ['Grace Young', 'Young 1', 'Young 2', 'Alan Whitfield', 'Whitfield', 'gyoung', 'FYS 150'],
};

/** Text that must survive (content the committee needs to judge). */
export const REQUIRED = {
  'Okafor_Essay_Final.docx': ['Toni Morrison', 'Beloved', 'The Weight of Small Things', 'Lagos', 'Writing became a way to translate myself.', 'My teachers at Parkland'],
  'Martinez-Ruiz WRT201.docx': ['Gloria Anzaldúa', 'Borderlands', 'The Language of Two Kitchens'],
  'young_reading_the_river.pdf': ['Reading the River', 'Huckleberry Finn', 'Mark Twain', 'When I was young', 'Works Cited', 'Row, 1964'],
};

// ---------------------------------------------------------------- docx 1 (hand-built XML)

function run(text, props = '') {
  return `<w:r w:rsidR="00B2C3D4">${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}
function para(inner, ppr = '') {
  return `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3">${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
}

export async function okaforDocx() {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    HEAD +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  z.file(
    '_rels/.rels',
    HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>
</Relationships>`,
  );
  z.file(
    'docProps/core.xml',
    HEAD +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Okafor essay final</dc:title><dc:creator>Amara Okafor</dc:creator><cp:lastModifiedBy>aokafor</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2025-10-10T14:00:00Z</dcterms:created></cp:coreProperties>`,
  );
  z.file(
    'docProps/app.xml',
    HEAD +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Normal.dotm</Template><Application>Microsoft Office Word</Application><Company>Okafor Family</Company></Properties>`,
  );
  z.file('docProps/thumbnail.jpeg', 'FAKE-JPEG-THUMBNAIL showing Amara Okafor on page 1');
  z.file('customXml/item1.xml', HEAD + '<CoverPageProperties><Author>Amara Okafor</Author></CoverPageProperties>');
  z.file(
    'customXml/itemProps1.xml',
    HEAD + '<ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>',
  );
  z.file(
    'customXml/_rels/item1.xml.rels',
    HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`,
  );
  z.file(
    'word/_rels/document.xml.rels',
    HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
<Relationship Id="rIdSet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdCx" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>
<Relationship Id="rIdMail" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:amara.okafor@example.edu" TargetMode="External"/>
</Relationships>`,
  );
  z.file(
    'word/settings.xml',
    HEAD +
      `<w:settings xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:attachedTemplate r:id="rIdTmpl"/><w:trackRevisions/><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00B2C3D4"/></w:rsids></w:settings>`,
  );
  z.file(
    'word/_rels/settings.xml.rels',
    HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTmpl" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/Users/aokafor/AppData/Roaming/Microsoft/Templates/Normal.dotm" TargetMode="External"/></Relationships>`,
  );
  z.file(
    'word/comments.xml',
    HEAD + `<w:comments xmlns:w="${NS_W}"><w:comment w:id="0" w:author="Daniel Reyes" w:initials="DR"><w:p><w:r><w:t>Lovely line, Amara.</w:t></w:r></w:p></w:comment></w:comments>`,
  );
  z.file(
    'word/footnotes.xml',
    HEAD +
      `<w:footnotes xmlns:w="${NS_W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p>${run(
        'Thanks to my roommate Priya Shah for reading every draft.',
      )}</w:p></w:footnote></w:footnotes>`,
  );
  z.file(
    'word/header1.xml',
    HEAD +
      `<w:hdr xmlns:w="${NS_W}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('Okafor ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`,
  );
  const body = [
    para(run('Amara Okafor')),
    para(run('Professor Daniel Reyes')),
    para(run('ENG 101-03')),
    para(run('12 October 2025')),
    para(run('The Weight of Small Things'), '<w:jc w:val="center"/>'),
    para(
      run('When my grandmother first read ') +
        run('Beloved', '<w:i/>') +
        run(' by Toni Morrison, she told me that every family keeps a ledger of small debts. The Oka') +
        run('for', '<w:b/>') +
        run(' household was no different, and nobody calls me Amara unless they are angry.'),
      '<w:ind w:firstLine="720"/>',
    ),
    para(
      run('I moved from Lagos to Allentown when I was nine. ') +
        `<w:ins w:id="1" w:author="Amara Okafor" w:date="2025-10-09T10:00:00Z">${run('My teachers at Parkland High School were patient. ')}</w:ins>` +
        `<w:del w:id="2" w:author="Amara Okafor" w:date="2025-10-09T10:00:00Z"><w:r><w:delText>Signed, Amara Okafor.</w:delText></w:r></w:del>` +
        '<w:commentRangeStart w:id="0"/>' +
        run('Writing became a way to translate myself.') +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
      '<w:ind w:firstLine="720"/>',
    ),
    para(
      run('Questions? Email me at ') +
        `<w:hyperlink r:id="rIdMail">${run('amara.okafor@example.edu', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>` +
        run(' or call (610) 555-0142. My student ID is 20231234.') +
        '<w:r><w:footnoteReference w:id="1"/></w:r>',
    ),
    para(run('In 1963, Dr. Martin Luther King Jr. wrote from a jail cell; I write from a dorm room at Muhlenberg College, where A. Okafor is just another name on a mailbox.')),
  ].join('');
  z.file(
    'word/document.xml',
    HEAD +
      `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/></w:sectPr></w:body></w:document>`,
  );
  return z.generateAsync({ type: 'uint8array' });
}

// ---------------------------------------------------------------- docx 2 (docx library, like Word/Docs output)

export async function martinezDocx() {
  const doc = new Document({
    creator: 'José Martínez-Ruiz',
    lastModifiedBy: 'José Martínez-Ruiz',
    title: 'WRT 201 essay',
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Martínez-Ruiz '), new TextRun({ children: [PageNumber.CURRENT] })] })],
          }),
        },
        children: [
          new Paragraph({
            children: [
              new TextRun('José Martínez-Ruiz'),
              new TextRun({ text: 'Dr. Helen Park', break: 1 }),
              new TextRun({ text: 'WRT 201: Argument and Inquiry', break: 1 }),
              new TextRun({ text: 'March 3, 2026', break: 1 }),
            ],
          }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('The Language of Two Kitchens')] }),
          new Paragraph({
            indent: { firstLine: 720 },
            children: [
              new TextRun('At home my abuela called me Pepito, and in class I was Jose Martinez, the accent left somewhere between the registrar and the roll sheet. '),
              new TextRun('Reading '),
              new TextRun({ text: 'Borderlands/La Frontera', italics: true }),
              new TextRun(' by Gloria Anzaldúa, I finally found words for that gap. The Ruiz side of my family cooked in Spanish; the Martínez side argued in English.'),
            ],
          }),
          new Paragraph({
            indent: { firstLine: 720 },
            children: [new TextRun('Professor Park said in our first conference that an argument is a kitchen with two doors. Dr. Park was right.')],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

// ---------------------------------------------------------------- PDF with running header

export async function youngPdf() {
  const pdf = await PDFDocument.create();
  pdf.setAuthor('Grace Young');
  pdf.setCreator('Microsoft Word');
  pdf.setTitle('Reading the River');
  const roman = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const size = 12;
  const left = 72;
  const right = 540;
  const lh = 24;

  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage([612, 792]);
    pages.push(page);
    const hdr = `Young ${pages.length}`;
    page.drawText(hdr, { x: right - roman.widthOfTextAtSize(hdr, size), y: 744, size, font: roman, color: rgb(0, 0, 0) });
    y = 708;
  };
  newPage();
  const line = (text, opts = {}) => {
    if (y < 72) newPage();
    const font = opts.italic ? italic : roman;
    const w = font.widthOfTextAtSize(text, size);
    const x = opts.center ? (612 - w) / 2 : left;
    page.drawText(text, { x, y, size, font });
    y -= lh;
  };
  // rich paragraph: [[text, italic?], ...] wrapped to the text block
  const paragraph = (segments) => {
    const words = [];
    for (const [t, it] of segments) for (const w of t.split(/(?<=\s)/)) if (w) words.push([w, !!it]);
    let x = left + 36;
    if (y < 72) newPage();
    for (const [w, it] of words) {
      const font = it ? italic : roman;
      const ww = font.widthOfTextAtSize(w.trimEnd(), size);
      if (x + ww > right) {
        y -= lh;
        if (y < 72) newPage();
        x = left;
      }
      page.drawText(w, { x, y, size, font });
      x += font.widthOfTextAtSize(w, size);
    }
    y -= lh;
  };
  line('Grace Young');
  line('Professor Alan Whitfield');
  line('FYS 150-02');
  line('5 November 2025');
  line('Reading the River', { center: true });
  paragraph([
    ['When I was young, my father read me '],
    ['Adventures of Huckleberry Finn', true],
    [' by Mark Twain every night on the porch of our house outside Scranton. He did the voices badly, and I loved him for it. The Young family has never been good at saying things directly, so we said them through other people\'s books, passing sentences back and forth like dishes at a crowded table.'],
  ]);
  paragraph([
    ['Years later, a teacher wrote "Grace, slow down" in the margin of my first real essay. I did not slow down. Instead I learned to read the river the way Twain\'s pilots did: every ripple a sentence, every snag a comma I had skipped. Dr. Martin Luther King Jr. once wrote that the arc of the moral universe is long, and I think the arc of a paragraph is long too, and bends toward whoever keeps revising it.'],
  ]);
  paragraph([
    ['Anyone who wants the full reading list can write to gyoung@example.edu. The river keeps going; so does the list. My roommate keeps asking why an essay about a book needs so many pages, and I keep answering that the book needed a whole river, so the essay can have a few more paragraphs than she thinks is reasonable for a first-year seminar.'],
  ]);
  paragraph([
    ['What Huck learns on the raft is not a lesson so much as a habit: to look at a person long enough that the rules about them stop making sense. That is what my father was doing on the porch, and what I am still trying to do every time I sit down to write.'],
  ]);
  paragraph([
    ['There is a version of this essay that ends neatly, with the river reaching the sea and the girl on the porch growing up into a writer. I do not trust that version. Rivers do not end; they widen, they flood, they split around islands and rejoin. My reading has been like that too, a main channel of assigned books and a hundred side streams of things I found on my own, and I suspect the side streams taught me more about how sentences move than any syllabus did.'],
  ]);
  paragraph([
    ['So I will end where I began, on the porch, with a book open and someone doing the voices badly. If I am lucky, that is where I will be at the end, too.'],
  ]);
  y -= lh;
  line('Works Cited', { center: true });
  const hanging = (first, rest) => {
    if (y < 72) newPage();
    page.drawText(first, { x: left, y, size, font: roman });
    y -= lh;
    page.drawText(rest, { x: left + 36, y, size, font: roman });
    y -= lh;
  };
  hanging('King, Martin Luther, Jr. "Letter from Birmingham Jail." Why We Can\'t Wait, Harper &', 'Row, 1964, pp. 77-100.');
  hanging('Twain, Mark. Adventures of Huckleberry Finn. 1884. Penguin Classics, 2002, pp. 1-45,', 'with an introduction by the editors.');
  return pdf.save();
}

export async function scannedPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 60, y: 60, width: 492, height: 672, color: rgb(0.93, 0.93, 0.9) });
  for (let i = 0; i < 25; i++) page.drawLine({ start: { x: 80, y: 700 - i * 24 }, end: { x: 520, y: 700 - i * 24 }, thickness: 3, color: rgb(0.3, 0.3, 0.3) });
  pdf.setAuthor('Tom Nguyen');
  return pdf.save();
}

export async function allFixtures() {
  return {
    'Okafor_Essay_Final.docx': await okaforDocx(),
    'Martinez-Ruiz WRT201.docx': await martinezDocx(),
    'young_reading_the_river.pdf': await youngPdf(),
    'nguyen_scan.pdf': await scannedPdf(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'files');
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(await allFixtures())) writeFileSync(join(dir, name), bytes);
  writeFileSync(join(dir, 'roster.csv'), ROSTER_CSV);
  console.log(`Wrote fixtures to ${dir}`);
}
