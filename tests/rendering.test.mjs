/** Prepared local contracts for readable documents, bounded plans and atomic publication. */
import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { START, END, HUMAN, page, generated, split_generated, append_generated, source_link, write, render, json_text, jsonl } from '../lib/understand_code/spec/writer.js';
import { prose, table, fenced_example, render_documents, assess_documents } from '../lib/understand_code/spec/documentation.js';
import { balanced_paths, plan, schedule_followups, task_for, ROLES } from '../lib/understand_code/spec/planner.js';
import { audit } from '../lib/understand_code/audit.js';
import { analyze } from '../lib/understand_code/impact.js';
import { render as prompt } from '../lib/understand_code/providers/index.js';
import { canonical_json, digest } from '../lib/understand_code/ontology.js';

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'understand-code-rendering-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function contents(root) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isSymbolicLink()) result[path.relative(root, filename)] = 'symlink:' + fs.readlinkSync(filename);
      else result[path.relative(root, filename)] = fs.readFileSync(filename).toString('base64');
    }
  }
  visit(root);
  return result;
}
function publish(output, docs, metadata = { '_meta/state.json': '{"prepared":true}\n' }) {
  const manifest = { producer: 'understand-code', schema_version: 1, managed: {} };
  write(output, docs, metadata, manifest);
  return manifest;
}
function inventory(paths) {
  return { commit: 'prepared-commit', files: Object.fromEntries(paths.map(filename => [filename,
    { sha256: digest(filename), bytes: 1, lines: 1, kind: 'source', language: 'TypeScript', evidence: 'evidence.' + filename,
      instruction: false, manifest: false }])),
  candidates: [], skipped: [], ignored: [], deleted: [], limitations: [], evidence: [], languages: { TypeScript: paths.length },
  bytes_read: paths.length, discovery_policy: 'surface-roster-v1' };
}

test('literal examples preserve indentation, markup and embedded ownership markers', () => {
  const code = `function sample() {\n    return '<tag> & value';\n}\n${START}\n\`\`\`\n${END}\n`;
  const fenced = fenced_example({ language: 'javascript', code });
  assert.ok(fenced.startsWith('````javascript\n'));
  assert.ok(fenced.includes(code));
  const document = page('Literal example', fenced);
  assert.equal(generated(document), document.slice(0, document.lastIndexOf(END) + END.length));
  assert.equal(split_generated(document)[1], HUMAN);
  assert.ok(append_generated(document, '\nExtra provenance\n').includes(code));
});

test('managed markers in CRLF and indented tilde fences do not consume human notes', () => {
  const document = `${START}\r\n# Fixture\r\n   ~~~~text\r\n${END}\r\n${START}\r\n   ~~~~\r\n${END}\r\nHuman 😀 notes\r\n`;
  const [generatedPart, notes] = split_generated(document);
  assert.ok(generatedPart.endsWith(END));
  assert.equal(notes, '\r\nHuman 😀 notes\r\n');
  for (const corrupted of [document + END, END + START, START + '\n```\n' + END, 'no markers']) {
    assert.throws(() => split_generated(corrupted), /markers/);
  }
});

test('source links encode syntax characters and traverse relative to each page', () => {
  assert.equal(source_link('documents/doc.api.md', 'docs/codebase', { path: "src/a (b)!'é.ts", start_line: 3, end_line: 7 }),
    "[src/a (b)!'é.ts:3](../../../src/a%20%28b%29%21%27%C3%A9.ts#L3-L7)");
});

test('structured prose keeps paragraphs while escaping Markdown and table payloads', () => {
  assert.equal(prose('First <script> & **claim**\r\n\r\n1. pretend step\nwrapped'),
    'First &lt;script&gt; &amp; \\*\\*claim\\*\\*\n\n1\\. pretend step wrapped');
  assert.equal(prose('- hidden list\n\n$secret~'), '\\- hidden list\n\n\\$secret\\~');
  const result = table(['Input', 'Effect'], [['x|y', '[open](javascript:bad)\nnew']]);
  assert.ok(result.includes('x\\|y'));
  assert.ok(result.includes('\\[open\\](javascript:bad) new'));
  assert.equal(result.split('\n').length, 5);
});

