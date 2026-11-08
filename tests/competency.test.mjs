import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capture, read_source, split_lines, verify as check_evidence } from '../lib/understand_code/evidence.js';
import { head } from '../lib/understand_code/git.js';
import { inventory } from '../lib/understand_code/discovery.js';
import { balanced_paths } from '../lib/understand_code/spec/planner.js';
import { EngineFixture, OUT, REVIEW } from './helpers.mjs';

function persist(f, claims, edges = []) {
  f.bootstrap({ mode: 'deep' });
  const task = f.state().plan.tasks.find(t => t.role === 'repository-cartographer');
  const refs = Object.fromEntries([...new Set(claims.flatMap(([, , paths]) => paths))].map(p => [p,
    capture(p, read_source(f.root, p), 1, split_lines(read_source(f.root, p)).length, head(f.root))]));
  const entities = claims.map(([id, kind, paths]) => ({ id, kind, title: id, summary: 'Prepared claim: ' + id,
    confidence: 'EXTRACTED', evidence: paths.map(p => refs[p].id) }));
  const relations = edges.map(([source, target, p], i) => ({ id: 'relation.' + i, kind: 'affects', source, target,
    confidence: 'EXTRACTED', evidence: [refs[p].id] }));
  f.apply({ schema_version: 1, task_id: task.id, snapshot: task.snapshot, entities, relations,
    evidence: Object.values(refs), gaps: [], review: REVIEW });
  return Object.fromEntries(f.state().entities.map(e => [e.id, e]));
}

test('same-named settings retain distinct source evidence and reviewed identities', t => {
  const f = new EngineFixture(t, 'competency/same-setting-names');
  assert.match(f.read('admin/settings.py'), /UPLOAD_LIMIT_MB = 10\n/);
  assert.match(f.read('media/settings.py'), /UPLOAD_LIMIT_MB = 250\n/);
  const entities = persist(f, [['setting.admin-upload', 'setting', ['admin/settings.py']], ['setting.media-upload', 'setting', ['media/settings.py']]]);
  assert.notDeepEqual(entities['setting.admin-upload'].evidence, entities['setting.media-upload'].evidence);
});

test('prepared factory source distinguishes explicit registration from compatible dead code', t => {
  const f = new EngineFixture(t, 'competency/factory-registration');
  const registry = f.read('registry.py');
  assert.match(registry, /HANDLERS = \{'checkout': LiveHandler\}/);
  assert.match(registry, /return HANDLERS\[name\]\(\)/);
  assert.doesNotMatch(registry, /DeadHandler/);
  assert.match(f.read('handlers.py'), /class DeadHandler/);
  f.bootstrap();
  assert.ok(f.state().entities.every(e => e.kind === 'module'));
  assert.ok(f.state().inventory.candidates.every(c => c.confidence === 'INFERRED'));
});

test('prepared event source retains exact binding keys without inventing runtime edges', t => {
  const f = new EngineFixture(t, 'competency/string-event-binding');
  assert.match(f.read('producer.py'), /bus\.publish\('order.completed', \{'id': order_id\}\)/);
  assert.match(f.read('consumer.py'), /bus\.subscribe\('order.completed', send_receipt\)/);
  assert.match(f.read('consumer.py'), /bus\.subscribe\('order.refunded', lambda event: None\)/);
  f.bootstrap();
  assert.equal(f.state().relations.length, 0);
  assert.ok(f.state().inventory.candidates.some(c => c.kind === 'event'));
});

test('stale fixture documentation remains an explicit contradiction to queue source', t => {
  const f = new EngineFixture(t, 'competency/stale-doc-conflict');
  const before = f.read('README.md');
  assert.match(before, /synchronously/);
  assert.match(f.read('checkout.py'), /queue\.enqueue\('charge-card', order.id\)/);
  f.bootstrap();
  assert.equal(f.read('README.md'), before);
  const files = f.state().inventory.files;
  assert.equal(files['README.md'].kind, 'documentation');
  assert.equal(files['checkout.py'].kind, 'source');
});

test('missing backend authorization is preserved for source review instead of repaired', t => {
  const f = new EngineFixture(t, 'competency/missing-server-enforcement');
  const before = f.read('api.py');
  assert.match(before, /return request.db.delete_project\(project_id\)/);
  assert.match(f.read('web.ts'), /user.role === 'admin'/);
  f.bootstrap();
  assert.equal(f.read('api.py'), before);
  assert.ok(f.state().entities.every(e => e.kind !== 'permission'));
});

