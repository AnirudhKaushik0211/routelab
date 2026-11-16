'use strict';
// Minimal, reproducible ZIP writer and reader (SPEC 11.2). Node built-ins only.
//   crc32(buf)              CRC-32 (IEEE 802.3) with its own table
//   writeZip(entries)       entries [{name, data}] -> Buffer. Deflate (zlib.deflateRawSync) or stored if that is not
//                           smaller; UTF-8 flag; fixed DOS timestamp 2025-01-01 00:00; forward slashes; no directory
//                           entries; no ZIP64 (refuses more than 65,535 entries or more than 4 GB).
//   readZip(buf)            Buffer -> [{name, method, crc, size, data}] with inflated data; throws on a damaged zip.
// Never uses .NET ZipFile or PowerShell Compress-Archive (backslash entry names on some versions).
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2025 - 1980) << 9) | (1 << 5) | 1; // 2025-01-01
const FLAG_UTF8 = 0x0800;
const MAX_ENTRIES = 65535;
const MAX_BYTES = 0xffffffff;

function writeZip(entries) {
  if (!Array.isArray(entries)) throw new Error('writeZip: entries must be an array');
  if (entries.length > MAX_ENTRIES) throw new Error('writeZip: more than 65,535 entries (ZIP64 is not supported)');
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = String(e.name).replace(/\\/g, '/');
    if (!name || name.endsWith('/')) throw new Error('writeZip: invalid entry name');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    if (data.length > MAX_BYTES) throw new Error('writeZip: entry larger than 4 GB (ZIP64 is not supported)');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(FLAG_UTF8, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(FLAG_UTF8, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attributes
    ch.writeUInt32LE(0, 38); // external attributes
    ch.writeUInt32LE(offset, 42);

    locals.push(lh, nameBuf, body);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
    if (offset > MAX_BYTES) throw new Error('writeZip: archive larger than 4 GB (ZIP64 is not supported)');
  }
  const cd = Buffer.concat(centrals);
  if (offset + cd.length > MAX_BYTES) throw new Error('writeZip: archive larger than 4 GB (ZIP64 is not supported)');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat(locals.concat([cd, end]));
}

function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('readZip: not a zip');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('readZip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (p + cdSize > eocd) throw new Error('readZip: central directory out of range');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('readZip: bad central header');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen > buf.length) throw new Error('readZip: name out of range');
    const name = buf.slice(p + 46, p + 46 + nlen).toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1');
    p += 46 + nlen + xlen + clen;

    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('readZip: bad local header');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new Error('readZip: entry data out of range');
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('readZip: unsupported compression method ' + method);
    if (data.length !== usize) throw new Error('readZip: size mismatch');
    if (crc32(data) !== crc) throw new Error('readZip: CRC mismatch');
    out.push({ name, method, crc, size: usize, data });
  }
  return out;
}

module.exports = { crc32, writeZip, readZip, DOS_DATE, DOS_TIME };
