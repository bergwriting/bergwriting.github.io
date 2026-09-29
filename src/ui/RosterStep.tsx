import { useState } from 'preact/hooks';
import type { RosterEntry, Settings } from '../core/types';
import { DEFAULT_SETTINGS, REMOVE_OPTIONS, REMOVE_PRESETS } from '../core/types';
import { FIELD_LABELS, guessMapping, parseRosterText, type ColumnMapping, type RosterField, type RosterTable } from '../core/roster';
import { readXlsx } from '../core/xlsx';
import { DropZone } from './DropZone';
import { plural, readBytes } from './util';

interface Props {
  table: RosterTable | null;
  mapping: ColumnMapping;
  roster: RosterEntry[];
  settings: Settings;
  onTable: (t: RosterTable, m: ColumnMapping) => void;
  onMapping: (m: ColumnMapping) => void;
  onSettings: (s: Settings) => void;
  onNext: () => void;
}

const FIELDS = Object.keys(FIELD_LABELS) as RosterField[];

export function RosterStep({ table, mapping, roster, settings, onTable, onMapping, onSettings, onNext }: Props) {
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');

  const load = (t: RosterTable) => {
    if (!t.headers.length) {
      setError('That roster looks empty.');
      return;
    }
    setError('');
    onTable(t, guessMapping(t.headers));
  };

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      if (/\.xlsx$/i.test(f.name)) load(await readXlsx(await readBytes(f)));
      else if (/\.xls$/i.test(f.name)) setError('Old .xls files are not supported. Save as .xlsx or .csv.');
      else load(parseRosterText(await f.text()));
    } catch (e) {
      setError(`Could not read the roster: ${(e as Error).message}`);
    }
  };

  const idPatternOk = (() => {
    try {
      new RegExp(settings.idPattern, 'u');
      return true;
    } catch {
      return false;
    }
  })();

  return (
    <section class="step">
      <div class="step-intro">
        <h2>Settings &amp; roster</h2>
        <p>
          By default only the <b>writer's name</b> is removed. You'll confirm each writer's name in step 2 (the tool suggests it from the file). A roster
          is <b>optional</b>: if you have a spreadsheet of submissions (name, file name…), load it and names are matched automatically. It stays in this
          window only and is never saved.
        </p>
      </div>

      <WhatToRemove settings={settings} onSettings={onSettings} />

      <div class="grid2">
        <div class="card">
          <h3>Roster file (optional)</h3>
          <DropZone accept=".csv,.tsv,.txt,.xlsx" multiple={false} onFiles={onFiles} label="Drop a .csv or .xlsx roster here, or click to choose" />
          <details class="paste">
            <summary>…or paste from a spreadsheet</summary>
            <textarea
              rows={6}
              value={paste}
              placeholder={'Student Name\tFile\tInstructor\nJane Doe\tdoe_essay.docx\tDr. Smith'}
              onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            />
            <button class="btn" disabled={!paste.trim()} onClick={() => load(parseRosterText(paste))}>
              Use pasted rows
            </button>
          </details>
          {error && <p class="error">{error}</p>}
        </div>

        <div class="card">
          <h3>Match columns</h3>
          {!table ? (
            <p class="muted">Load a roster to choose which column is which.</p>
          ) : (
            <>
              <div class="mapping">
                {FIELDS.map((f) => (
                  <label key={f}>
                    <span>{FIELD_LABELS[f]}</span>
                    <select
                      value={mapping[f] ?? ''}
                      onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        const m = { ...mapping };
                        if (v === '') delete m[f];
                        else m[f] = Number(v);
                        onMapping(m);
                      }}
                    >
                      <option value="">— not in roster —</option>
                      {table.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p class={roster.length ? 'ok' : 'error'}>
                {roster.length ? `${plural(roster.length, 'student')} loaded.` : 'Choose the column that holds student names.'}
              </p>
              {roster.length > 0 && (
                <table class="preview">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>File</th>
                      <th>Instructor</th>
                      <th>Course</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.slice(0, 5).map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          {r.otherNames.length > 0 && <span class="muted"> ({r.otherNames.join(', ')})</span>}
                        </td>
                        <td>{r.fileName}</td>
                        <td>{r.instructor}</td>
                        <td>{r.course}</td>
                      </tr>
                    ))}
                    {roster.length > 5 && (
                      <tr>
                        <td colSpan={4} class="muted">
                          …and {roster.length - 5} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      <details class="card settings">
        <summary>
          <h3>More settings</h3>
          <span class="muted">School names, extra terms to remove, ID format (remembered on this computer)</span>
        </summary>
        <div class="grid2">
          <label>
            <span>School / college names to remove (one per line)</span>
            <textarea
              rows={3}
              value={settings.institutions}
              placeholder={'Muhlenberg College\nMuhlenberg'}
              onInput={(e) => onSettings({ ...settings, institutions: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
          <label>
            <span>Other words or phrases to always remove (one per line), e.g. dorm or program names</span>
            <textarea rows={3} value={settings.extraTerms} onInput={(e) => onSettings({ ...settings, extraTerms: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <label>
            <span>Course code prefixes (comma separated)</span>
            <input value={settings.coursePrefixes} onInput={(e) => onSettings({ ...settings, coursePrefixes: (e.target as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Student ID format (regular expression)</span>
            <input
              class={idPatternOk ? '' : 'invalid'}
              value={settings.idPattern}
              onInput={(e) => onSettings({ ...settings, idPattern: (e.target as HTMLInputElement).value })}
            />
            {!idPatternOk && <small class="error">Not a valid pattern — it will be ignored.</small>}
          </label>
          <div>
            <button class="btn subtle" onClick={() => onSettings({ ...DEFAULT_SETTINGS, remove: settings.remove, naming: settings.naming })}>
              Reset settings
            </button>
          </div>
        </div>
      </details>

      <div class="actions">
        {!roster.length && <span class="muted">No roster? That's fine — you'll confirm each writer's name in the next step.</span>}
        <button class="btn primary" onClick={onNext}>
          Next: add essays →
        </button>
      </div>
    </section>
  );
}

/** Choose which kinds of identifying detail are removed. */
export function WhatToRemove({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const on = REMOVE_OPTIONS.filter((o) => settings.remove[o.key]).map((o) => o.key);
  const preset = REMOVE_PRESETS.find((p) => p.keys.length === on.length && p.keys.every((k) => settings.remove[k]));
  const setAll = (keys: string[]) =>
    onSettings({ ...settings, remove: Object.fromEntries(REMOVE_OPTIONS.map((o) => [o.key, keys.includes(o.key)])) as Settings['remove'] });
  return (
    <div class="card remove-card">
      <div class="remove-head">
        <div>
          <h3>What to remove</h3>
          <p class="muted small">
            Only what is ticked is removed; everything else (citations, authors you quote, your title) is left exactly as written. Remembered on this computer.
          </p>
        </div>
        <div class="seg presets" role="group" aria-label="Presets">
          {REMOVE_PRESETS.map((p) => (
            <button key={p.id} class={preset?.id === p.id ? 'on' : ''} aria-pressed={preset?.id === p.id} onClick={() => setAll(p.keys)}>
              {p.label}
            </button>
          ))}
          <button class={!preset ? 'on' : ''} aria-pressed={!preset} disabled>
            Custom
          </button>
        </div>
      </div>
      <div class="remove-grid">
        {REMOVE_OPTIONS.map((o) => (
          <label class="check" key={o.key}>
            <input
              type="checkbox"
              checked={settings.remove[o.key]}
              onChange={(e) => onSettings({ ...settings, remove: { ...settings.remove, [o.key]: (e.target as HTMLInputElement).checked } })}
            />
            <span>
              <b>{o.label}</b>
              {o.hint && <small class="muted"> — {o.hint}</small>}
            </span>
          </label>
        ))}
        <label class="check">
          <input type="checkbox" checked={settings.flagOtherNames} onChange={(e) => onSettings({ ...settings, flagOtherNames: (e.target as HTMLInputElement).checked })} />
          <span>
            <b>Highlight other people's names</b>
            <small class="muted"> — cited authors, friends; kept unless you click them</small>
          </span>
        </label>
      </div>
      {!settings.remove.studentName && <p class="warn-text small">The writer's name will not be removed — the essays will not be anonymous.</p>}
      <p class="muted small">
        Always removed, whatever you choose: names hidden inside the file (document properties, comment and tracked-change authors, the thumbnail),
        plus any custom terms from Settings and anything you remove by hand in Review. Emails often contain the writer's name — tick “Email addresses”
        if your essays include one.
      </p>
    </div>
  );
}
