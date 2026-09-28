/**
 * Word (.docx) reading and in-place redaction.
 *
 * Reading builds one Block per <w:p> paragraph (body, headers, footers, footnotes,
 * text boxes) by flattening the text of all its runs, remembering which XML node each
 * character came from. Redaction edits those nodes so formatting is preserved, then
 * removes every known place identity leaks: document properties, thumbnail, comments,
 * tracked changes and their authors, revision IDs, template paths, custom XML,
 * image metadata and alt text.
 */
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Block, BlockKind } from '../core/types';
import type { Edit } from '../core/replace';
import { stripImage } from './images';
import { scrubString, type ScrubTerm } from '../core/scrub';

/* xmldom node types are structurally compatible with the DOM, but typed separately. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XNode = any;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export class FormatError extends Error {}

const CONTENT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const PART_ORDER = ['document', 'header', 'footer', 'footnotes', 'endnotes'];

const REMOVE_PARTS = [
  /^docProps\/custom\.xml$/,
  /^docProps\/thumbnail\.[a-z]+$/i,
  /^word\/comments[A-Za-z]*\.xml$/,
  /^word\/people\.xml$/,
  /^customXml\//,
];

const TRACK_REMOVE = [
  'del',
  'moveFrom',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tblGridChange',
  'trPrChange',
  'tcPrChange',
  'numberingChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'proofErr',
  'dataBinding',
];
const TRACK_UNWRAP = ['ins', 'moveTo', 'customXml', 'smartTag'];
const IDENTITY_FIELD = /\b(?:AUTHOR|USERNAME|USERINITIALS|USERADDRESS|LASTSAVEDBY|DOCPROPERTY|FILENAME|TEMPLATE)\b|mailto:/i;

interface Seg {
  el: XNode;
  kind: 'text' | 'char';
  start: number;
  end: number;
}

interface Para {
  block: Block;
  el: XNode;
  segs: Seg[];
}

export interface DocxModel {
  zip: JSZip;
  docs: Map<string, XNode>;
  paras: Para[];
  metaNames: string[];
  warnings: string[];
}

const parser = () =>
  new DOMParser({
    onError: (level: string, msg: string) => {
      if (level === 'fatalError') throw new FormatError(`Could not read the Word file (${msg}).`);
    },
  });

function parseXml(xml: string): XNode {
  return parser().parseFromString(xml, 'text/xml');
}

function serialize(doc: XNode): string {
  let s = new XMLSerializer().serializeToString(doc);
  if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
  return s;
}

function els(root: XNode, local: string, ns = W): XNode[] {
  return Array.from(root.getElementsByTagNameNS(ns, local) as ArrayLike<XNode>);
}

function allElements(root: XNode): XNode[] {
  return Array.from(root.getElementsByTagName('*') as ArrayLike<XNode>);
}

function remove(n: XNode) {
  n.parentNode?.removeChild(n);
}

function unwrap(n: XNode) {
  const parent = n.parentNode;
  if (!parent) return;
  while (n.firstChild) parent.insertBefore(n.firstChild, n);
  parent.removeChild(n);
}

function getText(el: XNode): string {
  return el.textContent ?? '';
}

function setText(el: XNode, s: string) {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(el.ownerDocument.createTextNode(s));
  if (/^\s|\s$/.test(s) || s.includes('  ')) el.setAttributeNS(XML_NS, 'xml:space', 'preserve');
}

function partKind(path: string): BlockKind {
  if (/header/.test(path)) return 'header';
  if (/footer/.test(path)) return 'footer';
  if (/footnotes|endnotes/.test(path)) return 'note';
  return 'body';
}

function hasAncestor(n: XNode, local: string): boolean {
  for (let p = n.parentNode; p; p = p.parentNode) if (p.localName === local && p.namespaceURI === W) return true;
  return false;
}

/** Accept tracked changes, drop comment anchors, revision IDs and identity fields. */
function preprocess(doc: XNode) {
  // Keep only the modern rendering of text boxes / shapes so text isn't duplicated.
  for (const fb of els(doc, 'Fallback', MC)) {
    if (fb.parentNode && els(fb.parentNode, 'Choice', MC).length) remove(fb);
  }
  for (const name of TRACK_REMOVE) for (const e of els(doc, name)) remove(e);
  for (const name of TRACK_UNWRAP) for (const e of els(doc, name)) unwrap(e);
  for (const ref of els(doc, 'commentReference')) {
    const run = ref.parentNode;
    remove(ref);
    if (run && run.localName === 'r' && !els(run, 't').length && !els(run, 'tab').length) remove(run);
  }
  for (const e of allElements(doc)) {
    const attrs = Array.from(e.attributes as ArrayLike<XNode>);
    for (const a of attrs) if (/^rsid/.test(a.localName ?? a.name)) e.removeAttributeNode(a);
  }
  for (const it of els(doc, 'instrText')) if (IDENTITY_FIELD.test(getText(it))) setText(it, '');
  for (const f of els(doc, 'fldSimple')) if (IDENTITY_FIELD.test(f.getAttributeNS(W, 'instr') ?? '')) unwrap(f);
  for (const d of [...els(doc, 'docPr', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'), ...els(doc, 'cNvPr', 'http://schemas.openxmlformats.org/drawingml/2006/picture')]) {
    if (d.hasAttribute('descr')) d.setAttribute('descr', '');
    if (d.hasAttribute('title')) d.setAttribute('title', '');
  }
}

function buildParas(doc: XNode, path: string): Para[] {
  const out: Para[] = [];
  const kind = partKind(path);
  let idx = 0;
  for (const p of els(doc, 'p')) {
    const segs: Seg[] = [];
    let text = '';
    const add = (el: XNode, s: string, k: Seg['kind']) => {
      segs.push({ el, kind: k, start: text.length, end: text.length + s.length });
      text += s;
    };
    const walk = (n: XNode) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W) {
          const ln = c.localName;
          if (ln === 'p') continue; // nested paragraph (text box) handled on its own
          if (ln === 't') {
            add(c, getText(c), 'text');
            continue;
          }
          if (ln === 'tab' || ln === 'ptab') {
            if (c.parentNode?.localName === 'r') add(c, '\t', 'char');
            continue;
          }
          if (ln === 'br' || ln === 'cr') {
            add(c, '\n', 'char');
            continue;
          }
          if (ln === 'noBreakHyphen') {
            add(c, '-', 'char');
            continue;
          }
          if (ln === 'instrText' || ln === 'delText' || ln === 'rPr' || ln === 'pPr') continue;
        }
        walk(c);
      }
    };
    walk(p);
    let k: BlockKind = kind;
    if (kind === 'body' && hasAncestor(p, 'txbxContent')) k = 'textbox';
    out.push({ block: { id: `${path}#${idx++}`, kind: k, text }, el: p, segs });
  }
  return out;
}