test('unrelated source edits preserve established claims and exact evidence', t => {
  const f = new EngineFixture(t, 'competency/unrelated-edit-preservation');
  const before = persist(f, [['feature.checkout', 'feature', ['feature.py']]])['feature.checkout'];
  f.write('unrelated.py', "BANNER_TEXT = 'Changed independently'\n");
  f.run('update');
  assert.deepEqual(f.state().entities.find(e => e.id === 'feature.checkout'), before);
});

test('dependency edits quarantine dependents while retaining isolated support claims', t => {
  const f = new EngineFixture(t, 'competency/dependency-edit-invalidation');
  persist(f, [['setting.tax', 'setting', ['config.py']], ['feature.checkout', 'feature', ['checkout.py']],
    ['setting.support', 'setting', ['unrelated.py']]], [['setting.tax', 'feature.checkout', 'config.py']]);
  f.write('config.py', 'TAX_RATE = 0.25\n'); f.run('update');
  const entities = Object.fromEntries(f.state().entities.map(e => [e.id, e]));
  assert.equal(entities['setting.tax'].confidence, 'UNKNOWN');
  assert.equal(entities['feature.checkout'].confidence, 'UNKNOWN');
  assert.equal(entities['setting.support'].confidence, 'EXTRACTED');
});

test('same paths in different repositories never share accepted claim evidence', t => {
  const a = new EngineFixture(t, 'competency/cross-repo-identity/repo-a');
  const b = new EngineFixture(t, 'competency/cross-repo-identity/repo-b');
  const entities = persist(a, [['feature.billing', 'feature', ['src/service.py']]]);
  b.bootstrap();
  assert.ok(!b.state().entities.some(e => e.id === 'feature.billing'));
  const ref = a.state().evidence.find(e => e.id === entities['feature.billing'].evidence[0]);
  assert.equal(check_evidence(a.root, ref, OUT), null);
  assert.ok(check_evidence(b.root, ref, OUT));
});

test('prepared retry source retains the explicit event and dependency boundary', t => {
  const f = new EngineFixture(t, 'competency/late-package-coverage');
  const before = f.read('zzz_payments/webhook.py');
  assert.match(before, /if request.event == 'payment.failed':\n        return retry_payment\(request.order_id\)/);
  assert.match(before, /return None\n/);
  f.bootstrap(); assert.equal(f.read('zzz_payments/webhook.py'), before);
});

test('quick cartography does not starve a late package and accounts for the entire roster', t => {
  const f = new EngineFixture(t, 'competency/late-package-coverage');
  for (const dir of ['aaa_noise', 'mmm_noise']) for (let n = 0; n < 80; n++)
    f.write(`${dir}/noise_${String(n).padStart(3, '0')}.py`, "def helper(): return 'noise'\n");
  f.bootstrap({ mode: 'quick' });
  const plan = f.state().plan, first = plan.tasks.find(t => t.role === 'repository-cartographer');
  assert.ok(first.paths.includes('zzz_payments/webhook.py'));
  assert.ok(plan.tasks.length <= 6);
  assert.ok(plan.tasks.every(t => t.paths.length <= 24));
  assert.ok(plan.deferred.length);
  const accounted = new Set([...plan.tasks, ...plan.deferred].filter(t => t.role === 'repository-cartographer').flatMap(t => t.paths));
  assert.deepEqual(accounted, new Set(Object.keys(inventory(f.root, OUT).files)));
});

test('nested package balancing is input-order independent and loses no paths', () => {
  const paths = [...Array.from({ length: 70 }, (_, n) => `packages/aaa/part/${String(n).padStart(3, '0')}.py`), 'packages/zzz/handler.py', 'README.md'];
  const result = balanced_paths(paths);
  assert.ok(result.slice(0, 3).includes('packages/zzz/handler.py'));
  assert.deepEqual(result, balanced_paths([...paths].reverse()));
  assert.deepEqual(new Set(result), new Set(paths)); assert.equal(result.length, paths.length);
});

test('renamed setting source retains its explicit serialized frontend policy boundary', t => {
  const f = new EngineFixture(t, 'competency/renamed-setting-mapping');
  const api = f.read('api/config.py'), web = f.read('web/upload.ts');
  assert.match(api, /return \{'maxUploadSize': attachment_limit\(\)\}/);
  assert.match(api, /return size_bytes <= attachment_limit\(\)/);
  assert.match(web, /return bytes <= policy.maxUploadSize;/); assert.doesNotMatch(web, /10 \* 1024/);
  const entities = persist(f, [['setting.attachment-policy', 'setting', ['api/config.py', 'web/upload.ts']]]);
  assert.equal(entities['setting.attachment-policy'].evidence.length, 2);
});
