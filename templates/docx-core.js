// Word (.docx) parts from simple blocks. Shared by the build (Node, which
// compresses) and the record builder in the browser (which stores without
// compression, so it needs no library). No network, no storage.
//
// Blocks: title, h1, h2, p, small, bullets, numbers, checks, field, kv.
// Text may contain **bold** runs and tab characters.
(function (root) {
  "use strict";

  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function runs(text) {
    return String(text)
      .split(/(\*\*[^*]+\*\*)/)
      .filter(Boolean)
      .map(function (part) {
        var bold = part.slice(0, 2) === "**" && part.slice(-2) === "**";
        var t = bold ? part.slice(2, -2) : part;
        var inner = t
          .split("\t")
          .map(function (p, i) { return (i ? "<w:tab/>" : "") + '<w:t xml:space="preserve">' + xmlEsc(p) + "</w:t>"; })
          .join("");
        return "<w:r>" + (bold ? "<w:rPr><w:b/></w:rPr>" : "") + inner + "</w:r>";
      })
      .join("");
  }

  function para(text, o) {
    o = o || {};
    var props = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : "") +
      (o.keepNext ? "<w:keepNext/>" : "") +
      (o.indent ? '<w:ind w:left="' + o.indent + '" w:hanging="300"/>' : "");
    return "<w:p>" + (props ? "<w:pPr>" + props + "</w:pPr>" : "") + runs(text) + "</w:p>";
  }

  function line(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += para(new Array(61).join("_"));
    return out;
  }

  function blockXml(b) {
    switch (b.type) {
      case "title": return para(b.text, { style: "Title" });
      case "h1": return para(b.text, { style: "Heading1", keepNext: true });
      case "h2": return para(b.text, { style: "Heading2", keepNext: true });
      case "p": return para(b.text);
      case "small": return para(b.text, { style: "Small" });
      case "bullets": return b.items.map(function (i) { return para("•\t" + i, { indent: 300 }); }).join("");
      case "numbers": return b.items.map(function (i, n) { return para((n + 1) + ".\t" + i, { indent: 300 }); }).join("");
      case "checks": return b.items.map(function (i) { return para("☐\t" + i, { indent: 300 }); }).join("");
      case "field":
        return para("**" + b.label + "**", { keepNext: true }) + (b.hint ? para(b.hint, { style: "Small" }) : "") + line(b.lines == null ? 1 : b.lines);
      case "kv":
        return para("**" + b.label + "**", { keepNext: true }) + para(b.value);
      default: throw new Error("unknown docx block type: " + b.type);
    }
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="1F2937"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="1F2937"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="555555"/></w:rPr></w:style>' +
    "</w:styles>";

  // The six parts of a minimal Word document, as text.
  function parts(blocks, meta) {
    var body = blocks.map(blockXml).join("");
    var date = meta.date;
    return [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: "docProps/core.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xmlEsc(meta.title) + '</dc:title><dc:creator>Noxiom</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + date + 'T12:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + date + "T12:00:00Z</dcterms:modified></cp:coreProperties>" },
      { name: "word/_rels/document.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: "word/document.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>' },
      { name: "word/styles.xml", data: STYLES }
    ];
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, "utf8"));
  }

  // A zip with stored (uncompressed) entries: valid for Word, no library needed.
  function zipStored(files, isoDate) {
    var ymd = isoDate.split("-").map(Number);
    var time = 12 << 11;
    var date = ((ymd[0] - 1980) << 9) | (ymd[1] << 5) | ymd[2];
    var entries = files.map(function (f) {
      var data = typeof f.data === "string" ? utf8(f.data) : f.data;
      return { name: utf8(f.name), data: data, crc: crc32(data) };
    });
    var size = 22;
    entries.forEach(function (e) { size += 30 + e.name.length + e.data.length + 46 + e.name.length; });
    var out = new Uint8Array(size);
    var view = new DataView(out.buffer);
    var p = 0;
    var central = [];
    entries.forEach(function (e) {
      var offset = p;
      view.setUint32(p, 0x04034b50, true); view.setUint16(p + 4, 20, true); view.setUint16(p + 6, 0x0800, true);
      view.setUint16(p + 8, 0, true); view.setUint16(p + 10, time, true); view.setUint16(p + 12, date, true);
      view.setUint32(p + 14, e.crc, true); view.setUint32(p + 18, e.data.length, true); view.setUint32(p + 22, e.data.length, true);
      view.setUint16(p + 26, e.name.length, true); view.setUint16(p + 28, 0, true);
      out.set(e.name, p + 30); out.set(e.data, p + 30 + e.name.length);
      p += 30 + e.name.length + e.data.length;
      central.push({ e: e, offset: offset });
    });
    var cdStart = p;
    central.forEach(function (c) {
      var e = c.e;
      view.setUint32(p, 0x02014b50, true); view.setUint16(p + 4, 20, true); view.setUint16(p + 6, 20, true);
      view.setUint16(p + 8, 0x0800, true); view.setUint16(p + 10, 0, true); view.setUint16(p + 12, time, true);
      view.setUint16(p + 14, date, true); view.setUint32(p + 16, e.crc, true); view.setUint32(p + 20, e.data.length, true);
      view.setUint32(p + 24, e.data.length, true); view.setUint16(p + 28, e.name.length, true);
      view.setUint32(p + 42, c.offset, true);
      out.set(e.name, p + 46);
      p += 46 + e.name.length;
    });
    view.setUint32(p, 0x06054b50, true); view.setUint16(p + 8, entries.length, true); view.setUint16(p + 10, entries.length, true);
    view.setUint32(p + 12, p - cdStart, true); view.setUint32(p + 16, cdStart, true);
    return out;
  }

  var api = { parts: parts, blockXml: blockXml, crc32: crc32, zipStored: zipStored };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DocxCore = api;
})(this);
