import { useState } from 'preact/hooks';
import type { RosterEntry, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
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
        <h2>Load the submission roster</h2>
        <p>
          A spreadsheet with one row per essay: at least the student's name, ideally also the file name, instructor, course and email. Names are looked
          for in every essay, so the more you include, the more reliable the result. Export it from Excel or Google Sheets as <b>.csv</b> or <b>.xlsx</b>, or
          paste the rows below. The roster stays in this window only and is never saved.
        </p>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Roster file</h3>
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
          <h3>Settings</h3>
          <span class="muted">School names, extra terms, ID format (remembered on this computer)</span>
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
          <label class="check">
            <input type="checkbox" checked={settings.flagOtherNames} onChange={(e) => onSettings({ ...settings, flagOtherNames: (e.target as HTMLInputElement).checked })} />
            <span>Highlight other people's names (cited authors, friends) for review. They are kept unless you click them.</span>
          </label>
          <div>
            <button class="btn subtle" onClick={() => onSettings({ ...DEFAULT_SETTINGS })}>
              Reset settings
            </button>
          </div>
        </div>
      </details>

      <div class="actions">
        {!roster.length && <span class="muted">You can continue without a roster, but only headings, metadata and patterns will be found.</span>}
        <button class="btn primary" onClick={onNext}>
          Next: add essays →
        </button>
      </div>
    </section>
  );
}