test('persisted metadata JSON keeps version-one key sorting and ASCII escaping', () => {
  const value = { z: ['é', '😀'], a: { '2': 'two', '10': 'ten' } };
  assert.equal(jsonl([value]), '{"a": {"10": "ten", "2": "two"}, "z": ["\\u00e9", "\\ud83d\\ude00"]}\n');
  assert.equal(json_text(value), '{\n  "a": {\n    "10": "ten",\n    "2": "two"\n  },\n  "z": [\n    "\\u00e9",\n    "\\ud83d\\ude00"\n  ]\n}\n');
});

test('publication preserves exact maintainer notes, unmanaged files and retired pages', t => {
  const root = temporary(t);
  const output = path.join(root, 'docs');
  publish(output, { 'README.md': page('Prepared', 'Initial body'), 'documents/doc.old.md': page('Old', 'Historical body') });
  const notes = '\nMaintainer: preserve whitespace.  \n```html\n' + START + '\n' + END + '\n```\n';
  fs.appendFileSync(path.join(output, 'README.md'), notes);
  fs.appendFileSync(path.join(output, 'documents/doc.old.md'), '\nRetired note\n');
  fs.writeFileSync(path.join(output, 'manual.txt'), Buffer.from([0, 1, 255]));
  const manifest = publish(output, { 'README.md': page('Prepared', 'Replacement body') });
  const result = fs.readFileSync(path.join(output, 'README.md'), 'utf8');
  assert.ok(result.includes('Replacement body'));
  assert.equal(split_generated(result)[1], HUMAN + notes);
  assert.equal(fs.readFileSync(path.join(output, 'manual.txt')).toString('hex'), '0001ff');
  const retired = fs.readFileSync(path.join(output, 'documents/doc.old.md'), 'utf8');
  assert.ok(retired.includes('Retired concept'));
  assert.ok(retired.endsWith('Retired note\n'));
  assert.equal(manifest.managed['documents/doc.old.md'], digest(generated(retired)));
  assert.deepEqual(fs.readdirSync(root), ['docs']);
});

test('generated edits reject the entire write before any output changes', t => {
  const root = temporary(t);
  const output = path.join(root, 'docs');
  publish(output, { 'README.md': page('Prepared', 'First'), 'overview.md': page('Overview', 'Second') });
  fs.writeFileSync(path.join(output, 'overview.md'), page('Overview', 'Manual generated edit'));
  const before = contents(root);
  assert.throws(() => publish(output, { 'README.md': page('Prepared', 'Would replace') }), /Generated region edited/);
  assert.deepEqual(contents(root), before);
});

test('unmanaged output directories and unmanaged document collisions remain intact', t => {
  const root = temporary(t);
  const output = path.join(root, 'docs');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'README.md'), 'Human knowledge');
  assert.throws(() => publish(output, { 'README.md': page('Would replace', 'No') }), /without an Understand Code manifest/);
  assert.equal(fs.readFileSync(path.join(output, 'README.md'), 'utf8'), 'Human knowledge');
  fs.rmSync(output, { recursive: true });
  publish(output, { 'README.md': page('Prepared', 'Body') });
  fs.writeFileSync(path.join(output, 'manual.md'), 'Unmanaged file');
  const before = contents(root);
  assert.throws(() => publish(output, { 'README.md': page('Changed', 'Body'), 'manual.md': page('Collision', 'No') }), /Unmanaged document/);
  assert.deepEqual(contents(root), before);
});

