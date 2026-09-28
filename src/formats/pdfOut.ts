import { AlignmentType, Document, Header, Packer, PageNumber, Paragraph, TextRun } from 'docx';
import type { Edit } from '../core/replace';
import type { PdfModel, PdfPara, Run } from './pdf';

/** Apply text edits to a list of styled runs; the replacement takes the style of the run it starts in. */
export function applyEditsToRuns(runs: Run[], edits: Edit[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  const bounds = () => {
    let pos = 0;
    return out.map((r) => {
      const b = { start: pos, end: pos + r.text.length };
      pos = b.end;
      return b;
    });
  };
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    const bs = bounds();
    let placed = false;
    out.forEach((r, i) => {
      const b = bs[i];
      if (!(b.start < e.end && b.end > e.start) && !(e.start === e.end && b.start === e.start)) return;
      const ls = Math.max(e.start, b.start) - b.start;
      const le = Math.min(e.end, b.end) - b.start;
      r.text = r.text.slice(0, ls) + (placed ? '' : e.text) + r.text.slice(le);
      placed = true;
    });
  }
  return out.filter((r) => r.text.length);
}

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

/** Build a clean .docx from the redacted PDF paragraphs. Page headers are replaced by "CODE <page>". */
export async function pdfToDocx(m: PdfModel, edits: Map<string, Edit[]>, code: string): Promise<Uint8Array> {
  const body = m.paras.filter((p: PdfPara) => p.block.kind === 'body');
  const children = body.map((p) => {
    const runs = applyEditsToRuns(p.runs, edits.get(p.block.id) ?? []);
    return new Paragraph({
      alignment: ALIGN[p.align],
      indent: p.indent ? { firstLine: 720 } : undefined,
      spacing: { after: 160, line: 360 },
      children: runs.map((r) => new TextRun({ text: r.text, italics: !!r.italic, bold: !!r.bold })),
    });
  });
  const doc = new Document({
    creator: ' ',
    lastModifiedBy: ' ',
    title: ' ',
    description: ' ',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`${code} `), new TextRun({ children: [PageNumber.CURRENT] })] })],
          }),
        },
        children,
      },
    ],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buf);
}
