/** Adaptive native investigations with independent discovery and durable follow-ups. */
import path from 'node:path';
import { canonical_json, compare_text, digest, stable_id } from '../ontology.js';
import { resolve } from '../change_scope.js';
import { PROFILE_TOPICS } from '../documentation.js';
export const ROLES = {
    'repository-cartographer': [null, 'Map applications, packages and module boundaries using manifests and source.'],
    'entrypoint-mapper': ['entrypoint', 'Locate executable entrypoints including hidden webhooks and workers; inspect public inputs/defaults, outputs, errors and effective security contracts against canonical schemas.'],
    'domain-discoverer': [null, 'Identify product capabilities across modules; distinguish names from proved behavior.'],
    'ui-mapper': ['ui_surface', 'Enumerate independent surfaces and primary-surface roles; trace composition, wrappers and observable consumers, not just named examples.'],
    'runtime-tracer': ['entrypoint', 'Trace representative success, failure and conditional execution paths end to end; document preconditions, state changes, side effects and supported recovery guarantees without inventing intent.'],
    'data-mapper': ['data_entity', 'Trace entity ownership, persistence, transformation and deletion.'],
    'settings-tracer': ['setting', 'Trace writer → validation → persistence → cache/projection → reader → observable consumers; record every missing link.'],
    'integration-mapper': ['external_system', 'Locate external boundaries, configuration and failure handling.'],
    'async-mapper': ['event', 'Trace producers, queues, consumers, retries and idempotency boundaries.'],
    'permission-mapper': ['permission', 'Connect authorization checks to entrypoints and conditional UI; distinguish server enforcement.'],
    'reuse-mapper': ['ui_surface', 'Find actual shared-component consumers AND independent implementations bypassing reuse; account for separate occurrences and variants.'],
    'test-analyst': ['test_behavior', 'Map requirement IDs and examples to asserted behaviors and missing acceptance checks; distinguish verification plans, static checks and externally recorded execution. Never execute tests or claim they pass from source inspection.'],
    'history-analyst': [null, 'Inspect bounded Git history for hotspots/co-change; association is not runtime causation or intent.'],
    'deployment-mapper': [null, 'Map declared processes and deployment configuration; separate declared from observed operation.'],
    'instruction-auditor': [null, 'Resolve applicable instruction hierarchy, stale guidance, duplication and actual conflicts; recommend only.'],
    'feature-synthesizer': [null, 'Reconcile stable concepts, search terms, surface roles, occurrence membership and effect paths with source evidence; author reader-focused documentation profiles with explicit observed, specified, proposed and unknown requirements.'],
    'relationship-verifier': [null, 'Challenge primary-surface designation, concept membership, unsupported links and falsely complete inventories against current source.'],
    'spec-curator': [null, 'Review document audience, profile coverage, canonical sources, terminology, contracts, requirement traceability and honest example validation; retain occurrence dispositions, mandatory anchors, discovery obligations and implementation handoff checks.'],
};
export const MODES = { quick: [6, 24], standard: [18, 40], deep: [36, 60] };
export function task_for(role, selected, snapshot, inventory, max_paths, suffix = '') {
    const task_id = stable_id('task', role + snapshot + selected.join('|') + suffix);
    const task = {
        id: task_id, role, objective: ROLES[role][1], snapshot,
        phase: role === 'feature-synthesizer' ? 'synthesis' : role === 'relationship-verifier' ? 'verification'
            : role === 'spec-curator' ? 'curation'
                : ['repository-cartographer', 'entrypoint-mapper', 'domain-discoverer', 'instruction-auditor'].includes(role)
                    ? 'reconnaissance' : 'tracing',
        paths: selected, status: 'pending',
        candidate_evidence: inventory.candidates.filter((candidate) => selected.includes(candidate.path)).slice(0, 120),
        limits: { max_paths, max_findings: 500, execution: 'read-only; no repository code execution' },
        contract: { schema_version: 1, task_id, snapshot, entities: [], relations: [], evidence: [], gaps: [], followups: [],
            review: { status: 'unreviewed' } },
        completion: 'Return source-bound findings or explicit gaps. Use repository-configured code-intelligence tools only as retrieval aids when applicable instructions describe them. Request follow-up scope when paths are insufficient. Prompt examples never define exhaustive scope. Never fill unknown links with plausible claims.',
    };
    if (['feature-synthesizer', 'spec-curator', 'entrypoint-mapper', 'test-analyst'].includes(role)) {
        task.documentation_contract = {
            field: 'entities[].documentation[]; optional authored views, never raw Markdown', profiles: PROFILE_TOPICS,
            guidance: 'Read the skill documentation-authoring reference and documentation schema. '
                + "Choose the user's audience/purpose; cite individual sections and requirements through entity.evidence. "
                + 'Separate observed/specified/proposed/unknown basis from confidence. '
                + 'Never execute examples; record external checks honestly or mark not-run. '
                + 'Preserve existing authored documents on entity updates; report missing coverage explicitly.',
        };
    }
    const analysis_notes = (inventory.analysis_notes ?? []).filter((note) => selected.includes(note.path));
    if (analysis_notes.length)
        task.analysis_notes = analysis_notes;
    return task;
}
/** Round-robin directory branches before applying budgets; preserve every path. */
export function balanced_paths(paths) {
    const tree = { files: [], children: new Map() };
    for (const filename of [...new Set(paths)].sort(compare_text)) {
        let node = tree;
        for (const part of filename.split('/').slice(0, -1)) {
            if (!node.children.has(part))
                node.children.set(part, { files: [], children: new Map() });
            node = node.children.get(part);
        }
        node.files.push(filename);
    }
    function* walk(node) {
        const queue = node.files.length ? [node.files[Symbol.iterator]()] : [];
        for (const key of [...node.children.keys()].sort(compare_text))
            queue.push(walk(node.children.get(key)));
        while (queue.length) {
            const current = queue.shift();
            const next = current.next();
            if (next.done)
                continue;
            yield next.value;
            queue.push(current);
        }
    }
    return [...walk(tree)];
}
export function plan(inventory, mode, focus = null, impact = null, entities = null, relations = null, evidence = null, scope_options = null) {
    if (!Object.hasOwn(MODES, mode))
        throw new Error(`Unsupported mode: ${mode}`);
    const [max_tasks, max_paths] = MODES[mode];
    const snapshot = digest(canonical_json(Object.fromEntries(Object.entries(inventory.files).map(([filename, value]) => [filename, value.sha256]))));
    let paths = Object.keys(inventory.files).sort(compare_text);
    let resolution = null;
    if (focus) {
        resolution = resolve(focus, inventory, entities ?? [], relations ?? [], evidence ?? [], scope_options ?? {});
        paths = resolution.paths;
    }
    else if (impact !== null) {
        const affected = new Set(impact.affected_entities);
        const refs = new Set([...(entities ?? []), ...(relations ?? [])]
            .filter((item) => affected.has(item.id) || affected.has(item.source) || affected.has(item.target))
            .flatMap((item) => item.evidence));
        const affected_paths = new Set([...(evidence ?? []).filter((ref) => refs.has(ref.id)).map((ref) => ref.path),
            ...impact.changed_files]);
        paths = paths.filter((filename) => affected_paths.has(filename));
    }
    const category_paths = new Map();
    for (const candidate of inventory.candidates) {
        if (!category_paths.has(candidate.kind))
            category_paths.set(candidate.kind, new Set());
        category_paths.get(candidate.kind).add(candidate.path);
    }
    let roles = Object.keys(ROLES);
    if (mode === 'quick') {
        const priority = ['repository-cartographer', 'ui-mapper', 'reuse-mapper', 'feature-synthesizer', 'relationship-verifier', 'spec-curator'];
        if (scope_options?.intent === 'settings_change')
            priority[1] = 'settings-tracer';
        roles = [...priority, ...roles.filter((role) => !priority.includes(role))];
    }
    if (mode !== 'deep')
        roles = roles.filter((role) => role !== 'history-analyst');
    const tasks = [];
    const deferred = [];
    const queue = [];
    for (const role of roles) {
        const [category] = ROLES[role];
        let selected = category ? paths.filter((filename) => category_paths.get(category)?.has(filename)) : [...paths];
        if (resolution && ['ui-mapper', 'reuse-mapper', 'settings-tracer'].includes(role))
            selected = [...paths];
        if (role === 'instruction-auditor')
            selected = paths.filter((filename) => inventory.files[filename].instruction || filename.endsWith('README.md'));
        if (role === 'deployment-mapper')
            selected = paths.filter((filename) => inventory.files[filename].manifest || filename.includes('.github/') || filename.toLowerCase().includes('deploy'));
        if (!selected.length)
            continue;
        selected = balanced_paths(selected);
        const selected_set = new Set(selected);
        const parents = new Set(selected.map((filename) => path.posix.dirname(filename)));
        const adjacent = paths.filter((filename) => !selected_set.has(filename) && parents.has(path.posix.dirname(filename)));
        selected.push(...adjacent.slice(0, Math.max(0, max_paths - selected.length)));
        for (let offset = 0; offset < selected.length; offset += max_paths)
            queue.push([offset, role, selected.slice(offset, offset + max_paths)]);
    }
    queue.sort((left, right) => left[0] - right[0] || roles.indexOf(left[1]) - roles.indexOf(right[1]));
    for (const [, role, selected] of queue) {
        const task = task_for(role, selected, snapshot, inventory, max_paths);
        if (tasks.length < max_tasks)
            tasks.push(task);
        else
            deferred.push({ role, paths: selected, reason: 'task budget' });
    }
    const result = { snapshot, mode, focus, tasks, deferred, max_tasks, max_paths_per_task: max_paths, followups: [] };
    if (resolution)
        result.scope_resolution = resolution;
    return result;
}
export function schedule_followups(task_plan, requests, inventory) {
    task_plan.followups ??= [];
    const known = new Map(task_plan.followups.map((request) => [request.id, request]));
    for (const request of requests) {
        const previous = known.get(request.id);
        if (previous && ['role', 'paths', 'question'].some((key) => canonical_json(previous[key]) !== canonical_json(request[key]))) {
            throw new Error('Conflicting follow-up request identity');
        }
        known.set(request.id, { ...request, status: 'pending' });
    }
    const current = new Map(task_plan.tasks.map((task) => [task.id, task]));
    for (const request of known.values()) {
        const children = [];
        const size = task_plan.max_paths_per_task;
        const available = request.paths.filter((filename) => Object.hasOwn(inventory.files, filename));
        for (let offset = 0; offset < available.length; offset += size) {
            const task = task_for(request.role, available.slice(offset, offset + size), task_plan.snapshot, inventory, size, request.id + request.question);
            task.objective += ' Follow-up: ' + request.question;
            children.push(task.id);
            if (!current.has(task.id) && task_plan.tasks.length < task_plan.max_tasks) {
                task_plan.tasks.push(task);
                current.set(task.id, task);
            }
        }
        request.status = available.length === request.paths.length && children.length > 0
            && children.every((key) => current.get(key)?.status === 'accepted') ? 'accounted' : 'pending';
        request.tasks = children;
    }
    task_plan.followups = [...known.values()];
}
