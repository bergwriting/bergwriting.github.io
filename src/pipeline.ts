import type { ParsedEssay, RemoveKey, RosterEntry, Span } from './core/types';
import { buildEdits } from './core/replace';
import { leakTerms } from './core/scrub';
import { FormatError, docxBlocks, loadDocx, writeDocx } from './formats/docx';
import { loadPdf } from './formats/pdf';
import { pdfToDocx } from './formats/pdfOut';
import { verifyDocx, type LeakHit } from './verify';

export async function parseEssay(fileName: string, bytes: Uint8Array): Promise<ParsedEssay> {
  const base: ParsedEssay = { fileName, format: 'docx', blocks: [], metaNames: [], warnings: [], bytes };
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  try {
    if (ext === 'docx') {
      const m = await loadDocx(bytes);
      return { ...base, blocks: docxBlocks(m), metaNames: m.metaNames, warnings: m.warnings };
    }
    if (ext === 'pdf') {
      const m = await loadPdf(bytes);
      return { ...base, format: 'pdf', blocks: m.paras.map((p) => p.block), metaNames: m.metaNames, warnings: m.warnings };
    }
    if (ext === 'doc') return { ...base, fatal: 'Old Word format (.doc). Open it in Word and use File › Save As › .docx, then add it again.' };
    if (ext === 'pages') return { ...base, fatal: 'Apple Pages file. Use File › Export To › Word (.docx) in Pages, then add it again.' };
    if (ext === 'odt' || ext === 'rtf') return { ...base, fatal: `.${ext} files are not supported. Save as .docx and add it again.` };
    return { ...base, fatal: 'Unsupported file type. Use .docx or .pdf (for Google Docs: File › Download › Microsoft Word).' };
  } catch (e) {
    const msg = e instanceof FormatError ? e.message : `Could not read this file (${(e as Error)?.message ?? e}).`;
    return { ...base, format: ext === 'pdf' ? 'pdf' : 'docx', fatal: msg };
  }
}

export interface ExportResult {
  bytes: Uint8Array;
  hits: LeakHit[];
}

/** Produce the anonymized .docx for one essay and check it for leftovers. */
export async function exportEssay(
  essay: ParsedEssay,
  spans: Span[],
  code: string,
  student: RosterEntry | undefined,
  remove?: Record<RemoveKey, boolean>,
): Promise<ExportResult> {
  if (essay.fatal) throw new Error(essay.fatal);
  const edits = buildEdits(essay.blocks, spans, code);
  const terms = leakTerms(student, essay.blocks, spans, remove);
  let bytes: Uint8Array;
  if (essay.format === 'docx') {
    const m = await loadDocx(essay.bytes);
    const now = docxBlocks(m);
    if (now.length !== essay.blocks.length || now.some((b, i) => b.text !== essay.blocks[i].text)) {
      throw new Error('Internal error: document changed between review and export.');
    }
    bytes = await writeDocx(m, edits, terms);
  } else {
    const m = await loadPdf(essay.bytes);
    const rebuilt = await pdfToDocx(m, edits, code);
    // run the rebuilt file through the same metadata scrubber
    bytes = await writeDocx(await loadDocx(rebuilt), new Map(), terms);
  }
  const kept = new Set(
    spans
      .filter((s) => s.action === 'flag' && s.userSet)
      .map((s) => essay.blocks.find((b) => b.id === s.blockId)?.text.slice(s.start, s.end) ?? '')
      .filter(Boolean),
  );
  const hits = await verifyDocx(bytes, terms, kept);
  return { bytes, hits };
}