test('output symlinks and traversal filenames are rejected before writes', t => {
  const root = temporary(t);
  const output = path.join(root, 'docs');
  publish(output, { 'README.md': page('Prepared', 'Body') });
  const before = contents(root);
  assert.throws(() => publish(output, { '../escape.md': page('Escape', 'No') }), /Unsafe repository path/);
  assert.throws(() => publish(output, { 'README.md': page('Prepared', 'Body') }, { '/absolute.json': '{}' }), /Unsafe repository path/);
  assert.deepEqual(contents(root), before);
  fs.symlinkSync(path.join(root, 'missing'), path.join(output, 'dangling'));
  assert.throws(() => publish(output, { 'README.md': page('Prepared', 'Body') }), /Symlink/);
  fs.symlinkSync(output, path.join(root, 'alias'), 'dir');
  assert.throws(() => publish(path.join(root, 'alias'), { 'README.md': page('Prepared', 'Body') }), /Symlink/);
});

test('failed directory publication restores previous bytes and cleans the stage', t => {
  const root = temporary(t);
  const output = path.join(root, 'docs');
  publish(output, { 'README.md': page('Prepared', 'Before') });
  const before = contents(root);
  const rename = fs.renameSync;
  const mocked = t.mock.method(fs, 'renameSync', (from, to) => {
    if (path.basename(from).startsWith('.understand-code-stage-') && !from.endsWith('-backup')) {
      throw new Error('Prepared filesystem publication failure');
    }
    return rename(from, to);
  });
  assert.throws(() => publish(output, { 'README.md': page('Prepared', 'After') }), /Prepared filesystem publication failure/);
  mocked.mock.restore();
  assert.deepEqual(contents(root), before);
  assert.deepEqual(fs.readdirSync(root), ['docs']);
});

test('balanced reconnaissance reaches late nested packages without losing or duplicating paths', () => {
  const paths = [...Array.from({ length: 80 }, (_, index) => `packages/aaa/parts/${index}.ts`),
    'packages/zzz/webhook.ts', 'README.md'];
  const balanced = balanced_paths(paths);
  assert.ok(balanced.slice(0, 3).includes('packages/zzz/webhook.ts'));
  assert.deepEqual(balanced_paths([...paths].reverse()), balanced);
  assert.deepEqual(new Set(balanced), new Set(paths));
  assert.equal(balanced.length, paths.length);
  const prepared = inventory(paths);
  const result = plan(prepared, 'quick');
  assert.ok(result.tasks.find(task => task.role === 'repository-cartographer').paths.includes('packages/zzz/webhook.ts'));
  assert.ok(result.tasks.length <= 6);
  assert.ok(result.tasks.every(task => task.paths.length <= 24));
  assert.ok(result.deferred.length);
  const accounted = [...result.tasks, ...result.deferred].filter(task => task.role === 'repository-cartographer').flatMap(task => task.paths);
  assert.deepEqual(new Set(accounted), new Set(paths));
});

test('Unicode paths retain version-one code-point ordering in bounded task identities', () => {
  assert.deepEqual(balanced_paths(['😀.ts', '\uE000.ts']), ['\uE000.ts', '😀.ts']);
  const result = plan(inventory(['😀.ts', '\uE000.ts']), 'quick');
  assert.deepEqual(result.tasks.find(task => task.role === 'repository-cartographer').paths, ['\uE000.ts', '😀.ts']);
});

test('analysis notices are visible to readers and tasks without claiming a coverage omission', () => {
  const prepared = inventory(['api/example.py']);
  prepared.files['api/example.py'].language = 'Python';
  prepared.analysis_notes = [{ path: 'api/example.py', reason: 'Python declarations are lexical candidates; no Python runtime or AST parser is invoked' }];
  prepared.candidates = [{ kind: 'symbol', path: 'api/example.py', line: 1, confidence: 'INFERRED', name: 'example' }];
  const taskPlan = plan(prepared, 'quick', 'example');
  assert.ok(taskPlan.tasks.every(task => task.analysis_notes?.some(note => note.path === 'api/example.py')));
  assert.ok(!taskPlan.scope_resolution.frontier.some(frontier => frontier.reason.includes('AST parser')));
  const state = { inventory: prepared, plan: taskPlan, entities: [], relations: [], evidence: [], gaps: [], audit: { issues: [], instructions: [], limitations: [] } };
  const overview = render(state, 'docs/codebase')['overview.md'];
  assert.ok(overview.includes('Python declarations are lexical candidates; no Python runtime or AST parser is invoked'));
  assert.ok(overview.includes('Lexical candidates do not establish syntax, behavior or complete coverage.'));
});

