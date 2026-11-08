/** Prepared authoring regressions. No inference or example/application execution. */
import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EngineFixture, FIXTURES, OUT, snapshot_files } from './helpers.mjs';
import { main } from '../lib/understand_code/cli.js';
import { validate_contract } from '../lib/understand_code/contracts.js';
import { inventory } from '../lib/understand_code/discovery.js';
import { capture, read_source, split_lines } from '../lib/understand_code/evidence.js';
import { export_knowledge, validate_references } from '../lib/understand_code/exchange.js';
import { head } from '../lib/understand_code/git.js';
import { assess_documents } from '../lib/understand_code/spec/documentation.js';
import { verify } from '../lib/understand_code/spec/verifier.js';
import { END, START, generated, split_generated } from '../lib/understand_code/spec/writer.js';

const DOCUMENTS = path.join(FIXTURES, 'documentation');
const clone = structuredClone;
class DocumentationFixture extends EngineFixture {
  constructor(t) { super(t); fs.copyFileSync(path.join(DOCUMENTS, 'contract.md'), path.join(this.root, 'contract.md')); }
  documented(...names) {
    const bundle = this.prepared();
    const text = read_source(this.root, 'contract.md');
    const contract = capture('contract.md', text, 1, split_lines(text).length, head(this.root), 'documentation');
    bundle.evidence.push(contract);
    const entity = bundle.entities[0]; entity.evidence.push(contract.id);
    const tokens = { $source: bundle.evidence[0].id, $test: bundle.evidence[2].id, $contract: contract.id };
    const bind = value => {
      if (typeof value === 'string') return tokens[value] ?? value;
      if (Array.isArray(value)) return value.map(bind);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v)]));
      return value;
    };
    entity.documentation = (names.length ? names : ['reference']).map(name => bind(JSON.parse(fs.readFileSync(path.join(DOCUMENTS, name + '.json'), 'utf8'))));
    return bundle;
  }
  checked_example(bundle, level = 'behavior', status = 'passed') {
    // This constructs synthetic provenance. No documented command is run.
    const example = bundle.entities[0].documentation[0].examples[0];
    const keys = ['language', 'code', 'prerequisites', 'expected'].sort();
    const quote = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const bound = '{' + keys.map(key => quote(key) + ': ' + quote(example[key])).join(', ') + '}';
    example.validation = { status, level, reason: 'Prepared synthetic check record; no command or example was executed.',
      provenance: { command: 'prepared-fixture-command (not executed)',
        environment: 'Synthetic offline fixture; not a real execution environment', snapshot: bundle.snapshot,
        checked_at: '2026-11-08T08:00:00+00:00', runner: 'prepared-fixture-author (no actual runner)',
        output_sha256: createHash('sha256').update('prepared output, not captured execution').digest('hex'),
        example_sha256: createHash('sha256').update(bound).digest('hex'), exit_code: status === 'passed' ? 0 : 1 } };
    return example;
  }
  output_files() { return snapshot_files(path.join(this.root, OUT)); }
  rejected_without_write(bundle) { const before = this.output_files(); assert.throws(() => this.apply(bundle)); assert.deepEqual(this.output_files(), before); }
  feature(state = this.state()) { return state.entities.find(e => e.id === 'feature.checkout'); }
  quality(state = this.state()) { return assess_documents(state, inventory(this.root, OUT)); }
  blocked(report, ...terms) {
    assert.equal(report.ready, false);
    const blockers = JSON.stringify(report.documents.flatMap(doc => doc.blockers)).toLowerCase();
    if (terms.length) assert.ok(terms.some(term => blockers.includes(term.toLowerCase())), blockers);
  }
  page(id) { return this.read(`${OUT}/documents/${id}.md`); }
  cli(...flags) {
    let output = '';
    const stdout = process.stdout.write, stderr = process.stderr.write;
    try {
      process.stdout.write = chunk => { output += chunk; return true; };
      process.stderr.write = () => true;
      const code = main([...flags, '--repo', this.root, '--output', OUT]);
      return [code, JSON.parse(output)];
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
  }
}

