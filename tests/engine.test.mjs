/** Offline engine regressions ported from v1. No fixture/application execution. */
import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EngineFixture, OUT, snapshot_files } from './helpers.mjs';
import { main, parser } from '../lib/understand_code/cli.js';
import { inventory } from '../lib/understand_code/discovery.js';
import { read_source, safe_path } from '../lib/understand_code/evidence.js';
import { validate, reconcile } from '../lib/understand_code/findings.js';
import { changes, isolate } from '../lib/understand_code/git.js';
import { run } from '../lib/understand_code/orchestrator.js';
import { verify } from '../lib/understand_code/spec/verifier.js';

function silent(t, action) {
  const stdout = t.mock.method(console, 'log', () => {});
  const stderr = t.mock.method(console, 'error', () => {});
  try { return action(); } finally { stdout.mock.restore(); stderr.mock.restore(); }
}

test('bootstrap changes documentation only and makes no invented product claims', t => {
  const f = new EngineFixture(t);
  const before = snapshot_files(f.root);
  const result = f.bootstrap();
  assert.ok(result.coverage.pending_tasks > 0);
  const after = snapshot_files(f.root);
  for (const [filename, contents] of Object.entries(before)) assert.equal(after[filename], contents);
  assert.ok(!f.state().entities.some(entity => entity.kind === 'feature'));
});

test('prepared cross-layer findings preserve source links, relations and explicit gaps', t => {
  const f = new EngineFixture(t);
  f.bootstrap(); f.apply(f.prepared());
  const state = f.state();
  assert.ok(state.entities.some(entity => entity.id === 'feature.checkout'));
  assert.equal(state.relations[0].kind, 'affects');
  assert.ok(verify(f.root, OUT, state, inventory(f.root, OUT)).ok);
  const document = f.read(OUT + '/features/feature.checkout.md');
  assert.ok(document.includes('checkout.py'));
  assert.ok(!document.includes('always enabled'));
  assert.ok(state.gaps.some(gap => gap.id === 'knowledge_gap.http-binding'));
});

test('fabricated source hashes reject findings without output mutation', t => {
  const f = new EngineFixture(t);
  f.bootstrap();
  const before = f.read(OUT + '/_meta/manifest.json');
  const bundle = f.prepared(); bundle.evidence[0].sha256 = '0'.repeat(64);
  assert.throws(() => f.apply(bundle), /Evidence rejected/);
  assert.equal(f.read(OUT + '/_meta/manifest.json'), before);
});

test('missing citations and false corroboration fail ingestion', t => {
  const f = new EngineFixture(t); f.bootstrap();
  for (const refs of [[], ['fake'], [f.prepared().evidence[0].id]]) {
    const bundle = f.prepared(); bundle.entities[0].evidence = refs;
    assert.throws(() => f.apply(bundle));
  }
});

test('unreviewed claims cannot be promoted to established facts', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared(); bundle.review = { status: 'unreviewed' };
  assert.throws(() => f.apply(bundle), /source review/);
});

test('empty native response does not complete an investigation', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared();
  for (const key of ['entities', 'relations', 'gaps']) bundle[key] = [];
  assert.throws(() => f.apply(bundle), /empty response/);
});

test('relations with unknown endpoints are rejected', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared(); bundle.relations[0].target = 'feature.imaginary';
  assert.throws(() => f.apply(bundle), /endpoints/);
});

test('findings from a stale task snapshot fail before publication', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared();
  f.write('checkout.py', 'def checkout(): return False\n');
  assert.throws(() => f.apply(bundle), /Source changed/);
});

test('source updates quarantine claims and preserve original evidence identities', t => {
  const f = new EngineFixture(t); f.bootstrap(); f.apply(f.prepared());
  const old = f.state().entities.find(entity => entity.id === 'feature.checkout');
  f.write('checkout.py', read_source(f.root, 'checkout.py') + '\n# changed\n');
  f.run('update');
  const current = f.state().entities.find(entity => entity.id === 'feature.checkout');
  assert.deepEqual(current.evidence, old.evidence);
  assert.equal(current.confidence, 'UNKNOWN');
  assert.ok(current.stale);
  assert.equal(verify(f.root, OUT, f.state(), inventory(f.root, OUT)).ok, false);
});

test('maintainer notes survive regeneration and reach bounded native tasks', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const filename = OUT + '/overview.md';
  f.write(filename, f.read(filename) + '\nMaintainer: HTTP adapter is external.\n');
  f.run('update');
  assert.ok(f.read(filename).includes('HTTP adapter is external'));
  assert.ok(f.state().plan.tasks[0].maintainer_notes.length);
});

