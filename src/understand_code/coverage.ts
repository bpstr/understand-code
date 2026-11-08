/** Snapshot-bound obligations and source-reviewed completion contracts.
 * This module never edits sources, executes tests, or invokes providers.
 */
import { isDeepStrictEqual } from 'node:util';
import { POLICY, established, fingerprint, in_boundary, resolve, source_manifest, validate_boundaries, type ScopeOptions } from './change_scope.js';
import { validate_contract } from './contracts.js';
import { verify as verify_evidence } from './evidence.js';
import { stable_id } from './ontology.js';
import { timezone_timestamp } from './documentation.js';

type Data = Record<string, any>;
export const DISPOSITIONS = ['changed_directly', 'changed_via_shared_dependency', 'already_compliant', 'excluded', 'removed', 'unresolved'] as const;
function intersection(a: Iterable<string>, b: Iterable<string>): Set<string> {
  const right = new Set(b); return new Set([...a].filter(x => right.has(x)));
}
function intersects(a: Iterable<string>, b: Iterable<string>): boolean { return intersection(a, b).size > 0; }
function paths_of(claim: Data, refs: Record<string, Data>): Set<string> {
  return new Set((claim.evidence ?? []).filter((key: string) => Object.hasOwn(refs, key)).map((key: string) => refs[key].path));
}

export function validate_standard(standard: Data): void {
  validate_contract('change-standard', standard);
  for (const key of ['criteria', 'required_checks', 'exclusions']) {
    if (new Set(standard[key].map((item: Data) => item.id)).size !== standard[key].length) throw new Error('Duplicate standard item ID');
  }
  const criteria: Record<string, Data> = Object.fromEntries(standard.criteria.map((c: Data) => [c.id, c]));
  const checks: Data[] = standard.required_checks;
  if (checks.some(c => c.criteria.some((key: string) => !Object.hasOwn(criteria, key)))) throw new Error('Behavioral check names an unknown criterion');
  const required = Object.values(criteria).filter(c => c.verification === 'behavioral').map(c => c.id);
  const supplied = new Set(checks.flatMap(check => check.criteria));
  if (required.some(key => !supplied.has(key))) throw new Error('Behavioral criteria must declare required execution checks');
}
export function new_request(topic: string, intent: string, standard: Data | null = null, options: ScopeOptions = {}): Data {
  if (standard !== null) validate_standard(standard);
  return { topic, intent, standard: standard ?? { id: 'standard.unspecified', criteria: [], required_checks: [], exclusions: [] },
    boundaries: validate_boundaries(options.boundaries ?? []), examples: validate_boundaries(options.examples ?? []),
    exclusions: validate_boundaries(options.exclusions ?? []), max_depth: options.max_depth ?? 8, max_nodes: options.max_nodes ?? 500 };
}
export function scope_options(request: Data): ScopeOptions {
  return Object.fromEntries(['intent', 'boundaries', 'examples', 'exclusions', 'max_depth', 'max_nodes'].map(key => [key, request[key]]));
}
function composition_of(surface: string, entities: Record<string, Data>, relations: Data[], refs: Record<string, Data>): [string[], string[]] {
  const queue = [surface], seen = new Set<string>(), paths = new Set<string>(), edges = new Set<string>();
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const relation of relations) {
      let other: string | undefined;
      if (['renders', 'implemented_by'].includes(relation.kind) && relation.source === key) other = relation.target;
      if (relation.kind === 'reused_by' && relation.target === key) other = relation.source;
      if (other && established(relation) && established(entities[other] ?? {})) {
        edges.add(relation.id);
        for (const p of [...paths_of(entities[other], refs), ...paths_of(relation, refs)]) paths.add(p);
        queue.push(other);
      }
    }
  }
  return [[...paths].sort(), [...edges].sort()];
}
function obligation_for(key: string, kind: string, state: Data): Data {
  const entities: Record<string, Data> = Object.fromEntries(state.entities.map((e: Data) => [e.id, e]));
  const refs: Record<string, Data> = Object.fromEntries(state.evidence.map((r: Data) => [r.id, r]));
  const entity = entities[key];
  const surface = entity.occurrence?.surface ?? key;
  const consumer_paths = [...paths_of(entities[surface] ?? {}, refs)].sort();
  const [dependencies, composition] = composition_of(surface, entities, state.relations, refs);
  const implementation: Data[] = entity.occurrence?.implementation ?? [];
  const paths = new Set([...paths_of(entity, refs), ...implementation.map(r => r.path), ...consumer_paths, ...dependencies]);
  return { id: kind === 'occurrence' ? key : 'anchor.' + stable_id('surface', key), subject: key, kind, surface, title: entity.title,
    conditions: entity.occurrence?.conditions ?? [], anchor: entity.occurrence?.anchor ?? key,
    implementation, paths: [...paths].sort(), consumer_paths, dependency_paths: dependencies, composition, evidence: entity.evidence };
}

