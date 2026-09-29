import { useMemo } from 'preact/hooks';
import type { RosterEntry } from '../core/types';
import { foldString } from '../core/text';
import { namesInEssay } from '../detect/writer';
import { Autocomplete, type Suggestion } from './Autocomplete';
import { CHOSEN_BY_YOU, studentFor, writerLabel, type EssayItem } from './state';

/** Suggestions for the writer box: guesses from the file, the roster, then names in the essay. */
export function writerSuggestions(item: EssayItem, roster: RosterEntry[], mentioned: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of item.candidates ?? []) out.push({ value: c.name, hint: c.reasons.join(' · ') });
  const cands = new Set(item.match?.candidates ?? []);
  const rosterSorted = [...roster].sort((a, b) => Number(cands.has(b.id)) - Number(cands.has(a.id)));
  for (const r of rosterSorted) out.push({ value: r.name, hint: `roster${r.fileName ? ` · ${r.fileName}` : ''}`, data: { entryId: r.id } });
  for (const n of mentioned) out.push({ value: n, hint: 'mentioned in the essay' });
  return out;
}

/** Apply a writer chosen or typed by the reviewer. */
export function setWriter(item: EssayItem, text: string, picked: Suggestion | undefined, roster: RosterEntry[]): EssayItem {
  const pickedId = (picked?.data as { entryId?: string } | undefined)?.entryId;
  const exact = roster.find((r) => foldString(r.name) === foldString(text));
  const entryId = pickedId ?? exact?.id ?? null;
  const match = { candidates: [], ...item.match, entryId, confidence: 'high' as const, reason: CHOSEN_BY_YOU };
  if (entryId) return { ...item, entryId, writer: undefined, writerSource: undefined, match, reviewed: false, result: undefined };
  return { ...item, entryId: null, writer: text || undefined, writerSource: 'typed', match, reviewed: false, result: undefined };
}

export function writerStatus(item: EssayItem, roster: RosterEntry[]): { cls: string; text: string } {
  if (item.entryId && studentFor(item, roster)) {
    return item.match?.reason === CHOSEN_BY_YOU
      ? { cls: 'high', text: 'Roster · chosen by you' }
      : { cls: item.match?.confidence ?? 'high', text: `Roster · ${item.match?.reason ?? 'matched'}` };
  }
  if (item.writer && item.writerSource === 'guess') {
    const c = item.candidates?.find((x) => foldString(x.name) === foldString(item.writer!));
    return { cls: 'medium', text: `Found: ${c?.reasons.join(', ') ?? 'in the file'} — check` };
  }
  if (item.writer) return { cls: 'high', text: 'Set by you' };
  return { cls: 'none', text: 'Not found — type the name or tap to pick a suggestion' };
}

export function WriterField({ item, roster, onChange }: { item: EssayItem; roster: RosterEntry[]; onChange: (next: EssayItem) => void }) {
  const mentioned = useMemo(() => (item.parsed && !item.parsed.fatal ? namesInEssay(item.parsed, 25) : []), [item.parsed]);
  const suggestions = useMemo(() => writerSuggestions(item, roster, mentioned), [item.candidates, item.match, roster, mentioned]);
  const status = writerStatus(item, roster);
  return (
    <div class="writer-field">
      <Autocomplete
        ariaLabel={`Writer's name for ${item.fileName}`}
        value={writerLabel(item, roster)}
        suggestions={suggestions}
        placeholder="Writer's name"
        invalid={status.cls === 'none'}
        onCommit={(text, picked) => onChange(setWriter(item, text, picked, roster))}
      />
      <span class={`badge ${status.cls}`}>{status.text}</span>
    </div>
  );
}