test('planning binds snapshots and tracks independent scope fallback and impacts', () => {
  const prepared = inventory(['a.ts', 'b.ts']);
  prepared.candidates = [{ kind: 'entrypoint', path: 'a.ts', confidence: 'INFERRED' }];
  const initial = plan(prepared, 'standard');
  assert.equal(initial.snapshot, digest(canonical_json({ 'a.ts': digest('a.ts'), 'b.ts': digest('b.ts') })));
  assert.ok(initial.tasks.some(task => task.role === 'entrypoint-mapper'));
  assert.ok(initial.tasks.find(task => task.role === 'entrypoint-mapper').documentation_contract);
  const scoped = plan(prepared, 'quick', 'Unresolved business capability');
  assert.ok(scoped.scope_resolution.frontier.some(item => item.id === 'concept-resolution'));
  assert.ok(scoped.tasks.length > 0);
  const impacted = plan(prepared, 'standard', null, { affected_entities: ['feature.x'], changed_files: ['b.ts'] },
    [{ id: 'feature.x', evidence: ['evidence.a'] }], [], [{ id: 'evidence.a', path: 'a.ts' }]);
  assert.deepEqual(new Set(impacted.tasks.flatMap(task => task.paths)), new Set(['a.ts', 'b.ts']));
  assert.throws(() => plan(prepared, 'invalid'), /Unsupported mode/);
});

test('follow-up scopes remain pending when unscheduled, missing or unfinished', () => {
  const prepared = inventory(['a.ts', 'b.ts']);
  const result = plan(prepared, 'quick');
  const request = { id: 'followup.extra', role: 'runtime-tracer', paths: ['a.ts', 'missing.ts'], question: 'Inspect the actual call.' };
  schedule_followups(result, [request], prepared);
  assert.equal(result.followups[0].status, 'pending');
  assert.ok(result.followups[0].tasks.length);
  assert.throws(() => schedule_followups(result, [{ ...request, paths: ['b.ts'] }], prepared), /Conflicting follow-up/);
  const open = { snapshot: result.snapshot, tasks: [], followups: [], max_tasks: 4, max_paths_per_task: 1 };
  schedule_followups(open, [{ ...request, paths: ['a.ts', 'b.ts'] }], prepared);
  assert.equal(open.tasks.length, 2);
  open.tasks.forEach(task => { task.status = 'accepted'; });
  schedule_followups(open, [], prepared);
  assert.equal(open.followups[0].status, 'accounted');
  assert.equal(Object.keys(ROLES).length, 18);
  assert.equal(task_for('spec-curator', ['a.ts'], result.snapshot, prepared, 1).phase, 'curation');
});

test('impact follows both dependency directions and preserves changed-file provenance', () => {
  const before = inventory(['one.ts', 'two.ts', 'unrelated.ts']);
  const after = structuredClone(before);
  after.files['one.ts'].sha256 = digest('changed');
  after.candidates = [{ path: 'one.ts', kind: 'symbol' }, { path: 'one.ts', kind: 'setting' }];
  const report = analyze(before, after,
    [{ id: 'entity.one', evidence: ['evidence.one'] }, { id: 'entity.two', evidence: ['evidence.two'] }, { id: 'entity.three', evidence: [] }],
    [{ source: 'entity.one', target: 'entity.two', evidence: [] }, { source: 'entity.three', target: 'entity.two', evidence: [] }],
    [{ id: 'evidence.one', path: 'one.ts' }, { id: 'evidence.two', path: 'two.ts' }], [{ status: 'R100', old_path: 'old.ts', path: 'renamed.ts' }]);
  assert.deepEqual(report.affected_entities, ['entity.one', 'entity.three', 'entity.two']);
  assert.deepEqual(report.changed_files, ['old.ts', 'one.ts', 'renamed.ts']);
  assert.deepEqual(report.significance, ['setting']);
  assert.equal(report.git_changes[0].old_path, 'old.ts');
});