/** Rediscover independently and retain the union of every observed obligation. */
export function refresh(previous: Data | null, request: Data, state: Data, amend_standard = false): Data {
  const resolution = resolve(request.topic, state.inventory, state.entities, state.relations, state.evidence, scope_options(request));
  const generations = (state.knowledge_imports ?? []).map((item: Data) => ({ producer: item.producer, sha256: item.sha256 }));
  const source = current_source(previous ?? {}, state.inventory, generations);
  const model = fingerprint({ entities: state.entities, relations: state.relations, gaps: state.gaps });
  const revision = fingerprint({ source: source.id, model, request, resolution });
  let current_obligations: Data[] = [...resolution.occurrences.map((key: string) => obligation_for(key, 'occurrence', state)),
    ...resolution.required_anchors.map((key: string) => obligation_for(key, 'anchor', state))];
  // A declared boundary may exclude an anchor; preserve that fact explicitly.
  const excluded_anchors = current_obligations.filter(item => item.kind === 'anchor'
    && !item.consumer_paths.some((p: string) => in_boundary(p, request.boundaries, request.exclusions)));
  current_obligations = current_obligations.filter(item => !excluded_anchors.includes(item));
  let scope: Data;
  if (previous === null) {
    const key = stable_id('change', fingerprint({ request, baseline: source.id }));
    scope = { schema_version: 1, id: key, policy: POLICY, request: structuredClone(request), baseline: structuredClone(source),
      baseline_model: model, obligations: {}, candidates: {}, dispositions: {}, candidate_reviews: {}, policy_reviews: {},
      executions: {}, reviews: [], passes: [], identity_mappings: {} };
  } else {
    if (!isDeepStrictEqual(previous.request, request)) {
      const without_standard = (value: Data) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'standard'));
      if (!amend_standard || !isDeepStrictEqual(without_standard(previous.request), without_standard(request))) {
        throw new Error("Cannot silently change a scope's standard/boundary");
      }
      validate_standard(request.standard);
    }
    scope = structuredClone(previous);
    if (!isDeepStrictEqual(scope.request, request)) {
      (scope.request_history ??= []).push({ request: scope.request, revision: scope.revision });
      scope.request = structuredClone(request);
    }
  }
  for (const item of Object.values(scope.obligations) as Data[]) item.present = false;
  for (const item of current_obligations) {
    const prior = scope.obligations[item.id] ?? {};
    scope.obligations[item.id] = { ...item, present: true, first_seen: prior.first_seen ?? revision };
  }
  for (const item of Object.values(scope.candidates) as Data[]) item.present = false;
  for (const item of resolution.roster) {
    const prior = scope.candidates[item.id] ?? {};
    scope.candidates[item.id] = { ...item, present: true, first_seen: prior.first_seen ?? revision };
  }
  Object.assign(scope, { target: source, model, revision, resolution, excluded_anchors });
  if (!scope.passes.length || scope.passes.at(-1).revision !== revision) {
    scope.passes.push({ revision, source_snapshot: source.id, model, policy: POLICY,
      roster: resolution.roster.map((c: Data) => c.id), obligations: current_obligations.map(o => o.id),
      observed_obligations: structuredClone(current_obligations), source_manifest: structuredClone(source),
      observed_roster: structuredClone(resolution.roster), evidence: structuredClone(state.evidence.filter((e: Data) => resolution.paths.includes(e.path))) });
  }
  return scope;
}
export function current_source(scope: Data, inv: Data, generations: Data[]): Data {
  const manifest = source_manifest(inv, [], [], generations);
  const omitted = new Set([...manifest.ignored, ...manifest.limitations].map(x => x.path));
  manifest.deleted = [...new Set([...manifest.deleted,
    ...Object.keys(scope.baseline?.files ?? {}).filter(p => !Object.hasOwn(manifest.files, p) && !omitted.has(p))])].sort();
  manifest.id = fingerprint(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'id')));
  return manifest;
}
export function review_template(scope: Data): Data {
  return { schema_version: 1, change_scope: scope.id, baseline_snapshot: scope.baseline.id, target_snapshot: scope.target.id,
    revision: scope.revision, review: { status: 'unreviewed' }, evidence: [], dispositions: [], candidates: [], policies: [], executions: [], identity_mappings: [] };
}

