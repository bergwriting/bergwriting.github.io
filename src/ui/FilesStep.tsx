import type { RosterEntry, Settings } from '../core/types';
import { matchEssay } from '../core/roster';
import { parseEssay } from '../pipeline';
import { randomRank, uniqueTag } from '../key';
import { DropZone } from './DropZone';
import { readBytes, plural } from './util';
import { assignWriter, redetect, studentFor, type EssayItem } from './state';
import { WriterField } from './WriterField';

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
        const next = assignWriter({ ...it, parsed, match, entryId: match.entryId, status: parsed.fatal ? 'error' : 'ready' });
        return { ...next, spans: redetect(next, roster, settings) };
      });
    }
  };

  const changeWriter = (next: EssayItem) => updateItem(next.key, () => ({ ...next, spans: redetect(next, roster, settings) }));

  const used = new Map<string, number>();
  for (const i of items) if (i.entryId) used.set(i.entryId, (used.get(i.entryId) ?? 0) + 1);
  const needsChoice = items.filter((i) => i.status === 'ready' && !studentFor(i, roster)).length;
  const reading = items.some((i) => i.status === 'reading');

  return (
    <section class="step">
      <div class="step-intro">
        <p class="eyebrow">Step 2 of 4</p>
        <h2>Add the essays</h2>
        <p>
          Drop in Word (.docx) and PDF files; you can add many at once. From Google Docs use <i>File › Download › Microsoft Word (.docx)</i>. For each
          essay, check the <b>writer's name</b>: it is filled in when the tool is confident, and tapping the box suggests likely names found in the file
          (and roster names, if you loaded one). Add a nickname after a semicolon, e.g. <i>Hamed Yaghoobian; Hami</i>.
        </p>
      </div>
      <DropZone accept=".docx,.pdf,.doc,.pages,.odt,.rtf" multiple onFiles={addFiles} label="Drop essays here — Word (.docx) or PDF" />

      {items.length > 0 && (
        <div class="card">
          <table class="files">
            <thead>
              <tr>
                <th>File</th>
                <th>Writer's name</th>
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
                    {it.status === 'ready' && <WriterField item={it} roster={roster} onChange={changeWriter} />}
                    {it.entryId && (used.get(it.entryId) ?? 0) > 1 && <div class="warn-text small">Same roster student as another file</div>}
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
          ← Settings
        </button>
        {needsChoice > 0 && <span class="warn-text">{plural(needsChoice, 'essay')} without a writer's name — type or pick one so the name can be removed everywhere.</span>}
        <button class="btn primary" disabled={reading || !items.some((i) => i.status === 'ready')} onClick={onNext}>
          Next: review →
        </button>
      </div>
    </section>
  );
}
