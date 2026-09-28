import { useState } from 'preact/hooks';
import JSZip from 'jszip';
import type { Naming, RosterEntry, Settings } from '../core/types';
import { fileNameFor, fillDate, namesInFileName, sanitizeFileName, uniqueNames } from '../naming';
import { CATEGORY_LABEL } from '../core/types';
import { exportEssay } from '../pipeline';
import { canEncrypt, encryptText, keyCsv, type KeyRow } from '../key';
import type { EssayItem } from './state';
import { download, plural, today } from './util';

interface Props {
  items: EssayItem[];
  roster: RosterEntry[];
  settings: Settings;
  labels: Map<string, string>;
  onSettings: (s: Settings) => void;
  updateItem: (key: string, fn: (it: EssayItem) => EssayItem) => void;
  onReview: (key: string) => void;
}

const PATTERN_EXAMPLES = ['{label}', '{label} (anonymized)', 'Writing Award {date} - {label}'];
const DEFAULT_PREFIX = { code: 'WP', number: 'Essay' } as const;

export function ExportStep({ items, roster, settings, labels, onSettings, updateItem, onReview }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [zipDone, setZipDone] = useState(false);
  const [keyDone, setKeyDone] = useState(false);
  const [err, setErr] = useState('');

  const naming = settings.naming;
  const setNaming = (n: Partial<Naming>) => onSettings({ ...settings, naming: { ...naming, ...n } });
  const date = today();
  const labelOf = (it: EssayItem) => labels.get(it.key) ?? it.code;

  const ready = items.filter((i) => i.status === 'ready');
  const failed = items.filter((i) => i.status === 'error');
  const unreviewed = ready.filter((i) => !i.reviewed).length;
  const stale = (i: EssayItem) => !!i.result && i.result.label !== labelOf(i);
  const generated = ready.length > 0 && ready.every((i) => i.result && !stale(i));
  const blocking = (i: EssayItem) => !!i.result && (!!i.result.error || (i.result.hits.some((h) => !h.allowed) && !i.result.override));
  const included = ready.filter((i) => i.result?.bytes && !blocking(i) && !stale(i));

  // Output file names: the pattern, or what the reviewer typed, made safe and unique.
  const defaultName = (it: EssayItem) => fileNameFor(labelOf(it), naming.pattern, date);
  const finalNames = new Map<string, string>();
  uniqueNames(ready.map((it) => sanitizeFileName(it.fileNameOverride ?? '') || defaultName(it))).forEach((n, i) => finalNames.set(ready[i].key, n));
  const nameLeaks = new Map(ready.map((it) => [it.key, namesInFileName(finalNames.get(it.key)!, roster)]));
  const zipBase = sanitizeFileName(fillDate(naming.zipName, date)) || `anonymized-essays-${date}`;
  const keyBase = sanitizeFileName(fillDate(naming.keyName, date)) || `KEY-CONFIDENTIAL-${date}`;
  const zipLeaks = namesInFileName(zipBase, roster);
  const leakyIncluded = included.filter((it) => nameLeaks.get(it.key)!.length);

  const generate = async () => {
    setBusy(true);
    setErr('');
    setZipDone(false);
    setKeyDone(false);
    let n = 0;
    for (const it of ready) {
      const label = labelOf(it);
      try {
        const student = roster.find((r) => r.id === it.entryId);
        const res = await exportEssay(it.parsed!, it.spans, label, student, settings.remove);
        updateItem(it.key, (x) => ({ ...x, result: { bytes: res.bytes, hits: res.hits, override: false, label } }));
      } catch (e) {
        updateItem(it.key, (x) => ({ ...x, result: { hits: [], error: (e as Error).message, override: false, label } }));
      }
      setProgress(++n / ready.length);
    }
    setBusy(false);
  };

  const keyRows = (): KeyRow[] => {
    const rows: KeyRow[] = [];
    for (const it of items) {
      const st = roster.find((r) => r.id === it.entryId);
      const inZip = included.includes(it);
      const redactions = it.parsed
        ? it.spans
            .filter((s) => s.action === 'redact')
            .map((s) => `${CATEGORY_LABEL[s.category]}: ${it.parsed!.blocks.find((b) => b.id === s.blockId)?.text.slice(s.start, s.end).replace(/\s+/g, ' ')}`)
        : [];
      rows.push({
        code: it.status === 'ready' ? labelOf(it) : '',
        outputFile: inZip ? `${finalNames.get(it.key)}.docx` : '',
        originalFile: it.fileName,
        student: st?.name ?? '',
        instructor: st?.instructor ?? '',
        course: st?.course ?? '',
        email: st?.email ?? '',
        status: it.status === 'error' ? `NOT PROCESSED: ${it.parsed?.fatal ?? ''}` : inZip ? (it.result?.override ? 'included (possible leak accepted)' : 'included') : 'NOT INCLUDED',
        redactions: [...new Set(redactions)].join('; '),
        notes: (it.parsed?.warnings ?? []).join(' '),
      });
    }
    return rows;
  };

  const saveZip = async () => {
    const zip = new JSZip();
    for (const it of included) zip.file(`${finalNames.get(it.key)}.docx`, it.result!.bytes!, { date: new Date(Date.UTC(2000, 0, 1)) });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    download(`${zipBase}.zip`, bytes, 'application/zip');
    setZipDone(true);
  };

  const saveKey = async () => {
    const csv = keyCsv(keyRows());
    if (pass) {
      if (pass !== pass2) {
        setErr('The two passphrases do not match.');
        return;
      }
      download(`${keyBase}.enc`, await encryptText(csv, pass), 'application/json');
    } else {
      download(`${keyBase}.csv`, csv, 'text/csv;charset=utf-8');
    }
    setErr('');
    setKeyDone(true);
  };

  const preview = ready.slice(0, 3).map((it) => `${finalNames.get(it.key)}.docx`);

  return (
    <section class="step">
      <div class="step-intro">
        <h2>Create the anonymized files</h2>
        <p>
          Each essay gets a label (written into its heading and page header) and a file name. Every file is then re-opened and searched for the
          student's name, email and everything you removed, including hidden places like document properties.
        </p>
      </div>

      <div class="card">
        <h3>Labels &amp; file names</h3>
        <div class="naming">
          <div>
            <span class="muted small">Label style</span>
            <div class="radio-row" role="radiogroup" aria-label="Label style">
              <label>
                <input
                  type="radio"
                  name="label-style"
                  checked={naming.style === 'code'}
                  onChange={() => setNaming({ style: 'code', prefix: naming.prefix === DEFAULT_PREFIX.number ? DEFAULT_PREFIX.code : naming.prefix })}
                />
                <span>
                  Random code <span class="muted">(e.g. {naming.prefix ? `${naming.prefix}-` : ''}7K3Q)</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="label-style"
                  checked={naming.style === 'number'}
                  onChange={() => setNaming({ style: 'number', prefix: naming.prefix === DEFAULT_PREFIX.code ? DEFAULT_PREFIX.number : naming.prefix })}
                />
                <span>
                  Number <span class="muted">(e.g. {naming.prefix ? `${naming.prefix} ` : ''}01, 02… in random order)</span>
                </span>
              </label>
            </div>
          </div>
          <label>
            <span>Label prefix (optional)</span>
            <input value={naming.prefix} maxLength={24} onInput={(e) => setNaming({ prefix: (e.target as HTMLInputElement).value })} />
          </label>
          <label>
            <span>
              File name pattern — <code>{'{label}'}</code> is the essay label, <code>{'{date}'}</code> today's date
            </span>
            <input value={naming.pattern} onInput={(e) => setNaming({ pattern: (e.target as HTMLInputElement).value })} />
            <span class="chips">
              {PATTERN_EXAMPLES.map((p) => (
                <button key={p} class="chip" onClick={() => setNaming({ pattern: p })}>
                  {p}
                </button>
              ))}
            </span>
          </label>
          <div>
            <span class="muted small">Preview</span>
            {preview.length ? (
              <ul class="preview-names">
                {preview.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {ready.length > 3 && <li class="muted">…</li>}
              </ul>
            ) : (
              <p class="muted small">Add essays to see their names.</p>
            )}
          </div>
          <label>
            <span>ZIP file name</span>
            <input value={naming.zipName} onInput={(e) => setNaming({ zipName: (e.target as HTMLInputElement).value })} />
            <small class="muted">{zipBase}.zip</small>
            {zipLeaks.length > 0 && <small class="error">Contains a name from the roster ({zipLeaks.join(', ')}).</small>}
          </label>
          <label>
            <span>Key file name</span>
            <input value={naming.keyName} onInput={(e) => setNaming({ keyName: (e.target as HTMLInputElement).value })} />
            <small class="muted">
              {keyBase}.{pass ? 'enc' : 'csv'}
            </small>
          </label>
        </div>
        <p class="muted small">You can also rename single files in the table below. Changing the label style or prefix means the files must be re-created.</p>
      </div>

      {unreviewed > 0 && <p class="warn-text">{plural(unreviewed, 'essay')} not yet checked in Review. You can still export.</p>}

      <div class="actions left">
        <button class="btn primary" disabled={busy || !ready.length} onClick={generate}>
          {busy ? `Working… ${Math.round(progress * 100)}%` : ready.some((i) => i.result) ? 'Re-create files' : `Create ${plural(ready.length, 'anonymized file')}`}
        </button>
        {ready.some(stale) && !busy && <span class="warn-text">Labels changed since the files were made — re-create them.</span>}
      </div>

      {ready.some((i) => i.result) && (
        <div class="card">
          <table class="results">
            <thead>
              <tr>
                <th>Label</th>
                <th>File name</th>
                <th>Original file</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {[...ready].sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true })).map((it) => {
                const r = it.result;
                const bad = r?.hits.filter((h) => !h.allowed) ?? [];
                return (
                  <tr key={it.key}>
                    <td class="code">{labelOf(it)}</td>
                    <td>
                      <input
                        class={`fname-input ${nameLeaks.get(it.key)!.length ? 'invalid' : ''}`}
                        aria-label={`File name for ${labelOf(it)}`}
                        value={it.fileNameOverride ?? ''}
                        placeholder={defaultName(it)}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          updateItem(it.key, (x) => ({ ...x, fileNameOverride: v || undefined }));
                        }}
                      />
                      <small class="muted">{finalNames.get(it.key)}.docx</small>
                      {nameLeaks.get(it.key)!.length > 0 && <small class="error">Contains a name from the roster ({nameLeaks.get(it.key)!.join(', ')}).</small>}
                    </td>
                    <td>{it.fileName}</td>
                    <td>
                      {!r ? (
                        <span class="muted">—</span>
                      ) : stale(it) ? (
                        <span class="warn-text">Re-create to apply the new label</span>
                      ) : r.error ? (
                        <span class="error">Failed: {r.error}</span>
                      ) : bad.length === 0 ? (
                        <span class="ok">✓ No identifying text found</span>
                      ) : (
                        <div>
                          <span class="error">⚠ {plural(bad.length, 'possible leak')}:</span>
                          <ul class="hits">
                            {bad.slice(0, 6).map((h, i) => (
                              <li key={i}>
                                “<b>{h.match}</b>” in {h.part}: <span class="muted">…{h.snippet}…</span>
                              </li>
                            ))}
                          </ul>
                          <button class="btn small" onClick={() => onReview(it.key)}>
                            Fix in review
                          </button>{' '}
                          <label class="check small">
                            <input type="checkbox" checked={r.override} onChange={(e) => updateItem(it.key, (x) => ({ ...x, result: { ...x.result!, override: (e.target as HTMLInputElement).checked } }))} />{' '}
                            include anyway
                          </label>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {failed.map((it) => (
                <tr key={it.key}>
                  <td class="muted">—</td>
                  <td class="muted">—</td>
                  <td>{it.fileName}</td>
                  <td class="error">Not processed: {it.parsed?.fatal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {generated && ready.length > 0 && (
        <div class="grid2">
          <div class="card">
            <h3>1 · Essays for reviewers</h3>
            <p>
              {plural(included.length, 'essay')} in <b>{zipBase}.zip</b>. This is what you send to the committee.
            </p>
            {(leakyIncluded.length > 0 || zipLeaks.length > 0) && (
              <p class="error small">A file name contains a student's or instructor's name. Change it above before downloading.</p>
            )}
            <button class="btn primary" disabled={!included.length || leakyIncluded.length > 0 || zipLeaks.length > 0} onClick={saveZip}>
              Download anonymized essays (.zip)
            </button>
            {zipDone && <p class="ok">Saved.</p>}
          </div>
          <div class="card key">
            <h3>2 · Confidential key</h3>
            <p>
              Which label is which student, plus a list of what was removed. <b>Keep it separate; do not send it to reviewers.</b>
            </p>
            {canEncrypt() ? (
              <div class="pass">
                <label>
                  <span>Passphrase (optional, encrypts the key)</span>
                  <input type="password" autocomplete="new-password" value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} />
                </label>
                {pass && (
                  <label>
                    <span>Repeat passphrase</span>
                    <input type="password" autocomplete="new-password" value={pass2} onInput={(e) => setPass2((e.target as HTMLInputElement).value)} />
                  </label>
                )}
                {pass && <small class="muted">An encrypted key can only be opened in this app's “Look up key” tab. If the passphrase is lost, the key cannot be recovered.</small>}
              </div>
            ) : (
              <p class="muted small">Encryption is not available in this browser; the key will be a plain .csv.</p>
            )}
            <button class="btn" onClick={saveKey}>
              Download key ({pass ? 'encrypted .enc' : '.csv'})
            </button>
            {err && <p class="error">{err}</p>}
            {keyDone && <p class="ok">Saved.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
