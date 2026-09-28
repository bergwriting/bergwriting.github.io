/** Essay codes and the confidential key file (optionally passphrase-encrypted). */

// No look-alike characters (0/O, 1/I/L, 2/Z, 5/S, 8/B).
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

function randomIndex(n: number): number {
  // rejection sampling for an unbiased pick
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

export function randomCode(prefix = 'WP'): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[randomIndex(ALPHABET.length)];
  return `${prefix}-${s}`;
}

/** A random 4-character tag (e.g. 7K3Q) not in `taken`. */
export function uniqueTag(taken: Set<string>): string {
  for (;;) {
    const t = randomCode('').slice(1);
    if (!taken.has(t)) {
      taken.add(t);
      return t;
    }
  }
}

/** A random number in [0, 1) from the secure generator, used to shuffle essay numbers. */
export function randomRank(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53;
}

/** A code not in `taken`. Codes are random, never sequential, so order reveals nothing. */
export function uniqueCode(taken: Set<string>, prefix = 'WP'): string {
  for (;;) {
    const c = randomCode(prefix);
    if (!taken.has(c)) {
      taken.add(c);
      return c;
    }
  }
}

export interface KeyRow {
  code: string;
  outputFile: string;
  originalFile: string;
  student: string;
  instructor: string;
  course: string;
  email: string;
  status: string;
  redactions: string;
  notes: string;
}

const COLUMNS: [keyof KeyRow, string][] = [
  ['code', 'Essay label'],
  ['outputFile', 'Anonymized file'],
  ['originalFile', 'Original file'],
  ['student', 'Student'],
  ['instructor', 'Instructor'],
  ['course', 'Course'],
  ['email', 'Student email'],
  ['status', 'Status'],
  ['redactions', 'What was removed'],
  ['notes', 'Notes'],
];

function csvCell(s: string): string {
  // also neutralise spreadsheet formula injection
  const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function keyCsv(rows: KeyRow[]): string {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  const lines = [COLUMNS.map(([, h]) => csvCell(h)).join(',')];
  for (const r of sorted) lines.push(COLUMNS.map(([k]) => csvCell(r[k] ?? '')).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ITERATIONS = 310_000;

async function deriveKey(pass: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function canEncrypt(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

/** AES-256-GCM with a PBKDF2-SHA256 key. Output is a small JSON document. */
export async function encryptText(text: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return JSON.stringify({ format: 'essay-anonymizer-key', v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(ct) }, null, 1);
}

export async function decryptText(json: string, pass: string): Promise<string> {
  let o: { format?: string; iterations?: number; salt: string; iv: string; data: string };
  try {
    o = JSON.parse(json);
  } catch {
    throw new Error('This is not an encrypted key file.');
  }
  if (o.format !== 'essay-anonymizer-key') throw new Error('This is not an encrypted key file.');
  const key = await deriveKey(pass, unb64(o.salt), o.iterations ?? ITERATIONS);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.data));
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong passphrase (or the file is damaged).');
  }
}
