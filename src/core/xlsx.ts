/** Minimal reader for the first sheet of an .xlsx roster (no dependencies beyond JSZip). */
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { RosterTable } from './roster';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XNode = any;

const parse = (s: string): XNode => new DOMParser().parseFromString(s, 'text/xml');
const tags = (d: XNode, name: string): XNode[] => Array.from(d.getElementsByTagName('*') as ArrayLike<XNode>).filter((e) => e.localName === name);

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(bytes: Uint8Array): Promise<RosterTable> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = parse(await zip.file('xl/workbook.xml')!.async('string'));
  const firstSheet = tags(wb, 'sheet')[0];
  const rid = firstSheet?.getAttribute('r:id');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (rid && relsXml) {
    const rel = tags(parse(relsXml), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const t = rel?.getAttribute('Target');
    if (t) sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
  }
  const shared: string[] = [];
  const ssXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (ssXml) for (const si of tags(parse(ssXml), 'si')) shared.push(tags(si, 't').map((t) => t.textContent ?? '').join(''));

  const sheet = parse(await zip.file(sheetPath)!.async('string'));
  const rows: string[][] = [];
  for (const row of tags(sheet, 'row')) {
    const cells: string[] = [];
    for (const c of tags(row, 'c')) {
      const idx = colIndex(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      let v = '';
      if (type === 's') v = shared[Number(tags(c, 'v')[0]?.textContent ?? -1)] ?? '';
      else if (type === 'inlineStr') v = tags(c, 't').map((t) => t.textContent ?? '').join('');
      else v = tags(c, 'v')[0]?.textContent ?? '';
      cells[idx >= 0 ? idx : cells.length] = v.trim();
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  return { headers: nonEmpty[0], rows: nonEmpty.slice(1) };
}
