/** Prepared local change-coverage contracts. No inference or application execution. */
import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EngineFixture, FIXTURES, OUT } from './helpers.mjs';
import * as coverage from '../lib/understand_code/coverage.js';
import { resolve, source_manifest, fingerprint } from '../lib/understand_code/change_scope.js';
import { main } from '../lib/understand_code/cli.js';
import { validate_contract } from '../lib/understand_code/contracts.js';
import { inventory } from '../lib/understand_code/discovery.js';
import { capture, read_source, split_lines } from '../lib/understand_code/evidence.js';
import { export_knowledge, import_knowledge, validate_references, write_export } from '../lib/understand_code/exchange.js';
import { validate } from '../lib/understand_code/findings.js';
import { head } from '../lib/understand_code/git.js';
import { plan, schedule_followups } from '../lib/understand_code/spec/planner.js';

const REVIEW = { status: 'source-reviewed', reviewer: 'prepared-fixture-reviewer', method: 'Prepared source inspection; no target application execution' };
const STANDARD = { id: 'standard.portrait', criteria: [{ id: 'criterion.rounded', description: 'Portraits use rounded-full.', verification: 'static' }], required_checks: [], exclusions: [] };
const clone = structuredClone;
const without_review = item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'review'));
class CoverageFixture extends EngineFixture {
  constructor(t) { super(t, 'change-coverage'); }
  file(name, value) { const filename = path.join(this.temp, name); fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n'); return filename; }
  pages() { return fs.readdirSync(path.join(this.root, 'pages')).filter(p => p.endsWith('.tsx')).map(p => p.slice(0, -4)).sort(); }
  model({ pages = null, second = false } = {}) {
    const inv = inventory(this.root, OUT);
    const refs = Object.fromEntries(Object.keys(inv.files).filter(p => split_lines(read_source(this.root, p)).length).map(p => [p,
      capture(p, read_source(this.root, p), 1, split_lines(read_source(this.root, p)).length, head(this.root), 'source')]));
    const entities = [], relations = [];
    const entity = (id, kind, paths, extra = {}) => { const result = { id, kind, title: id, summary: 'Prepared fixture: ' + id,
      confidence: 'EXTRACTED', evidence: paths.map(p => refs[p].id), review: clone(REVIEW), ...extra }; entities.push(result); return result; };
    const relation = (id, kind, source, target, p) => relations.push({ id: 'relation.' + id.toLowerCase(), kind, source, target,
      confidence: 'EXTRACTED', evidence: [refs[p].id], review: clone(REVIEW) });
    const code = (p, anchor) => ({ repository: 'repository.local', path: p, anchor, sha256: refs[p].sha256, start_line: 1, end_line: refs[p].end_line });
    const portrait = 'components/Portrait.tsx';
    entity('concept.avatar', 'concept', [portrait], { title: 'Avatar presentation', search_terms: ['profile photo', 'avatar'] });
    entity('component.portrait', 'component', [portrait]); entity('component.frame', 'component', ['components/Frame.tsx', 'components/index.ts']);
    relation('frame-picture', 'renders', 'component.frame', 'component.portrait', 'components/Frame.tsx');
    for (const page of pages ?? this.pages()) {
      const p = `pages/${page}.tsx`, surface = 'ui_surface.' + page.toLowerCase(), occurrence = 'occurrence.' + page.toLowerCase();
      entity(surface, 'ui_surface', [p]); relation(page + '-presents', 'presents', surface, 'concept.avatar', p);
      if (page !== 'Activity') relation(page + '-renders', 'renders', surface, 'component.frame', p);
      const implementation = [code(p, page + '/portrait/1')], paths = [p];
      if (page !== 'Activity') { implementation.push(code(portrait, 'Portrait/img')); paths.push(portrait); }
      entity(occurrence, 'occurrence', paths, { occurrence: { concept: 'concept.avatar', surface, anchor: page + '/portrait/1', conditions: ['default'], implementation } });
      relation(page + '-occurs', 'occurs_on', occurrence, surface, p); relation(page + '-realizes', 'realizes', occurrence, 'concept.avatar', p);
      if (page === 'Profile') { relation('primary-profile', 'primary_surface', 'concept.avatar', surface, p); relations.at(-1).scope = 'Personal profile; default role'; }
      if (page === 'Profile' && second) entity('occurrence.profile-secondary', 'occurrence', [p], { occurrence: { concept: 'concept.avatar', surface,
        anchor: 'Profile/portrait/2', conditions: ['preview'], implementation: [code(p, 'Profile/portrait/2')] } });
    }
    return { inventory: inv, entities, relations, evidence: Object.values(refs), gaps: [], knowledge_imports: [],
      plan: { tasks: [{ id: 'task.prepared', role: 'relationship-verifier', paths: Object.keys(inv.files).sort(), status: 'accepted', review: clone(REVIEW) }], deferred: [], followups: [] } };
  }
  request(standard = STANDARD, options = {}) {
    const examples = this.pages().filter(p => p !== 'Profile').map(p => `pages/${p}.tsx`);
    return coverage.new_request('avatar presentation', 'ui_standardization', clone(standard), { examples, ...options });
  }
  scope({ state = null, previous = null, request = null } = {}) {
    state ??= this.model(); return [coverage.refresh(previous, request ?? previous?.request ?? this.request(), state), state];
  }
  packet(scope, state, omit = []) {
    const packet = coverage.review_template(scope); packet.review = clone(REVIEW); packet.evidence = clone(state.evidence);
    const by_path = Object.fromEntries(state.evidence.map(r => [r.path, r.id]));
    const criteria = scope.request.standard.criteria.map(c => c.id);
    for (const [key, obligation] of Object.entries(scope.obligations)) {
      if (omit.includes(key) || !obligation.present) continue;
      packet.dispositions.push({ obligation: key, disposition: 'already_compliant', criteria, evidence: obligation.consumer_paths.map(p => by_path[p]),
        rationale: 'Prepared inspection against the declared criterion at this surface.' });
    }
    for (const [key, candidate] of Object.entries(scope.candidates)) {
      if (!candidate.present) continue;
      const occurrences = Object.entries(scope.obligations).filter(([, o]) => o.present && o.kind === 'occurrence' && o.paths.includes(candidate.path)).map(([k]) => k);
      packet.candidates.push({ candidate: key, status: occurrences.length ? 'modeled' : 'not_relevant', occurrences, evidence: [by_path[candidate.path]],
        rationale: 'Prepared independent inspection of this source file.' });
    }
    packet.policies = [...scope.resolution.required_policies]; return packet;
  }
  reviewed(scope, state, packet = null) { return coverage.apply_review(scope, packet ?? this.packet(scope, state), this.root, OUT); }
  assessment(scope, state) { return coverage.assess(scope, state, inventory(this.root, OUT)); }
  cli(...args) {
    const stdout = process.stdout.write, stderr = process.stderr.write;
    try { process.stdout.write = () => true; process.stderr.write = () => true; return main([...args, '--repo', this.root]); }
    finally { process.stdout.write = stdout; process.stderr.write = stderr; }
  }
}

test('omitted profile is independently mandatory', t => {
  const f = new CoverageFixture(t), [scope] = f.scope(); assert.ok(!scope.request.examples.includes('pages/Profile.tsx'));
  assert.equal(scope.resolution.occurrences.length, 9); assert.deepEqual(scope.resolution.required_anchors, ['ui_surface.profile']);
  assert.ok(scope.resolution.paths.includes('pages/Profile.tsx')); assert.ok(scope.resolution.roster.some(c => c.path === 'pages/Activity.tsx')); assert.equal(Object.keys(scope.obligations).length, 10);
});
test('eight of nine occurrences cannot pass until profile accounted', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(); const omitted = Object.entries(scope.obligations).filter(([, o]) => o.surface === 'ui_surface.profile').map(([key]) => key);
  const partial = f.reviewed(scope, state, f.packet(scope, state, omitted)), report = f.assessment(partial, state); assert.equal(report.change_complete, false);
  assert.deepEqual(new Set(report.occurrence_accounting.unaccounted), new Set(omitted)); const complete = f.reviewed(partial, state);
  assert.equal(f.assessment(complete, state).change_complete, true); assert.equal(f.assessment(complete, state).behavioral_verification.status, 'not_required');
});
test('shared component change needs no direct profile edit', t => {
  const f = new CoverageFixture(t), p = 'components/Portrait.tsx'; f.write(p, f.read(p).replace('rounded-full', 'rounded-sm')); const [baseline] = f.scope();
  f.write(p, f.read(p).replace('rounded-sm', 'rounded-full')); const [scope, state] = f.scope({ previous: baseline }), packet = f.packet(scope, state);
  const ref = state.evidence.find(r => r.path === p).id;
  for (const item of packet.dispositions) if (scope.obligations[item.obligation].surface !== 'ui_surface.activity') Object.assign(item, { disposition: 'changed_via_shared_dependency', consumer_evidence: [...item.evidence], dependency_evidence: [ref] });
  assert.equal(f.assessment(f.reviewed(scope, state, packet), state).change_complete, true); assert.equal(scope.baseline.files['pages/Profile.tsx'], scope.target.files['pages/Profile.tsx']);
});
test('shared disposition rejects missing consumer or unchanged dependency', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(), packet = f.packet(scope, state); packet.dispositions[0].disposition = 'changed_via_shared_dependency';
  assert.throws(() => f.reviewed(scope, state, packet), /evidence|Shared/);
});
test('same-file occurrences remain distinct', t => {
  const f = new CoverageFixture(t), [scope] = f.scope({ state: f.model({ second: true }) }); assert.equal(scope.resolution.occurrences.length, 10); assert.equal(Object.keys(scope.obligations).length, 11);
});
test('new occurrence becomes an unaccounted obligation', t => {
  const f = new CoverageFixture(t); let [scope, state] = f.scope(); scope = f.reviewed(scope, state); f.write('pages/Extra.tsx', "export const Extra = () => <img src='/me.png' />;\n");
  const [target, current] = f.scope({ previous: scope }); assert.equal(Object.keys(target.obligations).length, 11); assert.equal(f.assessment(target, current).change_complete, false);
  assert.ok(f.assessment(target, current).occurrence_accounting.unaccounted.includes('occurrence.extra')); assert.ok(target.reviews.length); assert.ok(target.passes[0].observed_obligations.length);
});
test('detector disappearance cannot shrink denominator or fake source removal', t => {
  const f = new CoverageFixture(t), [scope] = f.scope(), [target, state] = f.scope({ state: f.model({ pages: f.pages().filter(p => p !== 'Activity') }), previous: scope });
  assert.equal(Object.keys(target.obligations).length, 10); assert.equal(target.obligations['occurrence.activity'].present, false);
  const packet = f.packet(target, state), ref = state.evidence.find(r => r.path === 'pages/Activity.tsx').id;
  packet.dispositions.push({ obligation: 'occurrence.activity', disposition: 'removed', criteria: ['criterion.rounded'], evidence: [ref], rationale: 'Detector disappeared', intentional: true });
  assert.throws(() => f.reviewed(target, state, packet), /detector/);
});
test('deleted occurrence requires explicit removal and preserves history', t => {
  const f = new CoverageFixture(t), [baseline] = f.scope(); fs.unlinkSync(path.join(f.root, 'pages/Activity.tsx'));
  const [target, state] = f.scope({ previous: baseline }); assert.ok(target.target.deleted.includes('pages/Activity.tsx')); assert.ok(Object.hasOwn(target.obligations, 'occurrence.activity'));
  const packet = f.packet(target, state), ref = state.evidence[0].id;
  packet.dispositions.push({ obligation: 'occurrence.activity', disposition: 'removed', criteria: ['criterion.rounded'], evidence: [ref], rationale: 'Prepared intentional removal of obsolete fixture surface.', intentional: true });
  const candidate = Object.entries(target.candidates).find(([, c]) => c.path === 'pages/Activity.tsx')[0];
  packet.candidates.push({ candidate, status: 'removed', occurrences: [], evidence: [ref], rationale: 'Deleted intentionally.', intentional: true });
  assert.equal(f.assessment(f.reviewed(target, state, packet), state).change_complete, true); assert.ok(Object.hasOwn(target.baseline.files, 'pages/Activity.tsx'));
});
test('identity mapping must be explicit and reviewed', t => {
  const f = new CoverageFixture(t), [baseline] = f.scope(), state = f.model(), occurrence = state.entities.find(e => e.id === 'occurrence.activity'); occurrence.id = 'occurrence.activity-renamed';
  for (const r of state.relations) if (r.source === 'occurrence.activity') r.source = occurrence.id;
  const [target] = f.scope({ state, previous: baseline }), packet = f.packet(target, state); assert.equal(f.assessment(f.reviewed(target, state, packet), state).change_complete, false);
  packet.identity_mappings = [{ baseline: 'occurrence.activity', target: occurrence.id, rationale: 'Reviewed same source anchor, renamed product ID.', evidence: occurrence.evidence }];
  assert.equal(f.assessment(f.reviewed(target, state, packet), state).change_complete, true);
});
test('line shifts preserve anchors but invalidate review', t => {
  const f = new CoverageFixture(t); let [scope, state] = f.scope(); scope = f.reviewed(scope, state); f.write('pages/Profile.tsx', '\n' + f.read('pages/Profile.tsx'));
  const [target, current] = f.scope({ previous: scope }); assert.equal(target.obligations['occurrence.profile'].anchor, scope.obligations['occurrence.profile'].anchor);
  assert.equal(Object.keys(target.obligations).length, 10); assert.equal(f.assessment(target, current).change_complete, false); assert.ok(f.assessment(target, current).occurrence_accounting.invalidated.length);
});
test('relationship-only source enters focus', t => {
  const f = new CoverageFixture(t); f.write('composition.md', 'Profile presents avatar presentation.\n'); const state = f.model(), ref = state.evidence.find(r => r.path === 'composition.md').id;
  state.relations[0].evidence = [ref]; const [scope] = f.scope({ state }); assert.ok(scope.resolution.paths.includes('composition.md'));
  assert.ok(!state.entities.some(e => e.evidence.includes(ref)));
});
test('unknown phrase receives gap and independent source roster', t => {
  const f = new CoverageFixture(t), s = f.model(), result = resolve('totally unknown presentation', s.inventory, [], [], s.evidence);
  assert.deepEqual(result.concepts, []); assert.ok(result.frontier.some(f => f.id === 'concept-resolution')); assert.ok(result.paths.includes('pages/Profile.tsx'));
});
test('phrase search and identity aliases remain separate contracts', t => {
  const f = new CoverageFixture(t), s = f.model(), result = resolve('profile photo', s.inventory, s.entities, s.relations, s.evidence); assert.deepEqual(result.concepts, ['concept.avatar']);
  const entity = without_review(clone(s.entities[0])); validate_contract('entity', entity); entity.aliases = ['profile photo']; assert.throws(() => validate_contract('entity', entity));
});
test('cycles and depth limits are explicit', t => {
  const f = new CoverageFixture(t), [scope] = f.scope({ request: f.request(STANDARD, { max_depth: 1 }) }); assert.ok(scope.resolution.frontier.some(f => f.id.startsWith('depth-limit')));
  const [full] = f.scope(); assert.deepEqual(full.resolution.frontier, []);
});
test('quick budget keeps UI/reuse investigations and defers other work', t => {
  const f = new CoverageFixture(t), s = f.model(), p = plan(s.inventory, 'quick', 'avatar presentation', null, s.entities, s.relations, s.evidence, { intent: 'ui_standardization' });
  const roles = new Set(p.tasks.map(t => t.role)); assert.ok(roles.has('ui-mapper') && roles.has('reuse-mapper')); assert.ok(p.deferred.length); s.plan = p;
  const [scope] = f.scope({ state: s }); assert.equal(f.assessment(f.reviewed(scope, s), s).change_complete, false);
});
test('dynamic source blocks completion until explicit boundary exclusion', t => {
  const f = new CoverageFixture(t); f.write('dynamic.tsx', 'const view = React.createElement(registry[current]);\n'); const [scope, state] = f.scope();
  assert.ok(scope.resolution.frontier.length); assert.equal(f.assessment(f.reviewed(scope, state), state).change_complete, false);
  const [scoped, bounded] = f.scope({ request: f.request(STANDARD, { exclusions: ['dynamic.tsx'] }) }); assert.deepEqual(scoped.resolution.frontier, []);
  assert.equal(f.assessment(f.reviewed(scoped, bounded), bounded).change_complete, true);
});
test('a settings reader is not an observable effect', t => {
  const f = new CoverageFixture(t), s = f.model(), setting = clone(s.entities[0]);
  Object.assign(setting, { id: 'setting.timezone', kind: 'setting', title: 'Timezone', search_terms: ['timezone'], details: { writer: 'Prepared editor', validation: 'Prepared validator', persistence: 'Prepared database', cache_projection: 'Prepared cache', reader: 'Prepared getter' } });
  s.entities.push(setting); const result = resolve('timezone', s.inventory, s.entities, s.relations, s.evidence, { intent: 'settings_change' });
  assert.ok(result.frontier.some(f => f.id === 'settings-stage:setting.timezone:observable_effect'));
});
test('follow-up missing source is durable', t => {
  const f = new CoverageFixture(t), s = f.model(), p = plan(s.inventory, 'deep'), request = { id: 'followup.dynamic', role: 'ui-mapper', paths: ['missing.tsx'], question: 'Resolve registry source.' };
  schedule_followups(p, [request], s.inventory); assert.equal(p.followups[0].status, 'pending'); schedule_followups(p, [], s.inventory); assert.equal(p.followups.length, 1);
});
test('missing standard cannot report completion', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope({ request: f.request(null) });
  assert.ok(f.assessment(scope, state).discovery_coverage.frontier.some(f => f.id === 'requirements')); assert.equal(f.assessment(scope, state).change_complete, false);
});
test('standard amendment retains baseline and invalidates review', t => {
  const f = new CoverageFixture(t); let [scope, state] = f.scope(); scope = f.reviewed(scope, state); const request = clone(scope.request); request.standard.criteria[0].description += ' Including preview variants.';
  assert.throws(() => coverage.refresh(scope, request, state)); const amended = coverage.refresh(scope, request, state, true);
  assert.deepEqual(amended.baseline, scope.baseline); assert.equal(amended.request_history.length, 1); assert.equal(f.assessment(amended, state).change_complete, false);
});
test('required execution is external, current and successful', t => {
  const f = new CoverageFixture(t), standard = clone(STANDARD); standard.criteria[0].verification = 'behavioral';
  standard.required_checks = [{ id: 'check.portraits', command: 'npm test -- portraits', criteria: ['criterion.rounded'] }];
  const [scope, state] = f.scope({ request: f.request(standard) }), packet = f.packet(scope, state); assert.equal(f.assessment(f.reviewed(scope, state, packet), state).change_complete, false);
  const execution = { id: 'check.portraits', command: 'npm test -- portraits', exit_code: 1, runner: 'prepared-external-harness', executed_at: '2026-09-25T00:00:00Z', output_sha256: 'a'.repeat(64), source_snapshot: scope.target.id };
  packet.executions = [execution]; assert.equal(f.assessment(f.reviewed(scope, state, packet), state).change_complete, false);
  execution.exit_code = 0; assert.equal(f.assessment(f.reviewed(scope, state, packet), state).change_complete, true); execution.source_snapshot = 'b'.repeat(64); assert.throws(() => f.reviewed(scope, state, packet));
});
test('invalid ledger is atomic and cannot narrow scope', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(), before = clone(scope), packet = f.packet(scope, state);
  Object.assign(packet.dispositions.at(-1), { disposition: 'excluded', exclusion: 'exclusion.not-authorized' }); assert.throws(() => f.reviewed(scope, state, packet), /Unauthorized/); assert.deepEqual(scope, before);
  const forged = f.packet(scope, state); forged.evidence[0].sha256 = 'a'.repeat(64); assert.throws(() => f.reviewed(scope, state, forged)); assert.deepEqual(scope, before);
});
test('source manifest captures untracked content', t => {
  const f = new CoverageFixture(t), first = source_manifest(inventory(f.root, OUT)); f.write('new.ts', 'const created = true;\n'); const second = source_manifest(inventory(f.root, OUT));
  assert.notEqual(first.id, second.id); assert.ok(Object.hasOwn(second.files, 'new.ts'));
});
test('exchange roundtrip preserves provenance without promoting imported facts', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory); validate_contract('change-knowledge', wire); validate_references(wire);
  const imported = import_knowledge(f.root, OUT, f.file('knowledge.json', wire)); assert.deepEqual(imported.envelope, wire); assert.ok(imported.candidates.length); assert.ok(imported.candidates.every(c => c.confidence === 'INFERRED'));
  assert.deepEqual(wire.occurrences[0].review, REVIEW); assert.deepEqual(wire.occurrences[0].occurrence.conditions, ['default']);
});
test('exchange quarantines stale source while retaining original envelope', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory), file = f.file('knowledge.json', wire);
  f.write('pages/Profile.tsx', 'export const Profile = () => null;\n'); const imported = import_knowledge(f.root, OUT, file); assert.ok(imported.gaps.length); assert.deepEqual(imported.envelope, wire);
});
test('exchange rejects path traversal and unknown references', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory); wire.evidence[0].path = '../outside.ts'; assert.throws(() => import_knowledge(f.root, OUT, f.file('invalid.json', wire)));
  const dangling = export_knowledge(state, state.inventory); dangling.relations[0].source = 'component.missing'; assert.throws(() => validate_references(dangling));
});
test('exchange rejects symlink escape', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory), file = path.join(f.root, 'components/Portrait.tsx'), outside = path.join(f.temp, 'outside.tsx');
  fs.copyFileSync(file, outside); fs.unlinkSync(file); fs.symlinkSync(outside, file); assert.throws(() => import_knowledge(f.root, OUT, f.file('knowledge.json', wire)));
});
test('missing follow-up path still blocks strict completion', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(); state.plan.followups = [{ id: 'followup.registry', paths: ['missing.tsx'], status: 'pending' }];
  const report = f.assessment(f.reviewed(scope, state), state); assert.equal(report.change_complete, false); assert.deepEqual(report.investigation_coverage.followups, ['followup.registry']);
});
test('unknown source format receives fallback inspection', t => {
  const f = new CoverageFixture(t); f.write('profile.custom-template', '<UserPicture />\n'); const [scope] = f.scope();
  assert.ok(scope.resolution.paths.includes('profile.custom-template')); assert.ok(scope.resolution.roster.some(c => c.path === 'profile.custom-template' && c.kind === 'source_fallback'));
});
test('unreviewed composition cannot become verified scope', t => {
  const f = new CoverageFixture(t), state = f.model(); Object.assign(state.relations[0], { confidence: 'INFERRED', review: { status: 'unreviewed' } });
  const [scope] = f.scope({ state }); assert.ok(scope.resolution.frontier.some(f => f.id.startsWith('unreviewed-relation:'))); assert.equal(f.assessment(f.reviewed(scope, state), state).change_complete, false);
});
test('new contracts reject bad code references and duplicate occurrence identities', t => {
  const f = new CoverageFixture(t), state = f.model(), task = plan(state.inventory, 'deep').tasks.find(t => t.role === 'repository-cartographer');
  const bundle = { schema_version: 1, task_id: task.id, snapshot: task.snapshot, entities: state.entities.map(without_review), relations: state.relations.map(without_review), evidence: state.evidence, gaps: [], review: REVIEW };
  validate(bundle, f.root, OUT, task, []); const duplicate = clone(bundle.entities.find(e => e.kind === 'occurrence')); duplicate.id = 'occurrence.duplicate'; bundle.entities.push(duplicate);
  assert.throws(() => validate(bundle, f.root, OUT, task, []), /Duplicate occurrence identity/); bundle.entities.pop(); bundle.entities.find(e => e.kind === 'occurrence').occurrence.implementation[0].end_line = 500;
  assert.throws(() => validate(bundle, f.root, OUT, task, []), /range/);
});
test('wire fixture contracts and pinned schema remain unchanged', () => {
  const directory = path.join(FIXTURES, 'change-knowledge'), valid = JSON.parse(fs.readFileSync(path.join(directory, 'valid-v1.json'), 'utf8'));
  validate_contract('change-knowledge', valid); validate_references(valid);
  for (const file of fs.readdirSync(directory).filter(f => /^invalid-.*\.json$/.test(f))) assert.throws(() => { const value = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')); validate_contract('change-knowledge', value); validate_references(value); }, file);
  const canonical = fileURLToPath(new URL('../schemas/change-knowledge.schema.json', import.meta.url)), pin = fs.readFileSync(path.join(directory, 'schema.sha256'), 'utf8').split(/\s+/)[0];
  assert.equal(createHash('sha256').update(fs.readFileSync(canonical)).digest('hex'), pin);
});
test('export rejects unrelated destination without overwriting it', t => {
  const f = new CoverageFixture(t), state = f.model(), file = path.join(f.temp, 'notes.json'); fs.writeFileSync(file, '{"notes":"keep"}');
  assert.throws(() => write_export(file, export_knowledge(state, state.inventory)), /unrelated/); assert.equal(fs.readFileSync(file, 'utf8'), '{"notes":"keep"}');
});
test('CLI validates separate gate and returns partial exit status', t => {
  const f = new CoverageFixture(t); assert.equal(f.cli('verify', '--require-change-complete'), 2); assert.equal(f.cli('scope', 'avatar presentation', '--intent', 'ui_standardization'), 0);
  const key = Object.keys(f.state().change_scopes)[0]; assert.equal(f.cli('verify', '--change-scope', key, '--require-change-complete'), 1); assert.equal(f.cli('verify'), 0);
});
test('full native apply and reviewed ledger CLI workflow', t => {
  const f = new CoverageFixture(t), result = f.run('scope', { mode: 'deep', change_request: f.request() }), key = result.change_scope, stored = f.state(), model = f.model();
  const all_paths = Object.keys(model.inventory.files), responses = []; let supplied = false;
  for (const task of stored.plan.tasks) {
    const refs = model.evidence.filter(r => task.paths.includes(r.path)); let entities, relations;
    if (!supplied && all_paths.every(p => task.paths.includes(p))) { entities = model.entities.map(without_review); relations = model.relations.map(without_review); supplied = true; }
    else { entities = [{ id: 'decision.' + task.role, kind: 'decision', title: 'Prepared investigation', summary: 'Prepared source-only fixture review for ' + task.role, confidence: 'EXTRACTED', evidence: [refs[0].id] }]; relations = []; }
    const response = { schema_version: 1, task_id: task.id, snapshot: task.snapshot, entities, relations, evidence: refs, gaps: [], review: REVIEW };
    responses.push(f.file(task.id + '.json', response));
  }
  assert.equal(supplied, true); f.run('apply', { finding_paths: responses }); const state = f.state(), scope = state.change_scopes[key], packet = f.packet(scope, state), file = f.file('review.json', packet);
  assert.equal(f.cli('apply', '--change-scope', key, '--ledger', file), 0); assert.equal(f.cli('verify', '--change-scope', key, '--require-change-complete'), 0);
  assert.equal(Object.keys(f.state().change_scopes[key].obligations).length, 10); assert.ok(fs.existsSync(path.join(f.root, OUT, 'changes', key + '.md')));
  assert.ok(fs.readdirSync(path.join(f.root, OUT, 'concepts')).some(p => p.endsWith('.md')));
});
test('punctuation-only scope is rejected', t => {
  const f = new CoverageFixture(t), s = f.model(); for (const topic of ['!!!', '---', '___', '  ']) assert.throws(() => resolve(topic, s.inventory, s.entities, s.relations, s.evidence), /scope|searchable/);
});
test('exclusion must inspect its own present surface', t => {
  const f = new CoverageFixture(t), standard = clone(STANDARD); standard.exclusions = [{ id: 'exclusion.profile', description: 'Profile is a deliberately reviewed exception.' }];
  const [scope, state] = f.scope({ request: f.request(standard) }), packet = f.packet(scope, state), item = packet.dispositions.find(x => scope.obligations[x.obligation].surface === 'ui_surface.profile');
  Object.assign(item, { disposition: 'excluded', exclusion: 'exclusion.profile', criteria: [] }); const original = [...item.evidence]; item.evidence = [state.evidence.find(e => e.path === 'pages/Billing.tsx').id];
  assert.throws(() => f.reviewed(scope, state, packet), /inspect|surface/); item.evidence = original; assert.equal(f.assessment(f.reviewed(scope, state, packet), state).change_complete, true);
});
test('exchange rejects wrong occurrence concept kind', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory); wire.occurrences[0].occurrence.concept = 'component.frame'; assert.throws(() => validate_references(wire), /membership/);
});
test('exchange rejects contradictory occurrence edges', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory); wire.relations.find(r => r.kind === 'occurs_on').target = 'ui_surface.profile'; assert.throws(() => validate_references(wire), /membership/);
});
test('exchange quarantines code references outside producer manifest', t => {
  const f = new CoverageFixture(t), state = f.model(), wire = export_knowledge(state, state.inventory); wire.evidence = wire.evidence.filter(e => e.path !== 'components/index.ts');
  const ids = new Set(wire.evidence.map(e => e.id)); for (const claim of [...wire.entities, ...wire.occurrences, ...wire.relations]) claim.evidence = claim.evidence.filter(key => ids.has(key));
  const ref = state.evidence.find(e => e.path === 'components/index.ts'); wire.entities[0].code_references = [{ repository: 'repository.local', path: ref.path, anchor: 'reexport', sha256: ref.sha256, start_line: 1, end_line: ref.end_line }];
  const manifest = wire.repositories[0].manifest; delete manifest.files[ref.path]; manifest.id = fingerprint(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'id')));
  const imported = import_knowledge(f.root, OUT, f.file('manifest-gap.json', wire)); assert.equal(imported.status, 'quarantined'); assert.ok(imported.gaps.some(g => g.reason.toLowerCase().includes('manifest')));
});
test('shared dependency retains relationship-only source', t => {
  const f = new CoverageFixture(t), state = f.model(), ref = state.evidence.find(e => e.path === 'components/index.ts');
  for (const entity of state.entities) entity.evidence = entity.evidence.filter(key => key !== ref.id); state.relations.find(r => r.id === 'relation.frame-picture').evidence = [ref.id];
  const [scope] = f.scope({ state }), obligation = Object.values(scope.obligations).find(o => o.surface === 'ui_surface.profile'); assert.ok(obligation.dependency_paths.includes('components/index.ts'));
});
test('updated occurrence cannot collide with a later known identity', t => {
  const f = new CoverageFixture(t), state = f.model({ second: true }), task = plan(state.inventory, 'deep').tasks.find(t => t.role === 'repository-cartographer');
  const existing = state.entities.filter(e => e.kind === 'occurrence' && e.occurrence.surface === 'ui_surface.profile'); assert.equal(existing.length, 2);
  const updated = clone(existing[0]); updated.occurrence = clone(existing[1].occurrence); delete updated.review;
  const bundle = { schema_version: 1, task_id: task.id, snapshot: task.snapshot, entities: [updated], relations: [], evidence: state.evidence, gaps: [], review: REVIEW };
  assert.throws(() => validate(bundle, f.root, OUT, task, state.entities), /Duplicate occurrence identity/);
});

test('inherited object keys cannot masquerade as known unresolved obligations', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(), before = clone(scope);
  for (const key of ['constructor', '__proto__', 'toString']) {
    const packet = f.packet(scope, state);
    packet.dispositions.push({ obligation: key, disposition: 'unresolved', criteria: [], evidence: [], rationale: 'Prepared unknown-key regression.' });
    assert.throws(() => f.reviewed(scope, state, packet), key === 'constructor' ? /Unknown change obligation/ : /invalid string format/);
    assert.deepEqual(scope, before);
  }
});
test('inherited object keys cannot masquerade as known unresolved discovery candidates', t => {
  const f = new CoverageFixture(t), [scope, state] = f.scope(), before = clone(scope);
  for (const key of ['constructor', '__proto__', 'toString']) {
    const packet = f.packet(scope, state);
    packet.candidates.push({ candidate: key, status: 'unresolved', occurrences: [], evidence: [], rationale: 'Prepared unknown-key regression.' });
    assert.throws(() => f.reviewed(scope, state, packet), key === 'constructor' ? /Unknown discovery candidate/ : /invalid string format/);
    assert.deepEqual(scope, before);
  }
});
