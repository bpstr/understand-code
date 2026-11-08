/** File-bound evidence. Source is untrusted data and is never executed. */
import fs from 'node:fs';
import path from 'node:path';
import { digest, stable_id } from './ontology.js';

export const SECRET_NAMES = new Set(['.env', '.secrets', 'credentials', 'credentials.json', 'id_rsa', 'id_ed25519']);
export const EXCLUDED = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__',
  'vendor', 'dist', 'build', 'coverage', '.next', '.codebase-memory']);
export function split_lines(text: string): string[] {
  if (!text) return [];
  const result = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (result.at(-1) === '') result.pop();
  return result;
}
export function safe_path(root: string, relative: string): string {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') ||
      path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error(`Unsafe repository path: ${JSON.stringify(relative)}`);
  const parts = relative.split('/').filter(p => p && p !== '.');
  if (!parts.length || parts.some(p => p === '..' || p === '.git')) throw new Error(`Unsafe repository path: ${JSON.stringify(relative)}`);
  const base = path.resolve(root);
  let cursor = base;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink paths are outside the evidence contract: ${relative}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const rel = path.relative(base, cursor);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error(`Path escapes repository: ${relative}`);
  return cursor;
}
export function excluded(filename: string, output: string): boolean {
  return filename === output || filename.startsWith(output.replace(/\/+$/, '') + '/') || filename.split('/').some(p =>
    EXCLUDED.has(p) || SECRET_NAMES.has(p) || p.startsWith('.env.') || p.startsWith('.secrets.') || /\.(pem|key|p12|pfx)$/.test(p));
}
export function read_source(root: string, filename: string, limit = 1_000_000): string {
  const file = safe_path(root, filename);
  if (fs.statSync(file).size > limit) throw new Error(`File exceeds ${limit} byte evidence limit: ${filename}`);
  const data = fs.readFileSync(file);
  if (data.includes(0)) throw new Error(`Binary source: ${filename}`);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
}
export const source_hash = digest;
export function capture(filename: string, text: string, start: number, end: number, commit: string, kind = 'source'): Record<string, any> {
  const lines = split_lines(text);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !(1 <= start && start <= end && end <= lines.length))
    throw new Error(`Invalid evidence range: ${filename}:${start}-${end}`);
  const excerpt = lines.slice(start - 1, end).join('\n');
  return { id: stable_id('evidence', `${filename}:${start}:${end}:${source_hash(text)}:${digest(excerpt)}`), path: filename,
    start_line: start, end_line: end, sha256: source_hash(text), excerpt_sha256: digest(excerpt), commit, kind };
}
export function verify(root: string, record: Record<string, any>, output: string): string | null {
  const filename = record.path ?? '';
  if (excluded(filename, output)) return 'Evidence references excluded/generated material';
  try {
    const text = read_source(root, filename);
    const current = capture(filename, text, record.start_line, record.end_line, record.commit, record.kind);
    if (current.sha256 !== record.sha256 || current.excerpt_sha256 !== record.excerpt_sha256) return 'Source changed since evidence was captured';
    if (current.id !== record.id) return 'Evidence ID does not match its source range';
  } catch (error) { return (error as Error).message; }
  return null;
}
