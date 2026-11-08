import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical_json, pretty_json, digest } from '../lib/understand_code/ontology.js';
import { load, run, lock } from '../lib/understand_code/orchestrator.js';
import { capture, read_source, safe_path, split_lines } from '../lib/understand_code/evidence.js';
import { inventory } from '../lib/understand_code/discovery.js';
import { verify } from '../lib/understand_code/spec/verifier.js';
import { check } from '../lib/understand_code/contracts.js';
import { EngineFixture, FIXTURES, OUT } from './helpers.mjs';

test('canonical JSON preserves identities recorded by the previous Python engine', () => {
  const values = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'migration/v1-identities.json'), 'utf8'));
  for (const entry of values) {
    assert.equal(canonical_json(entry.value), entry.spaced);
    assert.equal(canonical_json(entry.value, true), entry.compact);
    assert.equal(pretty_json(entry.value), entry.pretty);
    assert.equal(digest(canonical_json(entry.value)), entry.sha256);
  }
});

test('a Python-produced saved spec loads, verifies, and updates with stable claims and human notes', t => {
  const source = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'migration/v1-state.json'), 'utf8'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'understand-code-v1-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const [filename, text] of Object.entries(source.source_files)) {
    const file = path.join(temp, filename); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  for (const [filename, text] of Object.entries(source.spec_files)) {
    const file = path.join(temp, OUT, filename); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  const old = load(temp, OUT);
  assert.equal(old.manifest.version, '1.0.0');
  assert.equal(old.manifest.snapshot, source.expected.snapshot);
  assert.deepEqual(old.evidence, source.expected.evidence);
  assert.equal(verify(temp, OUT, old, inventory(temp, OUT)).ok, true);
  run(temp, OUT, 'update');
  const next = load(temp, OUT);
  assert.equal(next.manifest.version, '2.0.0');
  assert.equal(next.manifest.snapshot, source.expected.snapshot);
  assert.deepEqual(next.entities.find(e => e.id === 'feature.checkout'), source.expected.feature);
  assert.match(fs.readFileSync(path.join(temp, OUT, 'overview.md'), 'utf8'), /Maintainer migration fixture: retain this note/);
  assert.equal(verify(temp, OUT, next, inventory(temp, OUT)).ok, true);
  for (const [filename, text] of Object.entries(source.source_files)) assert.equal(read_source(temp, filename), text);
});

test('line endings, UTF-8 bytes and Unicode source excerpts retain exact identities', () => {
  const source = '\ufeffárvíztűrő\r\n🧭\u2028end\n';
  assert.deepEqual(split_lines(source), ['\ufeffárvíztűrő', '🧭', 'end']);
  const ref = capture('src/ü.ts', source, 1, 2, 'uncommitted');
  assert.equal(ref.sha256, digest(source));
  assert.equal(ref.excerpt_sha256, digest('\ufeffárvíztűrő\n🧭'));
  for (const range of [[0, 1], [2, 1], [1, 4], [1.5, 2], [true, 2]]) assert.throws(() => capture('x', source, ...range, 'uncommitted'), /Invalid evidence range/);
});

test('source reads reject malformed UTF-8, binary bytes and symlink traversal', t => {
  const f = new EngineFixture(t);
  f.write('invalid.ts', Buffer.from([0xc3, 0x28]));
  f.write('binary.ts', Buffer.from([0x61, 0, 0x62]));
  assert.throws(() => read_source(f.root, 'invalid.ts'));
  assert.throws(() => read_source(f.root, 'binary.ts'), /Binary/);
  for (const filename of ['../escape', '/absolute', 'C:/escape', 'x\\y', '.git/config', '.', '']) assert.throws(() => safe_path(f.root, filename), /Unsafe/);
  const inv = inventory(f.root, OUT);
  assert.equal(inv.files['invalid.ts'], undefined); assert.equal(inv.files['binary.ts'], undefined);
});

test('Node module suffixes are discovered and Python declarations remain explicit heuristic candidates', t => {
  const f = new EngineFixture(t);
  f.write('extra.mts', 'export const value: number = 1;\n');
  f.write('extra.cjs', 'module.exports = 1;\n');
  const inv = inventory(f.root, OUT);
  assert.equal(inv.files['extra.mts'].language, 'TypeScript');
  assert.equal(inv.files['extra.cjs'].language, 'JavaScript');
  const python = inv.candidates.filter(c => c.kind === 'symbol' && c.path.endsWith('.py'));
  assert.ok(python.length > 0); assert.ok(python.every(c => c.confidence === 'INFERRED'));
  assert.ok(inv.analysis_notes.some(l => l.reason.includes('no Python runtime')));
});

test('closed contracts count Unicode code points and reject non-integral or unsafe integers', () => {
  check('🧭', { type: 'string', minLength: 1, maxLength: 1 });
  for (const value of [true, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => check(value, { type: 'integer' }), /expected integer/);
  assert.throws(() => check(JSON.parse('{"__proto__": "not allowed"}'), { type: 'object', additionalProperties: false }), /unsupported field/);
});

test('exclusive write locks are retained across contention and released after failure', t => {
  const f = new EngineFixture(t);
  assert.throws(() => lock(f.root, OUT, () => lock(f.root, OUT, () => null)), /Another writer/);
  assert.throws(() => lock(f.root, OUT, () => { throw new Error('prepared abort'); }), /prepared abort/);
  assert.equal(lock(f.root, OUT, () => 7), 7);
});
