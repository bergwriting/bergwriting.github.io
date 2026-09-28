import type { RosterEntry, Settings } from '../core/types';
import { matchEssay } from '../core/roster';
import { parseEssay } from '../pipeline';
import { randomRank, uniqueTag } from '../key';
import { DropZone } from './DropZone';
import { readBytes, plural } from './util';
import { CHOSEN_BY_YOU, redetect, type EssayItem } from './state';

interface Props {
  items: EssayItem[];
  setItems: (fn: (list: EssayItem[]) => EssayItem[]) => void;
  roster: RosterEntry[];
  settings: Settings;
  updateItem: (key: string, fn: (it: EssayItem) => EssayItem) => void;
  onNext: () => void;
  onBack: () => void;
}

let seq = 0;

export function FilesStep({ items, setItems, roster, settings, updateItem, onNext, onBack }: Props) {
  const addFiles = async (files: File[]) => {
    const taken = new Set(items.map((i) => i.code));
    const fresh: { item: EssayItem; file: File }[] = files
      .filter((f) => !items.some((i) => i.fileName === f.name))
      .map((f) => ({
        file: f,
        item: { key: `f${++seq}`, fileName: f.name, status: 'reading', entryId: null, spans: [], code: uniqueTag(taken), rank: randomRank(), reviewed: false },
      }));
    setItems((list) => [...list, ...fresh.map((x) => x.item)]);
    // one at a time keeps the page responsive
    for (const { item, file } of fresh) {
      const parsed = await parseEssay(file.name, await readBytes(file));
      const match = matchEssay(parsed, roster);
      updateItem(item.key, (it) => {
        const next: EssayItem = { ...it, parsed, match, entryId: match.entryId, status: parsed.fatal ? 'error' : 'ready' };
        return { ...next, spans: redetect(next, roster, settings) };
      });
    }
  };

  const setEntry = (key: string, entryId: string | null) =>
    updateItem(key, (it) => {
      const next = { ...it, entryId, reviewed: false, result: undefined, match: { candidates: [], ...it.match, entryId, confidence: 'high' as const, reason: CHOSEN_BY_YOU } };
      return { ...next, spans: redetect(next, roster, settings) };
    });

  const used = new Map<string, number>();
  for (const i of items) if (i.entryId) used.set(i.entryId, (used.get(i.entryId) ?? 0) + 1);
  const needsChoice = items.filter((i) => i.status === 'ready' && !i.entryId).length;
  const reading = items.some((i) => i.status === 'reading');

  return (
    <section class="step">
      <div class="step-intro">
        <h2>Add the essays</h2>
        <p>
          Drop in Word (.docx) and PDF files; you can add many at once. From Google Docs use <i>File › Download › Microsoft Word (.docx)</i>. Each file is
          matched to a roster row by its file name or the name inside it; check the matches below.
        </p>
      </div>
      <DropZone accept=".docx,.pdf,.doc,.pages,.odt,.rtf" multiple onFiles={addFiles} label="Drop essay files here, or click to choose" />

      {items.length > 0 && (
        <div class="card">
          <table class="files">
            <thead>
              <tr>
                <th>File</th>
                <th>Student</th>
                <th>How matched</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} class={it.status}>
                  <td>
                    <div class="fname">{it.fileName}</div>
                    {it.status === 'reading' && <span class="muted">Reading…</span>}
                    {it.status === 'error' && <div class="error">{it.parsed?.fatal}</div>}
                  </td>
                  <td>
                    {it.status === 'ready' && (
                      <select
                        class={!it.entryId ? 'invalid' : (used.get(it.entryId) ?? 0) > 1 ? 'warn' : ''}
                        value={it.entryId ?? ''}
                        onChange={(e) => setEntry(it.key, (e.target as HTMLSelectElement).value || null)}
                      >
                        <option value="">{roster.length ? '— choose student —' : '— no roster —'}</option>
                        {(it.match?.candidates.length ? [...roster].sort((a, b) => Number(it.match!.candidates.includes(b.id)) - Number(it.match!.candidates.includes(a.id))) : roster).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.fileName ? ` — ${r.fileName}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {it.entryId && (used.get(it.entryId) ?? 0) > 1 && <div class="warn-text">Same student as another file</div>}
                  </td>
                  <td>
                    {it.match && it.status === 'ready' && (
                      <span class={`badge ${it.entryId ? it.match.confidence : 'none'}`} title={it.match.reason}>
                        {it.entryId ? it.match.reason : it.match.reason || 'Not matched'}
                      </span>
                    )}
                  </td>
                  <td>
                    <button class="btn subtle small" aria-label={`Remove ${it.fileName}`} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div class="actions">
        <button class="btn" onClick={onBack}>
          ← Roster
        </button>
        {needsChoice > 0 && <span class="warn-text">{plural(needsChoice, 'essay')} not matched to a student — choose one, or continue with heading/pattern detection only.</span>}
        <button class="btn primary" disabled={reading || !items.some((i) => i.status === 'ready')} onClick={onNext}>
          Next: review →
        </button>
      </div>
    </section>
  );
}
