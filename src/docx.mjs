// A minimal, zero-dependency .docx writer for the kits' Word templates.
// It supports what a one- or two-page template needs: a title, headings,
// paragraphs with **bold** runs, bullets, numbered items, tick boxes and
// fill-in lines. Output is deterministic (fixed timestamps), so a rebuild
// without content changes produces identical bytes.

import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";

// ---------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { time: 12 << 11, date: ((y - 1980) << 9) | (m << 5) | d };
}

export function zip(files, isoDate) {
  const { time, date } = dosDateTime(isoDate);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const packed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------------------------------------------------------------- docx

// The XML parts come from templates/docx-core.js, which the record builder
// also uses in the browser, so the Word files from the build and from the
// browser are made the same way.
const core = createRequire(import.meta.url)("../templates/docx-core.js");

export function docx(blocks, { title, date, lang }) {
  return zip(core.parts(blocks, { title, date, lang }), date);
}

// The same blocks as Markdown, for the repository.
export function markdown(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case "title": out.push(`# ${b.text}`, ""); break;
      case "h1": out.push(`## ${b.text}`, ""); break;
      case "h2": out.push(`### ${b.text}`, ""); break;
      case "p": out.push(b.text.replaceAll("\t", " "), ""); break;
      case "small": out.push(`_${b.text}_`, ""); break;
      case "bullets": out.push(...b.items.map((i) => `- ${i}`), ""); break;
      case "numbers": out.push(...b.items.map((i, n) => `${n + 1}. ${i}`), ""); break;
      case "checks": out.push(...b.items.map((i) => `- [ ] ${i}`), ""); break;
      case "kv": out.push(`**${b.label}**  \n${b.value}`, ""); break;
      case "field":
        out.push(`**${b.label}**${b.hint ? `  \n_${b.hint}_` : ""}`, "");
        if (b.lines !== 0) out.push("> ", "");
        break;
      default: throw new Error(`unknown block type: ${b.type}`);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
