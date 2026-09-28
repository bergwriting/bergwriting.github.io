/**
 * PDF reading. PDFs cannot be safely redacted in place in a browser, so the text is
 * extracted with pdf.js, rebuilt into lines and paragraphs (keeping italics/bold where
 * the font names show them), and later written out as a fresh, clean .docx.
 *
 * No OCR: a PDF with no text layer (a scan) is rejected, because OCR engines are
 * machine-learning models.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { Block, BlockKind } from '../core/types';
import { FormatError } from './docx';

// Run pdf.js in the main thread (its "fake worker"): no separate worker file is
// needed, which keeps the whole app a single offline HTML file.
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

export interface Run {
  text: string;
  italic?: boolean;
  bold?: boolean;
}

export interface PdfPara {
  block: Block;
  runs: Run[];
  align: 'left' | 'center' | 'right';
  indent: boolean;
}

export interface PdfModel {
  paras: PdfPara[];
  metaNames: string[];
  warnings: string[];
  pageCount: number;
}

interface Line {
  page: number;
  x0: number;
  x1: number;
  y: number;
  size: number;
  pageWidth: number;
  pageHeight: number;
  runs: Run[];
  text: string;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

function fontStyle(name: string): { italic: boolean; bold: boolean } {
  return {
    italic: /italic|oblique|[-,]it\b|[-,]ital/i.test(name),
    bold: /bold|black|heavy|semibold|demi|[-,]bd\b/i.test(name),
  };
}

function pushRun(runs: Run[], text: string, st: { italic: boolean; bold: boolean }) {
  const last = runs[runs.length - 1];
  if (last && !!last.italic === st.italic && !!last.bold === st.bold) last.text += text;
  else runs.push({ text, italic: st.italic || undefined, bold: st.bold || undefined });
}

async function pageLines(page: pdfjs.PDFPageProxy, pageNo: number): Promise<Line[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = (tc.items as TextItemLike[]).filter((i) => typeof i.str === 'string');

  // Resolve real font names (e.g. "TimesNewRomanPS-ItalicMT") for italics/bold.
  const fontNames = new Map<string, string>();
  try {
    await page.getOperatorList();
    for (const it of items) {
      if (fontNames.has(it.fontName)) continue;
      let n = '';
      try {
        if (page.commonObjs.has(it.fontName)) n = (page.commonObjs.get(it.fontName) as { name?: string })?.name ?? '';
      } catch {
        /* font not loaded */
      }
      fontNames.set(it.fontName, n || (tc.styles[it.fontName]?.fontFamily ?? ''));
    }
  } catch {
    /* styling is optional */
  }

  const rows: { y: number; size: number; items: TextItemLike[] }[] = [];
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(r.size, size) * 0.45);
    if (!row) {
      row = { y, size, items: [] };
      rows.push(row);
    }
    row.items.push(it);
    row.size = Math.max(row.size, size);
  }
  rows.sort((a, b) => b.y - a.y);

  const lines: Line[] = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const runs: Run[] = [];
    let text = '';
    let prevEnd: number | null = null;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const it of r.items) {
      if (!it.str) continue;
      const x = it.transform[4];
      const st = fontStyle(fontNames.get(it.fontName) ?? '');
      if (prevEnd !== null && x - prevEnd > r.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) {
        pushRun(runs, ' ', st);
        text += ' ';
      }
      pushRun(runs, it.str, st);
      text += it.str;
      prevEnd = x + it.width;
      if (it.str.trim()) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + it.width);
      }
    }
    if (!text.trim()) continue;
    // trim whitespace at line ends (keeping runs aligned)
    while (runs.length && !runs[0].text.trimStart()) runs.shift();
    if (runs.length) runs[0].text = runs[0].text.trimStart();
    while (runs.length && !runs[runs.length - 1].text.trimEnd()) runs.pop();
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
    lines.push({
      page: pageNo,
      x0,
      x1,
      y: r.y,
      size: r.size,
      pageWidth: vp.width,
      pageHeight: vp.height,
      runs,
      text: runs.map((x) => x.text).join(''),
    });
  }
  return lines;
}

const RUNNING = /^\s*\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?\s+\d{1,3}\s*$/u;
const PAGE_NO = /^\s*(?:page\s*)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*$/i;

