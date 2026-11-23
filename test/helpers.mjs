// Shared test helpers: reading Word packages and checking XML.
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { crc32 } from "../src/docx.mjs";

// En and em dash, built from char codes so this file passes the dash hook.
export const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

export function* strings(value, path = "") {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}.${k}`);
}

export function unzip(buf) {
  const files = {};
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const method = buf.readUInt16LE(p + 10);
    const body = buf.subarray(dataStart, dataStart + size);
    const raw = method === 8 ? inflateRawSync(body) : body;
    assert.equal(crc32(raw), crc, `CRC mismatch in ${name}`);
    files[name] = raw.toString("utf8");
    p += 46 + nameLen;
  }
  return files;
}

export function wellFormed(xml, name) {
  const stack = [];
  for (const [, close, tag, selfClose] of xml.replace(/<\?[^>]*\?>/g, "").matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), tag, `${name}: unbalanced </${tag}>`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
}

export const xmlText = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// The same banned wording for every kit: no safety or compliance claims, no
// fines, no verdicts.
export const BANNED = [
  /\b(is|are) (safe|compliant|certified)\b/i,
  /\b(veilig|compliant|gecertificeerd) (is|zijn)\b/i,
  /\bguarantee/i,
  /\bgarandeer/i,
  /\bfines?\b/i,
  /\bpenalt/i,
  /\bboete/i,
  /\byou must report\b/i,
  /\bno need to report\b/i,
  /\byou don't (have|need) to report\b/i,
];
