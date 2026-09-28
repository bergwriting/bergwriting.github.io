import { useState } from 'preact/hooks';
import JSZip from 'jszip';
import type { RosterEntry } from '../core/types';
import { CATEGORY_LABEL } from '../core/types';
import { exportEssay } from '../pipeline';
import { canEncrypt, encryptText, keyCsv, type KeyRow } from '../key';
import type { EssayItem } from './state';
import { download, plural, today } from './util';

interface Props {
  items: EssayItem[];
  roster: RosterEntry[];
  updateItem: (key: string, fn: (it: EssayItem) => EssayItem) => void;
  onReview: (key: string) => void;
}

export function ExportStep({ items, roster, updateItem, onReview }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [zipDone, setZipDone] = useState(false);
  const [keyDone, setKeyDone] = useState(false);
  const [err, setErr] = useState('');

  const ready = items.filter((i) => i.status === 'ready');
  const failed = items.filter((i) => i.status === 'error');
  const unreviewed = ready.filter((i) => !i.reviewed).length;
  const generated = ready.every((i) => i.result);
  const blocking = (i: EssayItem) => !!i.result && (!!i.result.error || (i.result.hits.some((h) => !h.allowed) && !i.result.override));
  const included = ready.filter((i) => i.result?.bytes && !blocking(i));

  const generate = async () => {
    setBusy(true);
    setErr('');
    setZipDone(false);
    setKeyDone(false);
    let n = 0;
    for (const it of ready) {
      try {
        const student = roster.find((r) => r.id === it.entryId);
        const res = await exportEssay(it.parsed!, it.spans, it.code, student);
        updateItem(it.key, (x) => ({ ...x, result: { bytes: res.bytes, hits: res.hits, override: false } }));
      } catch (e) {
        updateItem(it.key, (x) => ({ ...x, result: { hits: [], error: (e as Error).message, override: false } }));
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
        code: it.status === 'ready' ? it.code : '',
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
    for (const it of included) zip.file(`${it.code}.docx`, it.result!.bytes!, { date: new Date(Date.UTC(2000, 0, 1)) });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    download(`anonymized-essays-${today()}.zip`, bytes, 'application/zip');
    setZipDone(true);
  };

  const saveKey = async () => {
    const csv = keyCsv(keyRows());
    if (pass) {
      if (pass !== pass2) {
        setErr('The two passphrases do not match.');
        return;
      }
      download(`KEY-CONFIDENTIAL-${today()}.enc`, await encryptText(csv, pass), 'application/json');
    } else {
      download(`KEY-CONFIDENTIAL-${today()}.csv`, csv, 'text/csv;charset=utf-8');
    }
    setErr('');
    setKeyDone(true);
  };

  return (
    <section class="step">
      <div class="step-intro">
        <h2>Create the anonymized files</h2>
        <p>
          Each essay becomes <b>CODE.docx</b> with identifying details replaced. Every file is then re-opened and searched for the student's name, email and
          everything you removed, including hidden places like document properties.
        </p>
      </div>

      {unreviewed > 0 && <p class="warn-text">{plural(unreviewed, 'essay')} not yet checked in Review. You can still export.</p>}

      <div class="actions left">
        <button class="btn primary" disabled={busy || !ready.length} onClick={generate}>
          {busy ? `Working… ${Math.round(progress * 100)}%` : generated && ready.length ? 'Re-create files' : `Create ${plural(ready.length, 'anonymized file')}`}
        </button>
      </div>

      {ready.some((i) => i.result) && (
        <div class="card">
          <table class="results">
            <thead>
              <tr>
                <th>Code</th>
                <th>Original file</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((it) => {
                const r = it.result;
                const bad = r?.hits.filter((h) => !h.allowed) ?? [];
                return (
                  <tr key={it.key}>
                    <td class="code">{it.code}</td>
                    <td>{it.fileName}</td>
                    <td>
                      {!r ? (
                        <span class="muted">—</span>
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
              {plural(included.length, 'essay')} in one ZIP, named by code only. This is what you send to the committee.
            </p>
            <button class="btn primary" disabled={!included.length} onClick={saveZip}>
              Download anonymized essays (.zip)
            </button>
            {zipDone && <p class="ok">Saved.</p>}
          </div>
          <div class="card key">
            <h3>2 · Confidential key</h3>
            <p>
              Which code is which student, plus a list of what was removed. <b>Keep it separate; do not send it to reviewers.</b>
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