test('instruction audit reports duplicates and broken links without modifying source', t => {
  const root = temporary(t);
  const text = '# Guidance\nRead [missing](missing.md) and [web](https://example.invalid/).\n';
  fs.writeFileSync(path.join(root, 'AGENTS.md'), text);
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested/AGENTS.override.md'), text);
  const prepared = inventory(['AGENTS.md', 'nested/AGENTS.override.md']);
  for (const record of Object.values(prepared.files)) { record.instruction = true; record.bytes = Buffer.byteLength(text); }
  const before = contents(root);
  const report = audit(root, prepared);
  assert.ok(report.issues.some(issue => issue.issue.includes('duplicates')));
  assert.equal(report.issues.filter(issue => issue.issue.includes('Local link target is missing')).length, 2);
  assert.ok(report.instructions.find(item => item.path.includes('override')).override);
  assert.deepEqual(contents(root), before);
  assert.equal(audit(root, inventory([])).issues[0].confidence, 'UNKNOWN');
});

test('native provider adapters only render bounded tasks', () => {
  const task = { paths: ['source.ts'], objective: 'Inspect source', payload: '$(do-not-run)' };
  for (const provider of ['codex', 'claude']) {
    const output = prompt(provider, task);
    assert.ok(output.includes('Do not execute repository code or start provider CLIs.'));
    assert.deepEqual(JSON.parse(output.slice(output.indexOf('{'))), task);
  }
  assert.throws(() => prompt('unsupported', task), /Unsupported provider/);
});

test('document rendering keeps proposals, evidence commits and model navigation explicit', () => {
  const prepared = inventory(['src/a.ts']);
  const currentPlan = plan(prepared, 'quick');
  const entity = { id: 'feature.api', kind: 'feature', title: 'API', summary: 'Prepared source claim', confidence: 'INFERRED',
    evidence: ['evidence.source'], review: { status: 'source-reviewed', reviewer: 'prepared-reviewer' }, documentation: [{
      id: 'doc.proposal', title: 'API proposal', profile: 'explanation', mode: 'proposal', audience: 'Maintainers', purpose: 'Review the candidate', scope: 'Prepared fixture only',
      sections: ['context', 'design', 'tradeoffs'].map(topic => ({ id: 'section.' + topic, topic, title: topic, status: 'documented', content: 'Prepared proposal.', evidence: ['evidence.source'] })),
      requirements: [{ id: 'req.future', basis: 'proposed', statement: 'Candidate behavior', rationale: 'Prepared requirement', origin: 'Fixture', evidence: [],
        verification: { method: 'inspection', procedure: 'Compare the stated criterion', expected: 'Prepared criterion', test_evidence: [] } }],
      review_when: ['Interface changes'], canonical_sources: ['evidence.source'],
    }] };
  const state = { entities: [entity], relations: [], gaps: [], evidence: [{ id: 'evidence.source', path: 'src/a.ts', sha256: prepared.files['src/a.ts'].sha256, start_line: 1, end_line: 1, commit: 'cited-old-commit' }],
    inventory: prepared, plan: currentPlan, audit: { issues: [], instructions: [], limitations: [] } };
  const authored = render_documents(state, 'docs/codebase')['documents/doc.proposal.md'];
  assert.ok(authored.includes('not approved or implemented'));
  assert.ok(authored.includes('Inventory commit: `prepared-commit`'));
  assert.ok(authored.includes('Cited evidence commits: `cited-old-commit`'));
  assert.ok(authored.includes('[API](../features/feature.api.md)'));
  assert.ok(authored.includes('Verification procedures below are intent, not execution results.'));
  const all = render(state, 'docs/codebase');
  assert.ok(all['README.md'].includes('documents/doc.proposal.md'));
  assert.ok(all['features/feature.api.md'].includes('../documents/doc.proposal.md'));
  assert.ok(assess_documents(state, prepared).ready);
  assert.ok(assess_documents(state, prepared).documents[0].warnings.some(warning => warning.includes('approval')));
  assert.equal(assess_documents({ ...state, entities: [] }, prepared).ready, false);
});
