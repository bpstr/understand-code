/** Small deterministic release-archive helpers. No external archiver or Python is used. */
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync, inflateRawSync, gunzipSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safeName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name) ||
      name.split('/').some(part => part === '..' || part === '.')) throw new Error(`Unsafe archive path: ${name}`);
  return name;
}

export function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Archive input may not be a symlink: ${file}`);
    return entry.isDirectory() ? walkFiles(file) : entry.isFile() ? [file] : [];
  });
}

/** ZIP entries use fixed timestamps, stable order, UTF-8 names and regular-file modes. */
export function createZip(entries) {
  const local = [], central = [], names = new Set();
  let offset = 0;
  for (const entry of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = Buffer.from(safeName(entry.name));
    if (names.has(entry.name)) throw new Error(`Duplicate archive path: ${entry.name}`);
    names.add(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    if (name.length > 0xffff || data.length > 0xffffffff || compressed.length > 0xffffffff) throw new Error('ZIP64 is not supported');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE((46 << 9) | (1 << 5) | 1, 12); // 2026-01-01 00:00:00, independent of timezone.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE((3 << 8) | 20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  if (names.size > 0xffff || offset + directory.length > 0xffffffff) throw new Error('ZIP64 is not supported');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.size, 8); end.writeUInt16LE(names.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** Read the bounded ZIP format emitted above, validating content and traversal before extraction. */
export function readZip(data) {
  const end = data.length - 22;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50 || data.readUInt16LE(end + 20) !== 0) throw new Error('Invalid ZIP footer');
  const count = data.readUInt16LE(end + 10), directorySize = data.readUInt32LE(end + 12);
  let cursor = data.readUInt32LE(end + 16);
  if (cursor + directorySize !== end || data.readUInt16LE(end + 8) !== count) throw new Error('Invalid ZIP directory');
  const entries = [], names = new Set();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const method = data.readUInt16LE(cursor + 10), flags = data.readUInt16LE(cursor + 8);
    const crc = data.readUInt32LE(cursor + 16), compressed = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24);
    const length = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
    const mode = data.readUInt32LE(cursor + 38) >>> 16, offset = data.readUInt32LE(cursor + 42);
    const name = safeName(data.subarray(cursor + 46, cursor + 46 + length).toString('utf8'));
    if (flags !== 0x0800 || method !== 8 || (mode & 0o170000) !== 0o100000 || names.has(name)) throw new Error(`Unsupported ZIP entry: ${name}`);
    if (offset + 30 > data.length || data.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid local ZIP header');
    const start = offset + 30 + data.readUInt16LE(offset + 26) + data.readUInt16LE(offset + 28);
    if (start + compressed > data.readUInt32LE(end + 16)) throw new Error('ZIP content overlaps directory');
    const content = inflateRawSync(data.subarray(start, start + compressed), { maxOutputLength: 10_000_000 });
    if (content.length !== size || crc32(content) !== crc) throw new Error(`ZIP content checksum mismatch: ${name}`);
    names.add(name); entries.push({ name, data: content, mode });
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end) throw new Error('Unexpected trailing ZIP directory data');
  return entries;
}

export function extractEntries(entries, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const { name, data, mode } of entries) {
    const file = path.join(destination, safeName(name));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { flag: 'wx', mode: mode & 0o777 });
  }
}

/** Read regular npm package files from a gzip-compressed ustar/PAX archive. */
export function readTarGz(archive) {
  const data = gunzipSync(archive, { maxOutputLength: 50_000_000 });
  const entries = [], names = new Set();
  let cursor = 0, pax = {};
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  const number = (header, start, length) => {
    const text = field(header, start, length).trim();
    if (text && !/^[0-7]+$/.test(text)) throw new Error('Invalid tar number');
    return text ? Number.parseInt(text, 8) : 0;
  };
  while (cursor + 512 <= data.length) {
    const header = data.subarray(cursor, cursor + 512);
    if (header.every(byte => byte === 0)) break;
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (number(header, 148, 8) !== sum) throw new Error('Invalid tar header checksum');
    const size = number(header, 124, 12), mode = number(header, 100, 8), type = String.fromCharCode(header[156]);
    const prefix = field(header, 345, 155);
    let name = field(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const start = cursor + 512;
    if (start + size > data.length) throw new Error('Truncated tar entry');
    const content = data.subarray(start, start + size);
    cursor = start + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      let position = 0;
      while (position < content.length) {
        const space = content.indexOf(32, position), length = Number(content.subarray(position, space).toString());
        if (space < 0 || !Number.isSafeInteger(length) || length <= 0 || position + length > content.length) throw new Error('Invalid PAX metadata');
        const pair = content.subarray(space + 1, position + length - 1).toString('utf8'), equals = pair.indexOf('=');
        if (equals < 1) throw new Error('Invalid PAX field');
        if (pair.slice(0, equals) === 'path') pax.path = pair.slice(equals + 1);
        position += length;
      }
      continue;
    }
    name = safeName(pax.path ?? name); pax = {};
    if (type === '5') continue;
    if (type !== '0' && type !== '\0') throw new Error(`Unsupported tar entry: ${name}`);
    if (names.has(name)) throw new Error(`Duplicate tar entry: ${name}`);
    names.add(name); entries.push({ name, data: content, mode });
  }
  return entries;
}
