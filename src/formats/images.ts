/** Remove EXIF / XMP / IPTC / comment metadata from embedded JPEG and PNG images. */

export function stripJpeg(buf: Uint8Array): Uint8Array {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts: Uint8Array[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // unexpected layout: leave untouched
    const marker = buf[i + 1];
    if (marker === 0xda) {
      parts.push(buf.subarray(i));
      break;
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    const seg = buf.subarray(i, i + 2 + len);
    // APP1 (Exif/XMP), APP12, APP13 (IPTC/Photoshop), COM
    const drop = marker === 0xe1 || marker === 0xec || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(seg);
    i += 2 + len;
  }
  return concat(parts);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

export function stripPng(buf: Uint8Array): Uint8Array {
  if (buf.length < 8 || !PNG_SIG.every((b, k) => buf[k] === b)) return buf;
  const parts: Uint8Array[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = ((buf[i] << 24) >>> 0) + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3];
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    const end = i + 12 + len;
    if (end > buf.length) return buf;
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(parts);
}

export function stripImage(path: string, buf: Uint8Array): Uint8Array {
  if (/\.jpe?g$/i.test(path)) return stripJpeg(buf);
  if (/\.png$/i.test(path)) return stripPng(buf);
  return buf;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