test('editing a generated region blocks the complete engine write', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const filename = OUT + '/overview.md';
  f.write(filename, f.read(filename).replace('Scanned', 'Human changed this: Scanned'));
  const before = snapshot_files(path.join(f.root, OUT));
  assert.throws(() => f.run('update'), /Generated region edited/);
  assert.deepEqual(snapshot_files(path.join(f.root, OUT)), before);
});

test('unmanaged output directories are not overwritten during bootstrap', t => {
  const f = new EngineFixture(t);
  f.write(OUT + '/README.md', 'Human knowledge');
  assert.throws(() => f.bootstrap(), /without an Understand Code manifest/);
  assert.equal(f.read(OUT + '/README.md'), 'Human knowledge');
});

test('source inventory excludes secret names and symlinks', t => {
  const f = new EngineFixture(t);
  f.write('.secrets', 'PREPARED_SENTINEL_NEVER_READ');
  f.write('.env.production', 'PREPARED_SENTINEL_NEVER_READ');
  fs.symlinkSync(path.join(f.temp, 'missing'), path.join(f.root, 'outside.py'));
  const inv = inventory(f.root, OUT);
  for (const filename of ['.secrets', '.env.production', 'outside.py']) assert.ok(!Object.hasOwn(inv.files, filename));
  assert.throws(() => safe_path(f.root, '../escape'));
});

test('repository ignore rules preserve fnmatch closing-bracket and exact-end semantics', t => {
  const f = new EngineFixture(t);
  f.write('.understand-codeignore', '[]]literal.ts\n[!]]other.ts\nexact.ts\n');
  for (const filename of [']literal.ts', 'aother.ts', ']other.ts', 'exact.ts', 'exact.ts\n']) {
    f.write(filename, 'export const prepared = true;\n');
  }
  const inv = inventory(f.root, OUT);
  for (const filename of [']literal.ts', 'aother.ts', 'exact.ts']) {
    assert.ok(!Object.hasOwn(inv.files, filename), `Ignored path was read: ${JSON.stringify(filename)}`);
    assert.ok(inv.ignored.some(item => item.path === filename));
  }
  for (const filename of [']other.ts', 'exact.ts\n']) assert.ok(Object.hasOwn(inv.files, filename));
});

test('symlinked output parents are rejected', t => {
  const f = new EngineFixture(t);
  fs.symlinkSync(f.temp, path.join(f.root, 'docs'), 'dir');
  assert.throws(() => f.bootstrap(), /Symlink/);
});

test('scan budget shortfalls remain visible', t => {
  const f = new EngineFixture(t);
  const result = f.bootstrap({ max_files: 1 });
  assert.ok(result.coverage.skipped > 0);
});

test('legal prototype-like filenames and directories remain in the source inventory', t => {
  const f = new EngineFixture(t);
  f.write('__proto__', 'Prepared source text\n');
  f.write('constructor/a.ts', 'export const prepared = true;\n');
  f.write('toString/b.ts', 'export const other = true;\n');
  const inv = inventory(f.root, OUT);
  assert.ok(Object.hasOwn(inv.files, '__proto__'));
  assert.ok(Object.hasOwn(inv.files, 'constructor/a.ts'));
  f.bootstrap();
  const state = f.state();
  assert.ok(state.entities.some(entity => entity.title === 'constructor'));
  assert.ok(state.entities.some(entity => entity.title === 'toString'));
  assert.ok(verify(f.root, OUT, state, inventory(f.root, OUT)).ok);
});

test('no-op updates retain pending tasks and generated content', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const before = f.state().plan;
  const document = f.read(OUT + '/overview.md');
  f.run('update');
  assert.equal(f.state().plan.tasks.length, before.tasks.length);
  assert.equal(f.read(OUT + '/overview.md'), document);
});

test('focused investigations retain wider unfinished scope and unresolved-topic discovery', t => {
  const f = new EngineFixture(t); f.bootstrap();
  f.run('focus', { focus: 'checkout' });
  assert.ok(f.state().plan.deferred.length);
  f.run('focus', { focus: 'nonexistenttopic' });
  assert.ok(f.state().plan.tasks.length);
  assert.ok(f.state().plan.scope_resolution.frontier.some(gap => gap.id === 'concept-resolution'));
});

test('conflicting findings become unknown with retained alternatives', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared(); f.apply(bundle);
  bundle.entities[0].summary = 'Contradictory interpretation for fixture testing.';
  f.apply(bundle);
  const state = f.state();
  assert.equal(state.entities.find(entity => entity.id === 'feature.checkout').confidence, 'UNKNOWN');
  assert.ok(state.gaps.some(gap => gap.alternatives?.length));
});

