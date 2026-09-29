import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Block, Category, RosterEntry, Settings, Span } from '../core/types';
import { CATEGORY_LABEL } from '../core/types';
import { replacementFor } from '../core/replace';
import { findFolded, fold, foldString, phraseSource, uid, wordRegex } from '../core/text';
import { redetect, studentFor, type EssayItem } from './state';
import { WriterField } from './WriterField';
import { Autocomplete } from './Autocomplete';
import { namesInEssay } from '../detect/writer';
import { plural } from './util';

interface Props {
  items: EssayItem[];
  roster: RosterEntry[];
  settings: Settings;
  labels: Map<string, string>;
  selected: string | null;
  onSelect: (key: string) => void;
  updateItem: (key: string, fn: (it: EssayItem) => EssayItem) => void;
  onDone: () => void;
}

export function ReviewStep({ items, roster, settings, labels, selected, onSelect, updateItem, onDone }: Props) {
  const current = items.find((i) => i.key === selected) ?? items[0];
  if (!current) {
    return (
      <section class="step">
        <p class="muted">No essays to review yet. Add some in step 2.</p>
      </section>
    );
  }
  const next = () => {
    updateItem(current.key, (it) => ({ ...it, reviewed: true }));
    const idx = items.findIndex((i) => i.key === current.key);
    const after = [...items.slice(idx + 1), ...items.slice(0, idx)].find((i) => !i.reviewed);
    if (after) onSelect(after.key);
    else onDone();
  };
  return (
    <section class="review">
      <aside class="essay-list" aria-label="Essays">
        {items.map((it) => {
          const st = studentFor(it, roster);
          const red = it.spans.filter((s) => s.action === 'redact').length;
          const flg = it.spans.filter((s) => s.action === 'flag').length;
          return (
            <button key={it.key} class={`essay-item ${it.key === current.key ? 'active' : ''}`} onClick={() => onSelect(it.key)}>
              <span class="code">{labels.get(it.key)}</span>
              <span class="who">{st?.name ?? <i class="warn-text">writer's name missing</i>}</span>
              <span class="fname muted">{it.fileName}</span>
              <span class="stats">
                <span class="n red" title="to be removed">
                  {red}
                </span>
                <span class="n amber" title="flagged, kept">
                  {flg}
                </span>
                {it.reviewed ? <span class="done">✓ checked</span> : <span class="muted">to check</span>}
              </span>
            </button>
          );
        })}
      </aside>
      <EssayReview
        key={current.key}
        item={current}
        label={labels.get(current.key) ?? current.code}
        student={studentFor(current, roster)}
        roster={roster}
        settings={settings}
        updateItem={updateItem}
        onNext={next}
      />
    </section>
  );
}

interface Selection {
  blockId: string;
  start: number;
  end: number;
  text: string;
}

const MANUAL_CATEGORIES: Category[] = ['MANUAL', 'STUDENT', 'INSTRUCTOR', 'PERSON', 'COURSE', 'SCHOOL', 'ID'];

function EssayReview({
  item,
  label,
  student,
  roster,
  settings,
  updateItem,
  onNext,
}: {
  item: EssayItem;
  label: string;
  student?: RosterEntry;
  roster: RosterEntry[];
  settings: Settings;
  updateItem: Props['updateItem'];
  onNext: () => void;
}) {
  const essay = item.parsed!;
  const [mode, setMode] = useState<'marks' | 'result'>('marks');
  const [sel, setSel] = useState<Selection | null>(null);
  const [cat, setCat] = useState<Category>('MANUAL');
  const [everywhere, setEverywhere] = useState(true);
  const docRef = useRef<HTMLDivElement>(null);

  const byBlock = useMemo(() => {
    const m = new Map<string, Span[]>();
    for (const s of item.spans) {
      if (!m.has(s.blockId)) m.set(s.blockId, []);
      m.get(s.blockId)!.push(s);
    }
    for (const l of m.values()) l.sort((a, b) => a.start - b.start);
    return m;
  }, [item.spans]);

  const setSpans = (fn: (spans: Span[]) => Span[]) => updateItem(item.key, (it) => ({ ...it, spans: fn(it.spans), reviewed: false, result: undefined }));

  const textOf = (s: Span) => essay.blocks.find((b) => b.id === s.blockId)?.text.slice(s.start, s.end) ?? '';

  const toggle = (span: Span, single: boolean) => {
    const to = span.action === 'redact' ? 'flag' : 'redact';
    const key = foldString(textOf(span)).trim();
    setSpans((spans) =>
      spans
        .filter((s) => !(s.source === 'manual' && to === 'flag' && (single ? s.id === span.id : foldString(textOf(s)).trim() === key)))
        .map((s) => ((single ? s.id === span.id : foldString(textOf(s)).trim() === key) ? { ...s, action: to, userSet: true } : s)),
    );
  };

  // Track text selection inside a single paragraph for manual redaction.
  useEffect(() => {
    const onSel = () => {
      const s = document.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || mode !== 'marks') return setSel(null);
      const r = s.getRangeAt(0);
      const el = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-block]') as HTMLElement | null;
      const a = el(r.startContainer);
      const b = el(r.endContainer);
      if (!a || a !== b || !docRef.current?.contains(a)) return setSel(null);
      const off = (node: Node, o: number) => {
        const rr = document.createRange();
        rr.selectNodeContents(a);
        rr.setEnd(node, o);
        return rr.toString().length;
      };
      let start = off(r.startContainer, r.startOffset);
      let end = off(r.endContainer, r.endOffset);
      const blk = essay.blocks.find((x) => x.id === a.dataset.block);
      if (!blk) return setSel(null);
      while (start < end && /\s/.test(blk.text[start])) start++;
      while (end > start && /\s/.test(blk.text[end - 1])) end--;
      if (end <= start) return setSel(null);
      setSel({ blockId: blk.id, start, end, text: blk.text.slice(start, end) });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [essay, mode]);

  /** Remove `text` (at the selection, and optionally everywhere in this essay). */
  const removeText = (text: string, category: Category, all: boolean, at?: Selection) => {
    const targets: { blockId: string; start: number; end: number }[] = [];
    if (all && text.trim()) {
      const re = wordRegex(phraseSource(foldString(text.trim())));
      for (const b of essay.blocks) for (const m of findFolded(fold(b.text), re)) targets.push({ blockId: b.id, ...m });
    }
    if (at && !targets.some((t) => t.blockId === at.blockId && t.start === at.start)) targets.push(at);
    if (!targets.length) return 0;
    setSpans((spans) => {
      const kept = spans.filter((s) => !targets.some((t) => t.blockId === s.blockId && t.start < s.end && t.end > s.start));
      return [
        ...kept,
        ...targets.map((t) => ({ id: uid(), blockId: t.blockId, start: t.start, end: t.end, category, action: 'redact' as const, source: 'manual', label: 'Added by you', userSet: true })),
      ];
    });
    return targets.length;
  };

  const addManual = () => {
    if (!sel) return;
    removeText(sel.text, cat, everywhere, sel);
    document.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const mentioned = useMemo(() => namesInEssay(essay, 60).map((n) => ({ value: n, hint: 'in this essay' })), [essay]);
  const [extraMsg, setExtraMsg] = useState('');

  const groups: { title: string; note?: string; blocks: Block[] }[] = [
    { title: 'Essay', blocks: essay.blocks.filter((b) => (b.kind === 'body' || b.kind === 'textbox') && b.text.trim()) },
    {
      title: 'Page headers & footers',
      note: essay.format === 'pdf' ? `In the output these are replaced by “${label} <page>”.` : undefined,
      blocks: essay.blocks.filter((b) => (b.kind === 'header' || b.kind === 'footer') && b.text.trim()),
    },
    { title: 'Footnotes & endnotes', blocks: essay.blocks.filter((b) => b.kind === 'note' && b.text.trim()) },
  ];

  const red = item.spans.filter((s) => s.action === 'redact').length;
  const flg = item.spans.filter((s) => s.action === 'flag').length;

  return (
    <div class="essay-review">
      <div class="review-head">
        <div>
          <h2>
            {item.fileName} <span class="arrow">→</span> <span class="code big">{label}</span>
          </h2>
          <div class="review-writer">
            <span class="muted small">Writer's name (removed everywhere)</span>
            <WriterField item={item} roster={roster} onChange={(n) => updateItem(item.key, () => ({ ...n, spans: redetect(n, roster, settings) }))} />
            {student && (student.instructor || student.course) && (
              <p class="muted small">
                {student.instructor && <>Instructor: {student.instructor}</>}
                {student.instructor && student.course && ' · '}
                {student.course}
              </p>
            )}
          </div>
          {essay.warnings.length > 0 && (
            <ul class="warnings">
              {essay.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
        <button class="btn primary" onClick={onNext}>
          Looks good → next
        </button>
      </div>

      <div class="toolbar">
        <div class="seg" role="group" aria-label="View">
          <button class={mode === 'marks' ? 'on' : ''} onClick={() => setMode('marks')}>
            Highlights
          </button>
          <button class={mode === 'result' ? 'on' : ''} onClick={() => setMode('result')}>
            Result
          </button>
        </div>
        <span class="legend">
          <span class="mk redact">removed</span> {red} · <span class="mk flag">kept (check)</span> {flg}
        </span>
        <span class="hint muted">Click a highlight to switch it (all identical text); Alt-click for just one. Or select text in the essay to remove it.</span>
        <div class="also-remove">
          <span class="muted small">Also remove a name or word everywhere in this essay:</span>
          <Autocomplete
            ariaLabel="Also remove a name or word"
            value=""
            placeholder="Start typing, or tap for names found in the essay…"
            suggestions={mentioned}
            commitOnBlur={false}
            clearOnCommit
            onCommit={(t) => {
              if (!t) return;
              const n = removeText(t, 'MANUAL', true);
              setExtraMsg(n ? `Removed “${t}” (${plural(n, 'place')}).` : `“${t}” was not found in this essay.`);
            }}
          />
          {extraMsg && <span class="muted small">{extraMsg}</span>}
        </div>
        <div class={`manual ${sel ? 'show' : ''}`}>
          <button class="btn danger small" disabled={!sel} onClick={addManual}>
            Remove selected text{sel ? ` “${sel.text.length > 24 ? sel.text.slice(0, 24) + '…' : sel.text}”` : ''}
          </button>
          <select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value as Category)} aria-label="Replace with">
            {MANUAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                as {replacementFor({ category: c } as Span, undefined, label)}
              </option>
            ))}
          </select>
          <label class="check small">
            <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere((e.target as HTMLInputElement).checked)} /> everywhere in this essay
          </label>
        </div>
      </div>

      <div class={`doc ${mode}`} ref={docRef}>
        {groups.map(
          (g) =>
            g.blocks.length > 0 && (
              <div class={`doc-group ${g.title === 'Essay' ? 'main' : 'aux'}`} key={g.title}>
                <h4>{g.title}</h4>
                {g.note && <p class="muted small">{g.note}</p>}
                {g.blocks.map((b) => (
                  <BlockView key={b.id} block={b} spans={byBlock.get(b.id) ?? []} mode={mode} code={label} onToggle={toggle} />
                ))}
              </div>
            ),
        )}
      </div>
      <div class="actions">
        <span class="muted">{plural(red, 'item')} will be removed from this essay.</span>
        <button class="btn primary" onClick={onNext}>
          Looks good → next
        </button>
      </div>
    </div>
  );
}