async function collectMeta(zip: JSZip, docs: Map<string, XNode>): Promise<string[]> {
  const names = new Set<string>();
  const addText = (s: string | null | undefined) => {
    const t = (s ?? '').trim();
    if (t) names.add(t);
  };
  const core = await zip.file('docProps/core.xml')?.async('string');
  if (core) {
    const d = parseXml(core);
    for (const e of allElements(d)) if (['creator', 'lastModifiedBy'].includes(e.localName)) addText(getText(e));
  }
  const app = await zip.file('docProps/app.xml')?.async('string');
  if (app) {
    const d = parseXml(app);
    for (const e of allElements(d)) if (['Manager', 'Company'].includes(e.localName)) addText(getText(e));
  }
  for (const path of Object.keys(zip.files)) {
    if (!/^word\/(comments[A-Za-z]*|people)\.xml$/.test(path)) continue;
    const d = parseXml(await zip.file(path)!.async('string'));
    for (const e of allElements(d)) {
      addText(e.getAttributeNS(W, 'author'));
      const a = e.getAttribute('w15:author');
      if (a) addText(a);
    }
  }
  for (const d of docs.values()) for (const e of allElements(d)) addText(e.getAttributeNS(W, 'author'));
  return [...names];
}

export async function loadDocx(bytes: Uint8Array): Promise<DocxModel> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new FormatError('This is not a readable .docx file. It may be password-protected or an old-style .doc file — open it in Word or Google Docs and save/download it as .docx.');
  }
  if (!zip.file('word/document.xml')) throw new FormatError('This file does not look like a Word document (word/document.xml is missing).');

  const warnings: string[] = [];
  const paths = Object.keys(zip.files)
    .filter((p) => CONTENT_PART.test(p))
    .sort((a, b) => {
      const ia = PART_ORDER.findIndex((k) => a.includes(k));
      const ib = PART_ORDER.findIndex((k) => b.includes(k));
      return ia - ib || a.localeCompare(b, undefined, { numeric: true });
    });
  const raw = new Map<string, XNode>();
  for (const p of paths) raw.set(p, parseXml(await zip.file(p)!.async('string')));

  // Metadata (and revision authors) must be read before tracked changes are accepted.
  const metaNames = await collectMeta(zip, raw);
  if (Object.keys(zip.files).some((p) => /^word\/comments\.xml$/.test(p))) warnings.push('Had comments (removed).');
  if ([...raw.values()].some((d) => els(d, 'ins').length || els(d, 'del').length)) warnings.push('Had tracked changes (accepted).');
  if (Object.keys(zip.files).some((p) => /^word\/media\//.test(p))) warnings.push('Contains images: check they do not show the student (photo, name in a screenshot).');
  if (Object.keys(zip.files).some((p) => /^word\/embeddings\//.test(p))) warnings.push('Contains embedded objects (e.g. a spreadsheet) that are not checked for names.');

  const paras: Para[] = [];
  for (const [p, d] of raw) {
    preprocess(d);
    paras.push(...buildParas(d, p));
  }
  return { zip, docs: raw, paras, metaNames, warnings };
}

export function docxBlocks(m: DocxModel): Block[] {
  return m.paras.map((p) => p.block);
}

function applyEdit(para: Para, e: Edit) {
  const hit = para.segs.filter((s) => s.start < e.end && s.end > e.start);
  if (!hit.length) return;
  const firstText = hit.find((s) => s.kind === 'text');
  if (!firstText) {
    const t = hit[0].el.ownerDocument.createElementNS(W, 'w:t');
    setText(t, e.text);
    hit[0].el.parentNode.insertBefore(t, hit[0].el);
  }
  for (const s of hit) {
    if (s.kind === 'char') {
      remove(s.el);
      continue;
    }
    const t = getText(s.el);
    const ls = Math.max(e.start, s.start) - s.start;
    const le = Math.min(e.end, s.end) - s.start;
    setText(s.el, t.slice(0, ls) + (s === firstText ? e.text : '') + t.slice(le));
  }
}

function relsPathFor(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = relsPath.replace(/_rels\/[^/]*$/, '');
  const parts = (base + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

const BLANK_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>`;
const BLANK_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>`;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

/**
 * Apply redaction edits, strip metadata, and return the new .docx bytes.
 * `scrub` terms are removed from places the reviewer never sees (alt text, field
 * codes, link targets, charts, other XML parts); visible text is only changed by `edits`.
 */
export async function writeDocx(m: DocxModel, edits: Map<string, Edit[]>, scrub: ScrubTerm[]): Promise<Uint8Array> {
  const { zip } = m;

  for (const para of m.paras) {
    const list = edits.get(para.block.id);
    if (!list) continue;
    for (const e of [...list].sort((a, b) => b.start - a.start)) applyEdit(para, e);
  }

  // Remove identity-carrying parts.
  for (const p of Object.keys(zip.files)) if (REMOVE_PARTS.some((re) => re.test(p))) zip.remove(p);
  if (zip.file('docProps/core.xml')) zip.file('docProps/core.xml', BLANK_CORE);
  if (zip.file('docProps/app.xml')) zip.file('docProps/app.xml', BLANK_APP);

  // Settings: template path, mail-merge source, document variables, revision IDs.
  const settingsXml = await zip.file('word/settings.xml')?.async('string');
  if (settingsXml) {
    const d = parseXml(settingsXml);
    for (const n of ['attachedTemplate', 'docVars', 'mailMerge', 'trackRevisions', 'rsids', 'documentProtection', 'writeProtection']) for (const e of els(d, n)) remove(e);
    zip.file('word/settings.xml', serialize(d));
    if (zip.file('word/_rels/settings.xml.rels')) zip.remove('word/_rels/settings.xml.rels');
  }

  // Hyperlinks to email addresses or personal pages.
  for (const [part, doc] of m.docs) {
    const relsPath = relsPathFor(part);
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) continue;
    const rels = parseXml(relsXml);
    const byId = new Map<string, XNode>(allElements(rels).filter((e) => e.localName === 'Relationship').map((e) => [e.getAttribute('Id'), e]));
    for (const h of els(doc, 'hyperlink')) {
      const id = h.getAttributeNS(R, 'id');
      const rel = id && byId.get(id);
      if (!rel) continue;
      const target = rel.getAttribute('Target') ?? '';
      if (/^mailto:/i.test(target) || scrubString(decodeURIComponentSafe(target), scrub) !== decodeURIComponentSafe(target)) {
        h.removeAttributeNS(R, 'id');
        remove(rel);
      }
    }
    zip.file(relsPath, serialize(rels));
  }

  for (const [part, doc] of m.docs) zip.file(part, serialize(doc));

  // Scrub every other XML part (charts, diagrams, glossary...) and link targets.
  for (const p of Object.keys(zip.files)) {
    const f = zip.file(p);
    if (!f || m.docs.has(p) || !/\.(xml|rels)$/i.test(p) || p === '[Content_Types].xml') continue;
    const d = parseXml(await f.async('string'));
    let changed = false;
    const walk = (n: XNode) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 || c.nodeType === 4) {
          const s = scrubString(c.data, scrub);
          if (s !== c.data) {
            c.data = s;
            c.nodeValue = s;
            changed = true;
          }
        } else if (c.nodeType === 1) {
          if (c.localName === 'Relationship' && c.getAttribute('TargetMode') === 'External') {
            const t = c.getAttribute('Target') ?? '';
            const s = scrubString(decodeURIComponentSafe(t), scrub);
            if (s !== decodeURIComponentSafe(t) || /^mailto:/i.test(t) || /^file:/i.test(t)) {
              c.setAttribute('Target', 'about:blank');
              changed = true;
            }
          }
          for (const a of Array.from(c.attributes as ArrayLike<XNode>)) {
            if (!['descr', 'title', 'name'].includes(a.localName ?? a.name)) continue;
            const s = scrubString(a.value, scrub);
            if (s !== a.value) {
              c.setAttribute(a.name, s);
              changed = true;
            }
          }
          walk(c);
        }
      }
    };
    walk(d);
    if (changed) zip.file(p, serialize(d));
  }

  // Also scrub alt text / names inside the main content parts' drawing attributes.
  for (const [part, doc] of m.docs) {
    let changed = false;
    for (const e of allElements(doc)) {
      const n = e.getAttribute('name');
      if (n && (e.localName === 'docPr' || e.localName === 'cNvPr')) {
        const s = scrubString(n, scrub);
        if (s !== n) {
          e.setAttribute('name', s);
          changed = true;
        }
      }
    }
    if (changed) zip.file(part, serialize(doc));
  }

  // Image metadata.
  for (const p of Object.keys(zip.files)) {
    if (!/^word\/media\/.+\.(jpe?g|png)$/i.test(p)) continue;
    const buf = await zip.file(p)!.async('uint8array');
    zip.file(p, stripImage(p, buf));
  }

  await dropDanglingRefs(zip);

  for (const f of Object.values(zip.files)) f.date = FIXED_DATE;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: '', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Remove relationships and content-type overrides that point at deleted parts. */
async function dropDanglingRefs(zip: JSZip) {
  for (const p of Object.keys(zip.files)) {
    if (!p.endsWith('.rels')) continue;
    const owner = p.replace(/_rels\/([^/]*)\.rels$/, '$1');
    if (owner && !p.startsWith('_rels/') && !zip.file(owner)) {
      zip.remove(p);
      continue;
    }
    const d = parseXml(await zip.file(p)!.async('string'));
    let changed = false;
    for (const r of allElements(d).filter((e) => e.localName === 'Relationship')) {
      if (r.getAttribute('TargetMode') === 'External') continue;
      const target = resolveTarget(p, r.getAttribute('Target') ?? '');
      if (!zip.file(target)) {
        remove(r);
        changed = true;
      }
    }
    if (changed) zip.file(p, serialize(d));
  }
  const ct = await zip.file('[Content_Types].xml')?.async('string');
  if (ct) {
    const d = parseXml(ct);
    for (const o of allElements(d).filter((e) => e.localName === 'Override')) {
      const part = (o.getAttribute('PartName') ?? '').replace(/^\//, '');
      if (!zip.file(part)) remove(o);
    }
    zip.file('[Content_Types].xml', serialize(d));
  }
}

/** All text in every XML part of a .docx, for the post-export leak check. */
export async function docxAllText(bytes: Uint8Array): Promise<{ part: string; text: string }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: { part: string; text: string }[] = [];
  for (const p of Object.keys(zip.files)) {
    const f = zip.file(p);
    if (!f || !/\.(xml|rels)$/i.test(p)) continue;
    const d = parseXml(await f.async('string'));
    const chunks: string[] = [];
    const walk = (n: XNode) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 || c.nodeType === 4) chunks.push(c.data);
        else if (c.nodeType === 1) {
          for (const a of Array.from(c.attributes as ArrayLike<XNode>)) {
            if (/^(?:xmlns|r:id|Id|w:id|w14:|w:val|w:styleId|PartName|ContentType|Type)/.test(a.name)) continue;
            chunks.push(`\n${a.value}\n`);
          }
          // paragraph and run boundaries become spaces so words don't glue together
          if (c.localName === 'p' || c.localName === 'tab' || c.localName === 'br') chunks.push('\n');
          walk(c);
        }
      }
    };
    walk(d);
    out.push({ part: p, text: chunks.join('') });
  }
  return out;
}