test('reference renders structured content and keeps source unchanged', t => {
  const f = new DocumentationFixture(t); const before = snapshot_files(f.root);
  f.bootstrap(); const bundle = f.documented(); f.apply(bundle);
  const page = f.page('doc.checkout-reference');
  for (const part of ['# Checkout function reference', '## Inputs and assumptions', '| Input | Meaning |',
    '\n\nThe function does not validate item structure.', "    assert result['requires_login'] is True\n", 'checkout.py#L', 'contract.md#L',
    bundle.snapshot, 'not-run', 'CORROBORATED', 'checkout return values or the guest gate change.']) assert.ok(page.includes(part), part);
  assert.ok(!page.includes('**Owner:**'));
  assert.ok(f.read(`${OUT}/README.md`).includes('documents/doc.checkout-reference.md'));
  assert.ok(f.read(`${OUT}/features/feature.checkout.md`).includes('doc.checkout-reference.md'));
  for (const [file, content] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(f.root, file)).toString('base64'), content);
  f.blocked(f.quality(), 'example', 'behavior');
});
test('how-to and tutorial render steps with illustrative warning', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const bundle = f.documented('how-to');
  const tutorial = clone(bundle.entities[0].documentation[0]);
  Object.assign(tutorial, { id: 'doc.checkout-tutorial', profile: 'tutorial', title: 'Learn the guest gate' });
  bundle.entities[0].documentation.push(tutorial); f.apply(bundle);
  for (const id of ['doc.checkout-how-to', 'doc.checkout-tutorial']) {
    const text = f.page(id); assert.ok(text.includes('1. Open the checkout function')); assert.ok(text.includes('2. Find the guest')); assert.ok(text.toLowerCase().includes('illustrative'));
  }
  const report = f.quality(); assert.equal(report.ready, true, JSON.stringify(report)); assert.equal(report.total, 2); assert.ok(report.documents.every(d => d.warnings.length));
});
test('explanation profile needs no runnable example', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const bundle = f.documented('specification'), doc = bundle.entities[0].documentation[0];
  Object.assign(doc, { id: 'doc.checkout-explanation', profile: 'explanation', mode: 'as-built' }); delete doc.requirements;
  doc.sections = [['context', 'Context', 'The checkout body consults a guest_checkout setting.'],
    ['design', 'Design', 'The falsey-user branch returns a denial before the success result.'],
    ['tradeoffs', 'Consequences', 'The body accepts items without validation; this documents a limitation, not historical rationale.']]
    .map(([topic, title, content]) => ({ id: 'section.' + topic, topic, title, status: 'documented', content, evidence: [bundle.evidence[0].id] }));
  f.apply(bundle); assert.equal(f.quality().ready, true); assert.ok(f.page('doc.checkout-explanation').includes('Consequences'));
});
test('mixed specification keeps observed, specified and proposed bases', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const bundle = f.documented('specification'); f.apply(bundle);
  const requirements = f.feature().documentation[0].requirements; assert.deepEqual(requirements.map(r => r.basis), ['observed', 'specified', 'proposed']);
  const page = f.page('doc.checkout-specification');
  for (const r of requirements) { assert.ok(page.includes(r.id)); assert.ok(page.toLowerCase().includes(r.basis)); }
  for (const part of ['pending maintainer decision', 'test_checkout.py#L', 'verification plan, not a recorded run']) assert.ok(page.includes(part));
  assert.equal(f.quality().ready, true);
});
test('proposal mode does not require established implementation confidence', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const bundle = f.documented('specification'), entity = bundle.entities[0], doc = entity.documentation[0];
  entity.confidence = 'INFERRED'; doc.mode = 'proposal'; doc.requirements = doc.requirements.filter(r => r.basis === 'proposed');
  f.apply(bundle); assert.equal(f.feature().confidence, 'INFERRED'); assert.equal(f.quality().ready, true);
  const page = f.page('doc.checkout-specification'); assert.ok(page.toLowerCase().includes('proposal')); assert.ok(page.includes('INFERRED'));
});
test('requirement authority and mode mismatches reject atomically', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  const mutations = [
    (d, b) => { d.requirements[0].evidence = [b.evidence[2].id]; },
    (d, b) => { d.requirements[1].evidence = [b.evidence[0].id]; },
    d => { delete d.requirements[2].origin; }, d => { d.mode = 'as-built'; }, d => { d.mode = 'proposal'; },
    d => { d.requirements[0].basis = 'unknown'; }, (d, b) => { d.requirements[0].verification.test_evidence = [b.evidence[0].id]; },
  ];
  for (const mutate of mutations) { const b = f.documented('specification'); mutate(b.entities[0].documentation[0], b); f.rejected_without_write(b); }
});
test('every nested citation belongs to parent and current bundle', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  for (const location of ['section', 'requirement', 'verification', 'example', 'canonical']) for (const reference of ['missing', 'another entity']) {
    const b = f.documented('specification', 'reference'), docs = b.entities[0].documentation;
    const bad = reference === 'missing' ? 'evidence.missing' : b.evidence[1].id;
    if (location === 'section') docs[0].sections[0].evidence = [bad];
    else if (location === 'requirement') docs[0].requirements[0].evidence = [bad];
    else if (location === 'verification') docs[0].requirements[0].verification.test_evidence = [bad];
    else if (location === 'example') docs[1].examples[0].evidence = [bad];
    else docs[0].canonical_sources = [bad];
    f.rejected_without_write(b);
  }
});
test('closed shapes, unsafe identifiers and duplicate local IDs reject atomically', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  const mutations = [d => { d.id = 'doc.../escape'; }, d => { d.profile = 'arbitrary'; }, d => { d.approved = true; },
    d => { d.audience = ' \n '; }, d => { d.examples[0].language = 'python\n```'; },
    d => d.sections.push(clone(d.sections[0])), d => d.examples.push(clone(d.examples[0])),
    d => d.sections[0].table.rows.push(['too short']), d => { d.sections[0].status = 'unknown'; },
    d => { d.sections[0].evidence = []; }, d => { d.examples[0].evidence = []; }];
  for (const mutate of mutations) { const b = f.documented(); mutate(b.entities[0].documentation[0]); f.rejected_without_write(b); }
  const b = f.documented('specification'); b.entities[0].documentation[0].requirements.push(clone(b.entities[0].documentation[0].requirements[0])); f.rejected_without_write(b);
});
test('document IDs stay unique across new and existing owners', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification'), duplicate = clone(b.entities[0]);
  Object.assign(duplicate, { id: 'feature.other', title: 'Other feature' }); b.entities.push(duplicate); f.rejected_without_write(b);
  b.entities.pop(); f.apply(b); const moved = clone(b); moved.entities = [duplicate]; moved.relations = []; f.rejected_without_write(moved);
});
test('requirement IDs may repeat in distinct documents', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification'), docs = b.entities[0].documentation;
  const second = clone(docs[0]); second.id = 'doc.checkout-secondary-spec'; docs.push(second); f.apply(b);
  assert.equal(f.quality().total, 2); assert.equal(f.quality().ready, true);
});
test('checked examples require bound, truthful provenance shape', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  const mutations = [e => { delete e.validation.provenance; }, e => { e.validation.level = 'none'; },
    e => { e.validation.provenance.snapshot = '0'.repeat(64); }, e => { e.validation.provenance.example_sha256 = '0'.repeat(64); },
    e => { e.code += '# changed\n'; }, e => { e.prerequisites = 'Different module path and settings.'; },
    e => { e.expected = 'A different status.'; }, e => { e.language = 'text'; }, e => { e.validation.provenance.exit_code = 1; },
    e => { e.validation.provenance.checked_at = '2026-11-08T08:00:00'; }, e => { e.validation.provenance.checked_at = 'not-a-time'; },
    e => { e.validation.provenance.checked_at = '2026-02-31T08:00:00Z'; },
    e => { e.kind = 'illustrative'; }, e => Object.assign(e.validation, { status: 'not-run', level: 'none' })];
  for (const mutate of mutations) { const b = f.documented(); mutate(f.checked_example(b)); f.rejected_without_write(b); }
  const b = f.documented(); b.entities[0].documentation[0].examples[0].validation.level = 'syntax'; f.rejected_without_write(b);
});
test('syntax and schema checks are never promoted to behavioral checks', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  for (const [level, status, expected] of [['syntax', 'passed', false], ['schema', 'passed', false], ['behavior', 'failed', false], ['behavior', 'passed', true]]) {
    const b = f.documented(); f.checked_example(b, level, status); b.entities[0].documentation[0].id = 'doc.' + level + '-' + status;
    const state = f.state(), parent = clone(b.entities[0]); parent.review = b.review; state.entities = [parent]; state.evidence = b.evidence;
    const report = f.quality(state); assert.equal(report.ready, expected, JSON.stringify(report));
  }
  const b = f.documented(); f.checked_example(b); f.apply(b); const page = f.page('doc.checkout-reference');
  for (const part of ['prepared-fixture-command', 'not executed', 'behavior']) assert.ok(page.includes(part)); assert.equal(f.quality().ready, true);
});
test('quality requires profile topics, examples and specification requirements', t => {
  const f = new DocumentationFixture(t); f.bootstrap();
  for (const [name, removed] of [['reference', 'errors'], ['how-to', 'troubleshooting'], ['specification', 'security']]) {
    const b = f.documented(name), parent = b.entities[0]; parent.review = b.review;
    parent.documentation[0].sections = parent.documentation[0].sections.filter(s => s.topic !== removed);
    const state = f.state(); Object.assign(state, { entities: [parent], evidence: b.evidence }); f.blocked(f.quality(state), removed);
  }
  for (const [name, field, expected] of [['reference', 'examples', 'example'], ['specification', 'requirements', 'requirement']]) {
    const b = f.documented(name), parent = b.entities[0]; parent.review = b.review; delete parent.documentation[0][field];
    const state = f.state(); Object.assign(state, { entities: [parent], evidence: b.evidence }); f.blocked(f.quality(state), expected);
  }
});
test('unknown sections and requirements remain quality blockers', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification'), doc = b.entities[0].documentation[0];
  Object.assign(doc.sections[0], { status: 'unknown', content: 'Which user values are supported?', evidence: [] });
  Object.assign(doc.requirements[0], { basis: 'unknown', evidence: [] });
  Object.assign(doc.requirements[0].verification, { method: 'unresolved', procedure: 'Resolve the user-value contract before testing.' });
  f.apply(b); f.blocked(f.quality(), 'unknown', 'unresolved'); const text = f.page('doc.checkout-specification');
  assert.ok(text.includes('Which user values are supported?')); assert.ok(text.toLowerCase().includes('unknown'));
});
test('quality blocks unreviewed, nonestablished, stale and conflicting parents', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); f.apply(f.documented('specification'));
  for (const [mutation, expected] of [[{ review: { status: 'unreviewed' } }, 'review'], [{ confidence: 'INFERRED' }, 'established'], [{ stale: true }, 'stale'], [{ conflict: true }, 'conflict']]) {
    const state = clone(f.state()); Object.assign(f.feature(state), mutation); f.blocked(f.quality(state), expected);
  }
});
test('not-applicable sections alone cannot make a document ready', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification');
  for (const section of b.entities[0].documentation[0].sections) Object.assign(section, { status: 'not-applicable', content: 'Prepared exclusion reason; this is not a behavioral assertion.' });
  f.apply(b); f.blocked(f.quality(), 'documented', 'content');
});
test('changed supporting source blocks quality before and after refresh', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); f.apply(f.documented('specification')); const original = clone(f.feature().documentation);
  f.write('checkout.py', f.read('checkout.py') + '\n# changed source snapshot\n'); f.blocked(f.quality(), 'source', 'stale', 'changed');
  f.run('update'); assert.equal(f.feature().stale, true); assert.deepEqual(f.feature().documentation, original); f.blocked(f.quality(), 'stale', 'source');
});
test('example attestation expires even after unrelated source changes', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented(); f.checked_example(b); f.apply(b); assert.equal(f.quality().ready, true);
  f.write('unrelated.py', "BANNER = 'new independent source'\n"); f.run('update'); assert.ok(!f.feature().stale); f.blocked(f.quality(), 'snapshot', 'example');
});
test('literal fences, managed markers and human notes survive regeneration', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented(), example = b.entities[0].documentation[0].examples[0];
  const literal = "first line\n```python\n    print('<script>literal</script>')\n```\n~~~~\n" + START + '\n' + END + '\n<!-- understand-code:human -->\n`````\nliteral tail\n';
  Object.assign(example, { kind: 'illustrative', language: 'text', code: literal }); f.apply(b);
  const file = `${OUT}/documents/doc.checkout-reference.md`; assert.ok(f.read(file).includes(literal));
  const note = 'Maintainer: preserve this exact example and reconsider its scope.'; f.write(file, f.read(file) + note + '\n'); f.run('update');
  assert.ok(f.read(file).includes(literal)); const [prefix, suffix] = split_generated(f.read(file)); assert.ok(prefix.includes(literal)); assert.ok(suffix.includes(note));
  const relevant = f.state().plan.tasks[0].maintainer_notes.filter(item => item.path.endsWith('doc.checkout-reference.md'));
  assert.deepEqual(relevant.map(item => item.note), [note]); assert.equal(verify(f.root, OUT, f.state(), inventory(f.root, OUT)).ok, true);
  f.write(file, f.read(file).replace('literal tail', 'tampered tail')); const before = f.output_files(); assert.throws(() => f.run('update'), /Generated region/); assert.deepEqual(f.output_files(), before);
});
test('plain prose and tables cannot inject HTML or managed markers', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented(), doc = b.entities[0].documentation[0];
  doc.sections[0].content = 'Literal <script>alert(1)</script> and [link](javascript:bad).\n\n' + END; doc.sections[0].table.rows[0][0] = 'user | guest'; f.apply(b);
  const text = f.page('doc.checkout-reference'); assert.ok(!text.includes('<script>')); assert.ok(text.includes('&lt;script&gt;'));
  assert.ok(text.includes('\\[link\\]')); assert.ok(text.includes('user \\| guest')); assert.equal(generated(text).split(END).length - 1, 1);
});
test('legacy verify and first authored upgrade remain additive', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); f.apply(f.prepared()); const before = verify(f.root, OUT, f.state(), inventory(f.root, OUT));
  assert.equal(before.ok, true); assert.equal(before.documentation_quality.total, 0); assert.equal(before.documentation_quality.ready, false);
  assert.equal(f.cli('verify')[0], 0); assert.equal(f.cli('verify', '--require-doc-quality')[0], 1);
  f.apply(f.documented('specification')); assert.ok(!f.feature().conflict); const after = verify(f.root, OUT, f.state(), inventory(f.root, OUT));
  assert.equal(after.ok, true); assert.equal(before.coverage_complete, after.coverage_complete); assert.equal(after.documentation_quality.ready, true);
  assert.equal(f.cli('verify', '--require-doc-quality')[0], 0); const [code, status] = f.cli('status'); assert.equal(code, 0); assert.equal(status.verification.documentation_quality.ready, true);
});
test('existing documentation cannot be omitted or silently retired', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); f.apply(f.documented('specification')); const original = clone(f.feature().documentation); f.rejected_without_write(f.prepared());
  const explicit = f.prepared(); explicit.entities[0].documentation = []; f.apply(explicit); assert.equal(f.feature().conflict, true); assert.deepEqual(f.feature().documentation, original); f.blocked(f.quality(), 'conflict');
});
test('authored changes conflict until explicit reviewed replacement', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification'); f.apply(b);
  const revised = clone(b); revised.entities[0].documentation[0].sections[0].content = 'A revised prepared interpretation needing reconciliation.'; f.apply(revised);
  assert.equal(f.feature().conflict, true); assert.ok(f.state().gaps.some(g => g.alternatives?.length)); f.blocked(f.quality(), 'conflict');
  revised.entities[0].supersedes = 'feature.checkout'; f.apply(revised); assert.ok(!f.feature().conflict); assert.equal(f.quality().ready, true);
  assert.ok(f.page('doc.checkout-specification').includes('revised prepared interpretation'));
});
test('retired document keeps owner and notes for same-owner reactivation', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const original = f.documented('specification'); f.apply(original);
  const file = `${OUT}/documents/doc.checkout-specification.md`, note = 'Maintainer: these historical notes belong to feature.checkout only.'; f.write(file, f.read(file) + note + '\n');
  const removal = clone(original); removal.entities[0].documentation = []; f.apply(removal); removal.entities[0].supersedes = 'feature.checkout'; f.apply(removal);
  assert.deepEqual(f.feature().documentation, []); assert.equal(f.state().manifest.document_owners['doc.checkout-specification'], 'feature.checkout'); assert.ok(f.read(file).includes(note));
  const reassigned = clone(original); reassigned.entities = [clone(original.entities[0])]; Object.assign(reassigned.entities[0], { id: 'feature.other', title: 'An unrelated owner' }); reassigned.relations = [];
  f.rejected_without_write(reassigned); f.apply(original); assert.ok(f.read(file).includes(note)); assert.deepEqual(f.feature().documentation, original.entities[0].documentation);
});
test('retired entity cannot release document identity to a different owner', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const original = f.documented('specification'); f.apply(original);
  const retirement = clone(original); Object.assign(retirement, { entities: [], relations: [], gaps: [] });
  retirement.retirements = ['feature.checkout', 'relation.guest-checkout-gate'].map(id => ({ id, evidence: [original.evidence[0].id], rationale: 'Prepared explicit retirement for ownership-history regression.' }));
  f.apply(retirement); assert.ok(!f.state().entities.some(e => e.id === 'feature.checkout'));
  const reassigned = clone(original); reassigned.entities = [clone(original.entities[0])]; Object.assign(reassigned.entities[0], { id: 'feature.other', title: 'Another feature' }); reassigned.relations = []; f.rejected_without_write(reassigned);
});
test('v1 exchange omits authored views including conflict alternatives without changing state', t => {
  const f = new DocumentationFixture(t); f.bootstrap(); const b = f.documented('specification'); f.apply(b);
  const revised = clone(b); revised.entities[0].documentation[0].purpose = 'A different authored purpose for conflict retention.'; f.apply(revised);
  const state = f.state(), original = clone(state), wire = export_knowledge(state, inventory(f.root, OUT)); assert.equal(wire.version, 1);
  validate_contract('change-knowledge', wire); validate_references(wire);
  const no_documentation = value => {
    if (Array.isArray(value)) value.forEach(no_documentation);
    else if (value && typeof value === 'object') { assert.ok(!Object.hasOwn(value, 'documentation')); Object.values(value).forEach(no_documentation); }
  };
  no_documentation(wire); assert.deepEqual(state, original); assert.ok(wire.gaps.some(g => g.alternatives?.length));
});