test('bootstrap stays tool-agnostic and rejects removed graph flags', t => {
  const f = new EngineFixture(t);
  const result = f.bootstrap();
  const state = f.state();
  assert.ok(!Object.hasOwn(state.manifest, 'graph_status'));
  assert.ok(state.manifest.code_intelligence.includes('host-managed'));
  assert.ok(!JSON.stringify(state.plan).includes('graph_context'));
  assert.ok(!JSON.stringify(result).toLowerCase().includes('graphify'));
  assert.ok(!state.gaps.some(gap => gap.id === 'knowledge_gap.graphify'));
  for (const command of ['bootstrap', 'focus', 'update', 'apply']) {
    assert.throws(() => parser().parse_args([command, '--graph', 'old-export.json']), /graph/);
    assert.equal(silent(t, () => main([command, '--graph', 'old-export.json'])), 2);
  }
});

test('Git diff preserves renames with whitespace and unstaged edits', t => {
  const f = new EngineFixture(t); f.init_git();
  f.git('mv', 'ui.tsx', 'new ui.tsx');
  f.write('checkout.py', read_source(f.root, 'checkout.py') + '\n# change\n');
  const diff = changes(f.root, 'HEAD');
  assert.ok(diff.some(item => item.old_path === 'ui.tsx' && item.path === 'new ui.tsx'));
  assert.ok(diff.some(item => item.path === 'checkout.py'));
});

test('isolated worktree output leaves the original checkout clean', t => {
  const f = new EngineFixture(t); f.init_git();
  const worktree = isolate(f.root);
  run(worktree, OUT, 'bootstrap');
  assert.ok(!fs.existsSync(path.join(f.root, OUT)));
  assert.equal(f.git('status', '--porcelain'), '');
});

test('CLI verification distinguishes integrity and coverage exit status', t => {
  const f = new EngineFixture(t); f.bootstrap();
  silent(t, () => {
    assert.equal(main(['verify', '--repo', f.root]), 0);
    assert.equal(main(['verify', '--repo', f.root, '--require-complete']), 1);
    fs.unlinkSync(path.join(f.root, 'checkout.py'));
    assert.equal(main(['verify', '--repo', f.root]), 1);
  });
});

test('false commits and task-external evidence fail ingestion', t => {
  const f = new EngineFixture(t); f.bootstrap();
  let bundle = f.prepared(); bundle.evidence[0].commit = 'made-up-commit';
  assert.throws(() => f.apply(bundle), /commit/);
  bundle = f.prepared();
  const state = f.state();
  const task = state.plan.tasks.find(task => task.id === bundle.task_id);
  task.paths = ['settings.py'];
  assert.throws(() => validate(bundle, f.root, OUT, task, state.entities), /outside task scope/);
});

test('closed findings contracts reject executable or unknown fields', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared(); bundle.entities[0].execute = 'untrusted command';
  assert.throws(() => f.apply(bundle), /unsupported field/);
});

test('tampered metadata fails integrity checks', t => {
  const f = new EngineFixture(t); f.bootstrap();
  f.write(OUT + '/_meta/entities.jsonl', '');
  assert.throws(() => f.state(), /integrity/);
});

test('explicit source-reviewed replacement can resolve a retained conflict', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const original = f.prepared(); f.apply(original);
  const conflicting = structuredClone(original);
  conflicting.entities[0].summary = 'A deliberately conflicting prepared claim.';
  f.apply(conflicting);
  original.entities[0].supersedes = 'feature.checkout';
  f.apply(original);
  const state = f.state();
  const entity = state.entities.find(entity => entity.id === 'feature.checkout');
  assert.equal(entity.confidence, 'CORROBORATED');
  assert.ok(!entity.conflict);
  assert.ok(!state.gaps.some(gap => gap.alternatives?.length));
});

test('reviewed supersession replaces a changed interpretation of a stale claim', t => {
  const f = new EngineFixture(t); f.bootstrap();
  const bundle = f.prepared();
  const [entities, relations] = reconcile([], [], [bundle]);
  entities[0].stale = true;
  bundle.entities[0].summary = 'New interpretation after a source change.';
  bundle.entities[0].supersedes = 'feature.checkout';
  const [updated, , gaps] = reconcile(entities, relations, [bundle]);
  assert.ok(!updated[0].stale);
  assert.ok(!gaps.some(gap => gap.alternatives?.length));
});