/** Mark lines in the top/bottom margins that repeat across pages (running headers, page numbers). */
function marginKinds(lines: Line[], pageCount: number): Map<Line, BlockKind> {
  const zone = (l: Line): 'header' | 'footer' | null => {
    if (l.y > l.pageHeight * 0.915) return 'header';
    if (l.y < l.pageHeight * 0.085) return 'footer';
    return null;
  };
  const key = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const counts = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!zone(l)) continue;
    const k = key(l);
    if (!counts.has(k)) counts.set(k, new Set());
    counts.get(k)!.add(l.page);
  }
  const out = new Map<Line, BlockKind>();
  for (const l of lines) {
    const z = zone(l);
    if (!z) continue;
    const repeated = pageCount >= 2 && (counts.get(key(l))?.size ?? 0) >= 2;
    if (repeated || PAGE_NO.test(l.text) || (z === 'header' && RUNNING.test(l.text))) out.set(l, z);
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mode(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(Math.round(x), (c.get(Math.round(x)) ?? 0) + 1);
  let best = 0;
  let n = -1;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
}

function buildParas(lines: Line[], kinds: Map<Line, BlockKind>): PdfPara[] {
  const body = lines.filter((l) => !kinds.has(l));
  const left = mode(body.map((l) => l.x0));
  const rights = body.map((l) => l.x1).sort((a, b) => a - b);
  const right = rights[Math.floor(rights.length * 0.95)] ?? 0;
  const width = Math.max(right - left, 1);
  const gaps: number[] = [];
  for (let i = 1; i < body.length; i++) if (body[i].page === body[i - 1].page) gaps.push(body[i - 1].y - body[i].y);
  const lineGap = median(gaps.filter((g) => g > 0)) || 14;

  const isCentered = (l: Line) => {
    const mid = (l.x0 + l.x1) / 2;
    return l.x0 > left + 18 && Math.abs(mid - (left + right) / 2) < width * 0.04 && l.x1 - l.x0 < width * 0.8;
  };
  const isRight = (l: Line) => l.x1 > right - 8 && l.x0 > left + width * 0.45;

  const paras: PdfPara[] = [];
  let cur: { lines: Line[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    const runs: Run[] = [];
    let text = '';
    ls.forEach((l, i) => {
      if (i > 0) {
        const prevText = text;
        if (/\p{L}-$/u.test(prevText) && /^\p{Ll}/u.test(l.text)) {
          // de-hyphenate a word broken across lines
          const last = runs[runs.length - 1];
          last.text = last.text.slice(0, -1);
          text = text.slice(0, -1);
        } else {
          runs[runs.length - 1].text += ' ';
          text += ' ';
        }
      }
      for (const r of l.runs) {
        pushRun(runs, r.text, { italic: !!r.italic, bold: !!r.bold });
        text += r.text;
      }
    });
    const first = ls[0];
    paras.push({
      block: { id: `pdf#${paras.length}`, kind: 'body', text },
      runs,
      align: isCentered(first) ? 'center' : isRight(first) ? 'right' : 'left',
      indent: first.x0 > left + 12 && !isCentered(first) && !isRight(first),
    });
    cur = null;
  };

  body.forEach((l, i) => {
    const prev = body[i - 1];
    let brk = !prev || !cur;
    if (prev && cur) {
      const samePage = prev.page === l.page;
      if (samePage && prev.y - l.y > lineGap * 1.55) brk = true;
      // previous line ended short: the first word of this line would have fitted on it
      const firstWord = l.text.split(/\s/)[0] ?? '';
      const firstWordWidth = ((l.x1 - l.x0) * (firstWord.length + 1)) / Math.max(l.text.length, 1);
      const hangingIndent = l.x0 > prev.x0 + 12 && !/[.!?"”]$/.test(prev.text);
      if (prev.x1 + firstWordWidth < right - 2 && !hangingIndent) brk = true;
      if (isCentered(l) || isCentered(prev) || isRight(l) || isRight(prev)) brk = true;
      if (Math.abs(l.size - prev.size) > 1.5) brk = true;
      // first-line indent after a finished sentence (not a hanging indent, where the next line is indented too)
      const next = body[i + 1];
      const indented = (x: Line) => x.x0 > left + 12;
      if (indented(l) && !indented(prev) && /[.!?"”')\]]$/.test(prev.text) && (!next || !indented(next) || Math.abs(next.x0 - l.x0) > 4)) brk = true;
    }
    if (brk) {
      flush();
      cur = { lines: [] };
    }
    cur!.lines.push(l);
  });
  flush();
  return paras;
}

export async function loadPdf(bytes: Uint8Array): Promise<PdfModel> {
  let doc: pdfjs.PDFDocumentProxy;
  let task: pdfjs.PDFDocumentLoadingTask;
  try {
    task = pdfjs.getDocument({
      data: bytes.slice(),
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: false,
      verbosity: 0,
    });
    doc = await task.promise;
  } catch (e) {
    if ((e as Error)?.name === 'PasswordException') throw new FormatError('This PDF is password-protected. Ask for an unprotected copy or a .docx.');
    throw new FormatError('This file is not a readable PDF.');
  }

  const metaNames: string[] = [];
  try {
    const meta = (await doc.getMetadata()) as unknown as { info?: Record<string, unknown>; metadata?: { get(k: string): unknown } | null };
    const author = meta.info?.Author;
    if (typeof author === 'string' && author.trim()) metaNames.push(author.trim());
    const dc = meta.metadata?.get('dc:creator');
    if (Array.isArray(dc)) {
      for (const d of dc) if (typeof d === 'string' && d.trim()) metaNames.push(d.trim());
    } else if (typeof dc === 'string' && dc.trim()) {
      metaNames.push(dc.trim());
    }
  } catch {
    /* no metadata */
  }

  const warnings: string[] = [];
  const lines: Line[] = [];
  const emptyPages: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const ls = await pageLines(page, p);
    if (ls.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0) < 20) emptyPages.push(p);
    lines.push(...ls);
    page.cleanup();
  }
  const pageCount = doc.numPages;
  await task.destroy();

  const totalChars = lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0);
  if (totalChars < 40 || emptyPages.length === pageCount) {
    throw new FormatError('This PDF has no selectable text (it looks like a scan or photo). It cannot be anonymized without OCR — please ask for a .docx or a text-based PDF.');
  }
  if (emptyPages.length) warnings.push(`Page(s) ${emptyPages.join(', ')} have little or no selectable text (images or scans?): check the original.`);
  warnings.push('PDF rebuilt as a clean .docx (layout simplified).');

  const kinds = marginKinds(lines, pageCount);
  const paras = buildParas(lines, kinds);
  // Margin lines become header/footer blocks: shown in review, replaced by the essay code in the output.
  let hi = 0;
  for (const [l, k] of kinds) {
    paras.push({ block: { id: `pdf-${k}#${hi++}`, kind: k, text: l.text }, runs: l.runs, align: 'left', indent: false });
  }
  return { paras, metaNames, warnings, pageCount };
}