/** Validate the whole packet before modifying even the in-memory scope. */
export function apply_review(scope: Data, packet: Data, root: string, output: string): Data {
  validate_contract('change-review', packet);
  const expected = review_template(scope);
  if (['change_scope', 'baseline_snapshot', 'target_snapshot', 'revision'].some(key => packet[key] !== expected[key])) {
    throw new Error('Change review does not match current baseline/target/revision; rediscover and review again');
  }
  const review = packet.review;
  if (review.status !== 'source-reviewed' || !['reviewer', 'method'].every(k => (review[k] ?? '').trim())) {
    throw new Error('Change dispositions require an accountable source review');
  }
  const refs: Record<string, Data> = Object.fromEntries(packet.evidence.map((e: Data) => [e.id, e]));
  if (Object.keys(refs).length !== packet.evidence.length) throw new Error('Duplicate change-review evidence ID');
  for (const ref of Object.values(refs)) {
    const error = verify_evidence(root, ref, output);
    if (error || scope.target.files[ref.path] !== ref.sha256 || ref.commit !== scope.target.commit) {
      throw new Error(`Invalid current change-review evidence: ${error || ref.path}`);
    }
  }
  function evidence_paths(ids: string[], required = true): Set<string> {
    if ((required && !ids.length) || ids.some(key => !Object.hasOwn(refs, key))) throw new Error('Review item requires supplied current evidence');
    return new Set(ids.map(key => refs[key].path));
  }
  const criteria = new Set<string>(scope.request.standard.criteria.map((c: Data) => c.id));
  const exclusions = new Set<string>(scope.request.standard.exclusions.map((x: Data) => x.id));
  const changed = new Set(Object.keys(scope.target.files).filter(p => scope.baseline.files[p] !== scope.target.files[p]));
  for (const [key, identity] of [['dispositions', 'obligation'], ['candidates', 'candidate'], ['executions', 'id'], ['identity_mappings', 'baseline']]) {
    const records: Data[] = packet[key] ?? [];
    if (new Set(records.map(r => r[identity])).size !== records.length) throw new Error(`Duplicate ${key} in change review`);
  }
  for (const item of packet.dispositions) {
    const obligation = Object.hasOwn(scope.obligations, item.obligation) ? scope.obligations[item.obligation] : undefined;
    if (!obligation) throw new Error('Unknown change obligation');
    const disposition = item.disposition;
    const paths = evidence_paths(item.evidence, disposition !== 'unresolved');
    const assessed = new Set<string>(item.criteria);
    if (!['excluded', 'unresolved'].includes(disposition) && (!criteria.size || !isDeepStrictEqual(assessed, criteria))) {
      throw new Error('Disposition must assess every explicit acceptance criterion');
    }
    if ([...assessed].some(key => !criteria.has(key))) throw new Error('Unknown acceptance criterion');
    if (disposition === 'excluded') {
      if (!exclusions.has(item.exclusion)) throw new Error('Unauthorized scope narrowing: exclusion must be declared in the standard');
      const surviving = intersection(obligation.consumer_paths, Object.keys(scope.target.files));
      if (surviving.size && !intersects(paths, surviving)) throw new Error('Exclusion must inspect this occurrence/surface, not an unrelated file');
    } else if (disposition === 'removed') {
      if (obligation.present || item.intentional !== true) throw new Error('Removal requires an absent obligation and intentional reviewed removal');
      const surviving = intersection(obligation.consumer_paths, Object.keys(scope.target.files));
      if (surviving.size && !intersects(intersection(surviving, changed), paths)) {
        throw new Error('A disappeared model/detector is not evidence of source removal; review changed consumer source or reconcile identity');
      }
    } else if (disposition !== 'unresolved') {
      if (!obligation.present) throw new Error('Missing obligation requires removal, identity reconciliation or unresolved status');
      if (!intersects(paths, obligation.consumer_paths)) throw new Error('Disposition must inspect this occurrence/surface, not an unrelated file');
      if (disposition === 'changed_directly' && !intersects(intersection(paths, changed), obligation.consumer_paths)) {
        throw new Error('Direct change requires a baseline-to-target implementation change');
      }
      if (disposition === 'changed_via_shared_dependency') {
        const consumer = evidence_paths(item.consumer_evidence ?? []);
        const dependency = evidence_paths(item.dependency_evidence ?? []);
        if (!intersects(consumer, obligation.consumer_paths) || !obligation.composition.length
            || !intersects(intersection(dependency, changed), obligation.dependency_paths)) {
          throw new Error('Shared change requires changed dependency and a surviving reviewed consumer path');
        }
      }
    }
  }
  for (const item of packet.candidates) {
    const candidate = Object.hasOwn(scope.candidates, item.candidate) ? scope.candidates[item.candidate] : undefined;
    if (!candidate) throw new Error('Unknown discovery candidate');
    const paths = evidence_paths(item.evidence, item.status !== 'unresolved');
    if (item.status === 'removed') {
      if (candidate.present || item.intentional !== true || Object.hasOwn(scope.target.files, candidate.path)) throw new Error('Candidate removal needs intentional source removal');
    } else if (item.status !== 'unresolved') {
      if (!candidate.present || !paths.has(candidate.path)) throw new Error("Discovery review must inspect the candidate's own source");
    }
    if (item.status === 'modeled') {
      if (!item.occurrences.length || item.occurrences.some((key: string) => !Object.hasOwn(scope.obligations, key)
        || !scope.obligations[key].present || scope.obligations[key].kind !== 'occurrence' || !scope.obligations[key].paths.includes(candidate.path))) {
        throw new Error('Modeled candidate requires current occurrences bound to its source');
      }
    }
    if (item.status === 'not_relevant' && (Object.values(scope.obligations) as Data[]).some(o => o.present && o.paths.includes(candidate.path))) {
      throw new Error('Known occurrence/anchor cannot be dismissed as an unrelated candidate');
    }
  }
  if (packet.policies.some((p: string) => !scope.resolution.required_policies.includes(p))) throw new Error('Unknown discovery policy');
  const checks: Record<string, Data> = Object.fromEntries(scope.request.standard.required_checks.map((c: Data) => [c.id, c]));
  for (const execution of packet.executions) {
    const check = Object.hasOwn(checks, execution.id) ? checks[execution.id] : undefined;
    if (!check || execution.command !== check.command || execution.source_snapshot !== scope.target.id) {
      throw new Error('Execution provenance does not match the declared check/current source snapshot');
    }
    if (!timezone_timestamp(execution.executed_at)) throw new Error('Execution provenance requires an ISO-8601 timestamp with a timezone');
  }
  for (const mapping of packet.identity_mappings ?? []) {
    const before = Object.hasOwn(scope.obligations, mapping.baseline) ? scope.obligations[mapping.baseline] : undefined;
    const after = Object.hasOwn(scope.obligations, mapping.target) ? scope.obligations[mapping.target] : undefined;
    if (!before || before.present || !after || !after.present || before.kind !== after.kind) {
      throw new Error('Identity mapping requires a missing baseline and current target of the same kind');
    }
    if (mapping.baseline === mapping.target || !intersects(evidence_paths(mapping.evidence), after.paths)) {
      throw new Error('Identity mapping needs reviewed current target evidence');
    }
  }
  const updated = structuredClone(scope);
  for (const [key, source, identity] of [['dispositions', 'dispositions', 'obligation'], ['candidate_reviews', 'candidates', 'candidate'],
    ['executions', 'executions', 'id'], ['identity_mappings', 'identity_mappings', 'baseline']]) {
    for (const item of packet[source] ?? []) updated[key][item[identity]] = { ...item, revision: scope.revision, review };
  }
  for (const policy of packet.policies) updated.policy_reviews[policy] = { revision: scope.revision, review };
  updated.reviews.push(structuredClone(packet));
  return updated;
}

