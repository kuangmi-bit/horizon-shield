// Remove location and other metadata from uploaded photos before they are stored.
// PNG: drop eXIf, tEXt, zTXt, iTXt and tIME chunks.
// Anything that is not a well-formed JPEG or PNG is rejected rather than stored as is.

// JPEG: keep SOI, APP0 (JFIF), APP2 only when it is an ICC profile, APP14 (Adobe), the frame,
// tables, scans and EOI. Everything else is dropped, including anything after EOI (phones often
// append a second JPEG with its own Exif there).

export function sniff(bytes) {
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

const DROP_PNG = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

export function stripJpeg(bytes) {
  const out = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("jpeg: not a JPEG");
  out.push(bytes.subarray(0, 2));
  let i = 2;
  let sawEoi = false;
  while (i < bytes.length && !sawEoi) {
    if (bytes[i] !== 0xff) throw new Error("jpeg: bad marker");
    let m = bytes[i + 1];
    while (m === 0xff) { i++; m = bytes[i + 1]; }
    if (m === undefined) throw new Error("jpeg: truncated");
    if (m === 0xd9) { out.push(bytes.subarray(i, i + 2)); sawEoi = true; break; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > bytes.length) throw new Error("jpeg: truncated");
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) throw new Error("jpeg: bad segment length");
    const seg = bytes.subarray(i, i + 2 + len);
    if (m === 0xda) {
      // start of scan: copy the header, then the entropy-coded data up to the next real marker
      let j = i + 2 + len;
      while (j < bytes.length) {
        if (bytes[j] === 0xff && j + 1 < bytes.length) {
          const n = bytes[j + 1];
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        j++;
      }
      out.push(bytes.subarray(i, j));
      i = j;
      continue;
    }
    const keep = m === 0xe0 || m === 0xee || m === 0xdb || m === 0xc4 || m === 0xdd || (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      || (m === 0xe2 && len > 14 && String.fromCharCode(...bytes.subarray(i + 4, i + 15)) === "ICC_PROFILE");
    if (keep) out.push(seg);
    i += 2 + len;
  }
  if (!sawEoi) throw new Error("jpeg: no end of image");
  return concat(out);
}

export function stripPng(bytes) {
  const out = [bytes.subarray(0, 8)];
  let i = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 8 <= bytes.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;
    if (end > bytes.length) throw new Error("png: bad chunk length");
    if (!DROP_PNG.has(type)) out.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(out);
}

export function stripMetadata(bytes) {
  const kind = sniff(bytes);
  if (kind === "jpeg") return { kind, bytes: stripJpeg(bytes), contentType: "image/jpeg" };
  if (kind === "png") return { kind, bytes: stripPng(bytes), contentType: "image/png" };
  if (kind === "pdf") return { kind, bytes, contentType: "application/pdf" };
  return { kind: null };
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
