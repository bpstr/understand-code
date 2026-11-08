/** Deterministic reconstruction lifecycle. No provider subprocesses or network. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { __version__ } from './index.js';
import { audit } from './audit.js';
import { inventory } from './discovery.js';
import { safe_path, verify as check_evidence } from './evidence.js';
import { validate, reconcile } from './findings.js';
import { changes } from './git.js';
import { analyze } from './impact.js';
import { canonical_json, check_id, digest, stable_id } from './ontology.js';
import { render as prompt } from './providers/index.js';
import { plan, schedule_followups } from './spec/planner.js';
import * as coverage from './coverage.js';
import { import_knowledge } from './exchange.js';
import { write, render, json_text, jsonl, split_generated } from './spec/writer.js';
type Obj = Record<string, any>;

export function load(root: string, output: string): Obj | null {
  const target = safe_path(root, output), marker = path.join(target, '_meta/manifest.json');
  // lstat detects dangling symlinks too; never use existence as a safety assertion.
  safe_path(root, `${output}/_meta/manifest.json`);
  if (!fs.existsSync(marker)) return null;
  for (const name of ['manifest.json', 'inventory.json', 'plan.json', 'entities.jsonl', 'relations.jsonl', 'evidence.jsonl', 'gaps.json', 'audit.json'])
    safe_path(root, `${output}/_meta/${name}`);
  const read = (name: string): any => JSON.parse(fs.readFileSync(path.join(target, '_meta', name), 'utf8'));
  const lines = (name: string): Obj[] => fs.readFileSync(path.join(target, '_meta', name), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const manifest = read('manifest.json');
  if (manifest.schema_version !== 1 || manifest.producer !== 'understand-code') throw new Error('Unsupported or unowned Codebase Spec manifest');
  for (const name of Object.keys(manifest.managed ?? {})) safe_path(root, output + '/' + name);
  for (const [name, expected] of Object.entries(manifest.metadata_hashes ?? {})) {
    const file = safe_path(root, output + '/' + name);
    if (digest(fs.readFileSync(file, 'utf8')) !== expected) throw new Error(`Metadata integrity check failed: ${name}; restore the original metadata before continuing`);
  }
  for (const optional of ['_meta/change-scopes/index.json', '_meta/knowledge-imports.json', '_meta/retired-claims.json']) {
    const file = safe_path(root, output + '/' + optional);
    if (fs.existsSync(file) && !Object.hasOwn(manifest.metadata_hashes ?? {}, optional)) throw new Error('Untracked optional metadata');
  }
  const scopeIds = fs.existsSync(path.join(target, '_meta/change-scopes/index.json')) ? read('change-scopes/index.json') : [];
  if (!Array.isArray(scopeIds) || scopeIds.length > 1000) throw new Error('Invalid change-scope index');
  const scopes: Obj = {};
  for (const key of scopeIds) {
    if (!check_id(key)) throw new Error('Invalid change-scope ID');
    const filename = `_meta/change-scopes/${key}/scope.json`;
    if (!Object.hasOwn(manifest.metadata_hashes ?? {}, filename)) throw new Error('Untracked change-scope metadata');
    safe_path(root, output + '/' + filename);
    scopes[key] = read(`change-scopes/${key}/scope.json`);
    if (scopes[key].schema_version !== 1 || scopes[key].id !== key) throw new Error('Unsupported change-scope state');
  }
  const imports = fs.existsSync(path.join(target, '_meta/knowledge-imports.json')) ? read('knowledge-imports.json') : [];
  const retired = fs.existsSync(path.join(target, '_meta/retired-claims.json')) ? read('retired-claims.json') : [];
  return { manifest, change_scopes: scopes, knowledge_imports: imports, retired_claims: retired,
    inventory: read('inventory.json'), plan: read('plan.json'), entities: lines('entities.jsonl'), relations: lines('relations.jsonl'),
    evidence: lines('evidence.jsonl'), gaps: read('gaps.json'), audit: read('audit.json') };
}

export function lock<T>(root: string, output: string, operation: () => T): T {
  const filename = path.join(os.tmpdir(), 'understand-code-' + digest(path.join(root, output)) + '.lock');
  let fd: number;
  try { fd = fs.openSync(filename, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another writer holds ${filename}. If interrupted, inspect its PID before removing this stale lock.`);
    throw error;
  }
  try { fs.writeFileSync(fd, String(process.pid)); }
  catch (error) { fs.closeSync(fd); fs.rmSync(filename, { force: true }); throw error; }
  fs.closeSync(fd);
  try { return operation(); } finally { fs.rmSync(filename, { force: true }); }
}
export function baseline(inv: Obj): Obj[] {
  const groups: Record<string, string[]> = Object.create(null);
  for (const [filename, info] of Object.entries(inv.files) as [string, Obj][]) {
    if (info.language && info.evidence) (groups[path.posix.dirname(filename)] ??= []).push(info.evidence);
  }
  return Object.entries(groups).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([parent, refs]) => ({
    id: stable_id('module', parent), kind: 'module', title: parent,
    summary: `Source directory ${parent}; module responsibility and business behavior remain unverified.`,
    confidence: 'EXTRACTED', evidence: refs,
    review: { status: 'source-reviewed', reviewer: 'deterministic inventory', method: 'Directory membership only; no behavioral assertion' },
  }));
}
export interface RunOptions {
  change_request?: Obj | null; change_scope?: string | null; ledger_paths?: string[] | null;
  knowledge_path?: string | null; amend_standard?: boolean;
}
export function run(root: string, output: string, command: string, mode = 'standard', provider = 'codex',
  focus: string | null = null, base: string | null = null, finding_paths: string[] | null = null,
  max_files = 2000, max_bytes = 5_000_000, options: RunOptions = {}): Obj {
  root = fs.realpathSync(root);
  const target = safe_path(root, output);
  const first = output.split('/').filter(p => p && p !== '.')[0];
  if (target === root || !output.trim() || ['src', 'tests', 'skills', '.git', '.github'].includes(first))
    throw new Error('Choose a dedicated documentation directory, not source, repository root, or tool configuration');
  if (!Number.isSafeInteger(max_files) || max_files < 1 || !Number.isSafeInteger(max_bytes) || max_bytes < 1) throw new Error('Scan budgets must be positive integers');
  let { change_request = null, change_scope = null } = options;
  const { ledger_paths = [], knowledge_path = null, amend_standard = false } = options;
  return lock(root, output, () => {
    const old = load(root, output);
    const selected_scope = old && change_scope ? old.change_scopes?.[change_scope] : null;
    if (change_scope && !selected_scope) throw new Error('Unknown change scope');
    if (ledger_paths?.length && !change_scope) throw new Error('Change-review ingestion requires --change-scope');
    if (selected_scope && command === 'scope') {
      if (change_request && canonical_json(change_request) !== canonical_json(selected_scope.request) && !amend_standard)
        throw new Error('Scope resume cannot silently change its accepted request or standard');
      change_request ??= selected_scope.request;
    }
    if (command === 'scope' && !change_request) throw new Error('Scope creation requires a change request');
    if (command === 'scope') focus = change_request!.topic;
    if (['update', 'focus', 'apply', 'import-knowledge'].includes(command) && !old) throw new Error('No Codebase Spec exists. Run bootstrap first.');
    const inv = inventory(root, output, max_files, max_bytes);
    let entities: Obj[] = old ? old.entities : baseline(inv), relations: Obj[] = old?.relations ?? [];
    const previous_refs: Obj[] = old?.evidence ?? [];
    const impact = old ? analyze(old.inventory, inv, entities, relations, previous_refs, base ? changes(root, base) : null) : null;
    const stale_refs = new Set(previous_refs.filter(r => check_evidence(root, r, output)).map(r => r.id));
    const affected = new Set(impact?.affected_entities ?? []);
    entities = entities.map(e => affected.has(e.id) || e.evidence.some((id: string) => stale_refs.has(id)) ? { ...e, confidence: 'UNKNOWN', stale: true } : e);
    relations = relations.map(r => affected.has(r.source) || affected.has(r.target) || r.evidence.some((id: string) => stale_refs.has(id)) ? { ...r, confidence: 'UNKNOWN', stale: true } : r);
    let task_plan: Obj;
    const sourceMap = (value: Obj): Obj => Object.fromEntries(Object.entries(value.files).map(([p, v]: [string, any]) => [p, v.sha256]));
    if (command === 'apply') {
      task_plan = old!.plan;
      if (digest(canonical_json(sourceMap(inv))) !== task_plan.snapshot) throw new Error('Source changed during investigation. Run update and investigate the refreshed tasks.');
    } else if (command === 'update' && old && !impact!.changed_files.length) task_plan = old.plan;
    else {
      task_plan = plan(inv, mode, focus, command === 'update' ? impact : null, entities, relations, previous_refs,
        change_request ? coverage.scope_options(change_request) : null);
      if (old) {
        const accepted = new Map<string, Obj>(old.plan.tasks.filter((t: Obj) => t.status === 'accepted').map((t: Obj) => [t.id, t]));
        for (const task of task_plan.tasks) if (accepted.has(task.id)) { task.status = 'accepted'; task.review = accepted.get(task.id)!.review ?? { status: 'unreviewed' }; }
      }
    }
    if (old && ['focus', 'update', 'scope', 'import-knowledge'].includes(command) && task_plan !== old.plan) {
      const signature = (t: Obj): string => canonical_json([t.role, t.paths]);
      const active = new Set(task_plan.tasks.map(signature));
      for (const task of old.plan.tasks) if (task.status !== 'accepted' && !active.has(signature(task)))
        task_plan.deferred.push({ role: task.role, paths: task.paths, reason: 'unfinished prior scope; rerun bootstrap or focus to schedule' });
      task_plan.deferred.push(...old.plan.deferred);
      task_plan.deferred = [...new Map(task_plan.deferred.filter((t: Obj) => !active.has(signature(t))).map((t: Obj) => [canonical_json(t), t])).values()];
      task_plan.followups = old.plan.followups ?? [];
    }
    if (old) {
      const notes: Obj[] = [];
      for (const filename of Object.keys(old.manifest.managed)) {
        const text = fs.readFileSync(safe_path(root, output + '/' + filename), 'utf8');
        const [, suffix] = split_generated(text);
        const marker = '<!-- understand-code:human -->', at = suffix.indexOf(marker);
        const note = (at >= 0 ? suffix.slice(at + marker.length) : suffix).trim();
        if (note) notes.push({ path: output + '/' + filename, note: Array.from(note).slice(0, 4000).join(''), authority: 'maintainer assertion; verify source separately' });
      }
      for (const task of task_plan.tasks) task.maintainer_notes = notes.slice(0, 30);
    }
    const bundles: Obj[] = [], tasks: Obj = Object.fromEntries(task_plan.tasks.map((t: Obj) => [t.id, t])), known = [...entities];
    for (const file of finding_paths ?? []) {
      if (fs.statSync(file).size > 5_000_000) throw new Error('Findings file exceeds 5 MB');
      const bundle = JSON.parse(fs.readFileSync(file, 'utf8')), task = tasks[bundle.task_id];
      if (!task) throw new Error('Findings reference an unknown task; use the current plan');
      validate(bundle, root, output, task, known); bundles.push(bundle); known.push(...bundle.entities);
    }
    let new_gaps: Obj[];
    [entities, relations, new_gaps] = reconcile(entities, relations, bundles);
    const retired: Obj[] = [...(old?.retired_claims ?? [])], retirements = bundles.flatMap(b => b.retirements ?? []);
    const retiring = new Set(retirements.map(r => r.id)), claims: Obj = Object.fromEntries([...entities, ...relations].map(c => [c.id, c]));
    if (retiring.size !== retirements.length) throw new Error('Duplicate retirement ID');
    if ([...retiring].some(id => !Object.hasOwn(claims, id))) throw new Error('Retirement references an unknown claim');
    for (const relation of relations) if ((retiring.has(relation.source) || retiring.has(relation.target)) && !retiring.has(relation.id))
      throw new Error('Retire dependent relations explicitly; do not leave dangling endpoints');
    for (const entity of entities) if ((retiring.has(entity.occurrence?.concept) || retiring.has(entity.occurrence?.surface)) && !retiring.has(entity.id))
      throw new Error('Retire dependent occurrences explicitly');
    const all_refs: Obj = Object.fromEntries([...previous_refs, ...inv.evidence, ...bundles.flatMap(b => b.evidence)].map(r => [r.id, r]));
    for (const bundle of bundles) for (const retirement of bundle.retirements ?? []) {
      const claim = claims[retirement.id];
      retired.push({ claim, retirement, review: bundle.review, snapshot: task_plan.snapshot,
        evidence: [...claim.evidence, ...retirement.evidence].filter(key => Object.hasOwn(all_refs, key)).map(key => all_refs[key]) });
    }
    entities = entities.filter(e => !retiring.has(e.id)); relations = relations.filter(r => !retiring.has(r.id));
    for (const bundle of bundles) { tasks[bundle.task_id].status = 'accepted'; tasks[bundle.task_id].review = bundle.review; }
    for (const task of task_plan.tasks) delete task.graph_context;
    schedule_followups(task_plan, bundles.flatMap(b => b.followups ?? []), inv);
    let refs: Obj = { ...all_refs };
    for (const task of task_plan.tasks) {
      const scoped = new Set(Object.entries(refs).filter(([, ref]) => task.paths.includes(ref.path)).map(([key]) => key));
      const concepts = entities.filter(e => e.evidence.some((key: string) => scoped.has(key))), ids = new Set(concepts.map(e => e.id));
      task.current_model = { entities: concepts.slice(0, 100), relations: relations.filter(r => ids.has(r.source) || ids.has(r.target)).slice(0, 200),
        note: 'Existing interpretations to reconcile and challenge, not authority over current source.' };
    }
    const alternatives: Obj[] = [...(old?.gaps ?? []), ...new_gaps].flatMap(g => g.alternatives ?? []);
    const used_refs = new Set([...entities, ...relations, ...alternatives].flatMap(e => e.evidence).concat(inv.evidence.map((r: Obj) => r.id)));
    refs = Object.fromEntries(Object.entries(refs).filter(([key]) => used_refs.has(key)));
    const gaps: Obj = Object.fromEntries([...(old?.gaps ?? []), ...new_gaps].map(g => [g.id, g]));
    for (const bundle of bundles) {
      for (const resolution of bundle.resolved_gaps ?? []) {
        if (!Object.hasOwn(gaps, resolution.id)) throw new Error('Gap closure references an unknown gap');
        delete gaps[resolution.id];
      }
      if (bundle.review.status === 'source-reviewed') for (const claim of [...bundle.entities, ...bundle.relations])
        if (claim.supersedes === claim.id) delete gaps[stable_id('knowledge_gap', claim.id + 'conflict')];
    }
    delete gaps['knowledge_gap.graphify'];
    const state: Obj = { inventory: inv, plan: task_plan, entities, relations, evidence: Object.values(refs), gaps: Object.values(gaps),
      audit: audit(root, inv), retired_claims: retired, knowledge_imports: old?.knowledge_imports ?? [] };
    if (knowledge_path !== null) {
      const imported = import_knowledge(root, output, knowledge_path);
      if (!state.knowledge_imports.some((item: Obj) => item.sha256 === imported.sha256)) state.knowledge_imports.push(imported);
    }
    const scopes: Obj = {};
    for (const [key, previous] of Object.entries(old?.change_scopes ?? {}) as [string, Obj][])
      scopes[key] = coverage.refresh(previous, key === change_scope && change_request ? change_request : previous.request, state, amend_standard && key === change_scope);
    if (command === 'scope' && !selected_scope) {
      const created = coverage.refresh(null, change_request!, state); change_scope = created.id;
      if (!Object.hasOwn(scopes, created.id)) scopes[created.id] = created;
    }
    for (const filename of ledger_paths ?? []) {
      if (fs.statSync(filename).size > 5_000_000) throw new Error('Change review exceeds 5 MB');
      scopes[change_scope!] = coverage.apply_review(scopes[change_scope!], JSON.parse(fs.readFileSync(filename, 'utf8')), root, output);
    }
    for (const task of task_plan.tasks) task.knowledge_context = state.knowledge_imports.slice(0, 20).map((item: Obj) => ({
      producer: item.producer, generation: item.sha256, status: item.status,
      candidates: item.candidates.filter((c: Obj) => task.paths.includes(c.path)).slice(0, 100),
      note: 'External hints only; recapture source and review before native findings.',
    }));
    state.change_scopes = scopes;
    const document_owners: Obj = { ...(old?.manifest.document_owners ?? {}) };
    for (const entity of entities) for (const document of entity.documentation ?? []) {
      document_owners[document.id] ??= entity.id;
      if (document_owners[document.id] !== entity.id) throw new Error('Document ID belongs to another historical entity; use a new document ID');
    }
    const docs = render(state, output);
    const manifest = { producer: 'understand-code', schema_version: 1, version: __version__, commit: inv.commit, snapshot: task_plan.snapshot, mode, provider,
      code_intelligence: 'host-managed according to applicable agent instructions; external retrieval is never evidence',
      coverage: { files: Object.keys(inv.files).length, skipped: inv.skipped.length, entities: entities.length, relations: relations.length, gaps: Object.keys(gaps).length,
        pending_tasks: task_plan.tasks.filter((t: Obj) => t.status !== 'accepted').length, deferred_scopes: task_plan.deferred.length },
      validation: 'mechanical source checks only; semantic review is recorded separately', document_owners, output };
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries({ inventory: inv, plan: task_plan, gaps: state.gaps, audit: state.audit, impact })) metadata[`_meta/${key}.json`] = json_text(value);
    for (const key of ['entities', 'relations', 'evidence']) metadata[`_meta/${key}.jsonl`] = jsonl(state[key]);
    metadata['_meta/change-scopes/index.json'] = json_text(Object.keys(scopes).sort());
    metadata['_meta/knowledge-imports.json'] = json_text(state.knowledge_imports);
    metadata['_meta/retired-claims.json'] = json_text(retired);
    for (const [key, scope] of Object.entries(scopes)) {
      const prefix = `_meta/change-scopes/${key}/`;
      metadata[prefix + 'scope.json'] = json_text(scope);
      metadata[prefix + 'review-template.json'] = json_text(coverage.review_template(scope));
      metadata[prefix + 'coverage.json'] = json_text(coverage.assess(scope, state, inv));
    }
    for (const bundle of bundles) { const text = json_text(bundle); metadata['_meta/findings/' + digest(text) + '.json'] = text; }
    for (const task of task_plan.tasks) metadata[`_meta/tasks/${task.id}.md`] = prompt(provider, task);
    const after = inventory(root, output, max_files, max_bytes);
    if (canonical_json(sourceMap(after)) !== canonical_json(sourceMap(inv))) throw new Error('Source changed during reconstruction; nothing published. Retry against a stable checkout.');
    write(target, docs, metadata, manifest);
    return { repository: root, output: target, command, change_scope,
      change_coverage: change_scope ? coverage.assess(scopes[change_scope], state, inv) : null, coverage: manifest.coverage,
      next_step: 'Investigate pending native tasks, apply source-reviewed findings, then verify the resulting spec.' };
  });
}