/** Five independent axes. The legacy coverage_complete metric is unchanged. */
export function assess(scope: Data, state: Data, current: Data): Data {
  const generations = (state.knowledge_imports ?? []).map((item: Data) => ({ producer: item.producer, sha256: item.sha256 }));
  const fresh_source = current_source(scope, current, generations).id === scope.target.id;
  const model = fingerprint({ entities: state.entities, relations: state.relations, gaps: state.gaps });
  const fresh = fresh_source && model === scope.model;
  const current_record = (record: Data | undefined): boolean => fresh && Boolean(record) && record?.revision === scope.revision;
  const invalidated: Data[] = [], unaccounted: string[] = [], unresolved_candidates: string[] = [];
  for (const key of Object.keys(scope.obligations)) {
    let item = scope.dispositions[key];
    const mapping = scope.identity_mappings[key];
    if (current_record(mapping)) item = scope.dispositions[mapping.target];
    if (!current_record(item) || item.disposition === 'unresolved') {
      unaccounted.push(key);
      if (item && !current_record(item)) invalidated.push({ obligation: key, reason: 'source, semantic evidence, standard or discovery revision changed' });
    }
  }
  for (const key of Object.keys(scope.candidates)) {
    const item = scope.candidate_reviews[key];
    if (!current_record(item) || item.status === 'unresolved') unresolved_candidates.push(key);
  }
  const paths = new Set<string>(scope.resolution.paths);
  const pending = state.plan.tasks.filter((t: Data) => intersects(paths, t.paths) && (t.status !== 'accepted' || t.review?.status !== 'source-reviewed')).map((t: Data) => t.id);
  const deferred = state.plan.deferred.filter((x: Data) => intersects(paths, x.paths));
  const followups = (state.plan.followups ?? []).filter((x: Data) => x.status !== 'accounted'
    && x.paths.some((p: string) => in_boundary(p, scope.request.boundaries, scope.request.exclusions))).map((x: Data) => x.id);
  const frontier: Data[] = [...scope.resolution.frontier];
  for (const gap of state.gaps) {
    if (gap.id !== 'knowledge_gap.graphify' && (!gap.paths?.length || intersects(paths, gap.paths))) frontier.push({ id: gap.id, reason: gap.question });
  }
  for (const imported of state.knowledge_imports ?? []) {
    // Optional hints cannot disappear merely because their bindings failed.
    for (const gap of imported.gaps ?? []) if (!gap.path || paths.has(gap.path)) frontier.push({ id: gap.id, reason: gap.reason });
  }
  const missing_policies = scope.resolution.required_policies.filter((p: string) => !current_record(scope.policy_reviews[p]));
  const standard = scope.request.standard;
  if (!standard.criteria.length) frontier.push({ id: 'requirements', reason: 'The requested standard has no concrete acceptance criteria.' });
  if (!scope.resolution.concepts.length) frontier.push({ id: 'empty-concept-scope', reason: 'No resolved semantic concept; an empty ledger is not completion.' });
  const anchors = unaccounted.filter(key => scope.obligations[key].kind === 'anchor');
  const checks: Data[] = standard.required_checks;
  const missing_checks = checks.filter(c => !current_record(scope.executions[c.id]) || scope.executions[c.id].exit_code !== 0).map(c => c.id);
  const boundary = (p: string) => in_boundary(p, scope.request.boundaries, scope.request.exclusions);
  const omissions = [...current.skipped, ...(current.ignored ?? [])].filter(x => boundary(x.path));
  const inventory_ok = fresh_source && !omissions.length;
  const investigation_ok = fresh && !pending.length && !deferred.length && !followups.length;
  const discovery_ok = fresh && !frontier.length && !unresolved_candidates.length && !scope.resolution.candidate_occurrences.length && !anchors.length && !missing_policies.length;
  const accounting_ok = fresh && !unaccounted.length;
  const behavioral_ok = fresh && Boolean(standard.criteria.length) && !missing_checks.length;
  const complete = inventory_ok && investigation_ok && discovery_ok && accounting_ok && behavioral_ok;
  const axis = (ok: boolean, details: Data): Data => ({ status: ok ? 'complete' : 'partial', ...details });
  return { scope_id: scope.id, change_complete: complete, source_current: fresh_source, semantic_evidence_current: model === scope.model,
    inventory_coverage: axis(inventory_ok, { omissions, snapshot: scope.target.id }),
    investigation_coverage: axis(investigation_ok, { pending_tasks: pending, deferred, followups }),
    discovery_coverage: axis(discovery_ok, { frontier, unresolved_candidates, candidate_occurrences: scope.resolution.candidate_occurrences, mandatory_anchors: anchors, missing_policy_reviews: missing_policies }),
    occurrence_accounting: axis(accounting_ok, { total: Object.keys(scope.obligations).length, unaccounted, invalidated }),
    behavioral_verification: { status: behavioral_ok && !checks.length ? 'not_required' : behavioral_ok ? 'complete' : 'partial',
      missing_or_failed_checks: missing_checks, execution_owner: 'external coding harness; none executed by Understand Code' },
    summary: complete ? 'Complete within the declared scope and supported analysis boundary.' : 'Partial change coverage; unresolved obligations remain.',
    semantic_truth: 'Source-reviewed dispositions are accountable judgments, not mathematical proof.' };
}
