import { useState } from 'preact/hooks';
import Papa from 'papaparse';
import { decryptText } from '../key';
import { DropZone } from './DropZone';
import { download } from './util';

/** Open a key file (encrypted or plain CSV) and look up codes. */
export function DecryptTab() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pass, setPass] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [csv, setCsv] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const show = (text: string) => {
    const data = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data;
    setRows(data);
    setCsv(text);
  };

  const onFiles = async (files: File[]) => {
    const f = files[0];
    const text = await f.text();
    setErr('');
    setRows(null);
    if (/\.csv$/i.test(f.name)) show(text);
    else setFile({ name: f.name, text });
  };

  const open = async () => {
    if (!file) return;
    try {
      show(await decryptText(file.text, pass));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const header = rows?.[0] ?? [];
  const body = (rows?.slice(1) ?? []).filter((r) => !q || r.join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <section class="step">
      <div class="step-intro">
        <p class="eyebrow">After judging</p>
        <h2>Look up the key</h2>
        <p>Open the key to see who wrote each essay. Works with the encrypted .enc file or a plain .csv.</p>
      </div>
      <div class="card">
        <DropZone accept=".enc,.csv,.json" multiple={false} onFiles={onFiles} label="Drop the key file here (.enc or .csv)" />
        {file && !rows && (
          <form
            class="pass inline"
            onSubmit={(e) => {
              e.preventDefault();
              open();
            }}
          >
            <label>
              <span>Passphrase for {file.name}</span>
              <input type="password" autocomplete="current-password" value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} />
            </label>
            <button class="btn primary" type="submit">
              Open
            </button>
          </form>
        )}
        {err && <p class="error">{err}</p>}
      </div>
      {rows && (
        <div class="card">
          <div class="actions left">
            <input class="search" placeholder="Search code, name, file…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <button class="btn" onClick={() => download('KEY-decrypted.csv', csv, 'text/csv;charset=utf-8')}>
              Save as .csv
            </button>
          </div>
          <div class="table-wrap">
            <table class="results">
              <thead>
                <tr>
                  {header.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} class={j === 0 ? 'code' : j === 7 ? 'small' : ''}>
                        {c.replace(/^'(?=[=+\-@])/, '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