function BlockView({ block, spans, mode, code, onToggle }: { block: Block; spans: Span[]; mode: 'marks' | 'result'; code: string; onToggle: (s: Span, single: boolean) => void }) {
  const parts: preact.ComponentChildren[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue;
    if (s.start > pos) parts.push(block.text.slice(pos, s.start));
    const text = block.text.slice(s.start, s.end);
    const repl = replacementFor(s, block, code);
    if (mode === 'result') {
      parts.push(s.action === 'redact' ? <span class="ph">{repl}</span> : <span class="kept">{text}</span>);
    } else {
      parts.push(
        <mark
          key={s.id}
          class={`mk ${s.action}`}
          role="button"
          tabIndex={0}
          title={`${s.label} · ${CATEGORY_LABEL[s.category]}${s.action === 'redact' ? ` → ${repl}` : ' · kept'}\nClick to ${s.action === 'redact' ? 'keep' : 'remove'}`}
          onClick={(e) => onToggle(s, (e as MouseEvent).altKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle(s, e.altKey);
            }
          }}
        >
          {text}
        </mark>,
      );
    }
    pos = s.end;
  }
  if (pos < block.text.length) parts.push(block.text.slice(pos));
  return (
    <p class={`blk ${block.kind}`} data-block={block.id}>
      {parts}
    </p>
  );
}
