/** Explainable, bounded semantic retrieval. Application/provider code is never executed.
 * A source roster is independent of the query. Traversal supplies candidates, not
 * a claim that every adjacent node is an edit target. Invalidation is separate.
 */
import { posix } from 'node:path';
import { digest, stable_id, canonical_json } from './ontology.js';
export const POLICY = 'semantic-change-scope-v1';
export const INTENTS = ['ui_standardization', 'settings_change', 'cross_cutting'];
export const UI_RELATIONS = new Set(['has_aspect', 'primary_surface', 'presents', 'renders', 'occurs_on', 'realizes',
    'implemented_by', 'exposed_at', 'reused_by']);
export const SETTING_RELATIONS = new Set(['reads', 'writes', 'written_by', 'persisted_in', 'read_by', 'affects',
    'propagates_to', 'invalidates', 'configured_by', 'controls', 'guards', 'depends_on', 'implemented_by', 'realizes', 'occurs_on', 'presents']);
export const DISCOVERY_POLICIES = {
    ui_standardization: ['independent-surfaces', 'primary-surfaces', 'alternate-implementations', 'component-consumers'],
    settings_change: ['independent-surfaces', 'settings-effects', 'alternate-implementations'],
    cross_cutting: ['independent-surfaces', 'alternate-implementations', 'observable-consumers'],
};
export function fingerprint(value) { return digest(canonical_json(value, true)); }
export function normalize(value) {
    const separated = value.replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ');
    const folded = separated.normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/_/g, ' ');
    return (folded.match(/[\p{L}\p{N}_]+/gu) ?? []).join(' ');
}
export function validate_boundaries(paths) {
    const result = [];
    for (const value of paths) {
        const parts = value.split('/');
        if (!value.trim() || posix.isAbsolute(value) || parts.includes('..') || value.includes('\\')
            || value.includes('\0') || parts.includes('.git'))
            throw new Error(`Unsafe change boundary: ${JSON.stringify(value)}`);
        result.push(posix.normalize(value).replace(/\/+$/, '') || '.');
    }
    return [...new Set(result)].sort();
}
export function in_boundary(path, boundaries, exclusions = []) {
    const matches = (prefix) => prefix === '.' || path === prefix || path.startsWith(prefix + '/');
    return (!boundaries.length || boundaries.some(matches)) && !(exclusions ?? []).some(matches);
}
export function source_manifest(inv, boundaries = [], exclusions = [], generations = []) {
    const keep = (p) => in_boundary(p, boundaries ?? [], exclusions ?? []);
    const data = {
        commit: inv.commit,
        files: Object.fromEntries(Object.keys(inv.files).sort().filter(keep).map(p => [p, inv.files[p].sha256])),
        deleted: (inv.deleted ?? []).filter(keep).sort(),
        ignored: (inv.ignored ?? []).filter((x) => keep(x.path)),
        limitations: [...inv.skipped, ...(inv.limitations ?? [])].filter((x) => keep(x.path)),
        policy: inv.discovery_policy ?? 'legacy-inventory',
        index_generations: [...(generations ?? [])].sort((a, b) => compare(a.producer, b.producer) || compare(a.sha256, b.sha256)),
    };
    return { id: fingerprint(data), ...data };
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
export function established(claim) {
    return ['EXTRACTED', 'CORROBORATED'].includes(claim.confidence)
        && claim.review?.status === 'source-reviewed' && Boolean(claim.evidence?.length) && !claim.stale && !claim.conflict;
}
/** Every nonempty source-language file is a fallback for native inspection. */
export function surface_roster(inv, boundaries = [], exclusions = []) {
    const hints = new Map();
    for (const candidate of inv.candidates) {
        if (!hints.has(candidate.path))
            hints.set(candidate.path, new Set());
        hints.get(candidate.path).add(candidate.kind);
    }
    const roster = [];
    for (const path of Object.keys(inv.files).sort()) {
        const info = inv.files[path];
        if (!in_boundary(path, boundaries ?? [], exclusions) || !info.evidence)
            continue;
        const kinds = hints.get(path) ?? new Set();
        const ui = ['.tsx', '.jsx', '.vue', '.svelte'].includes(posix.extname(path)) || kinds.has('ui_surface');
        if (!info.language && !ui && !kinds.has('entrypoint') && !['source', 'test', 'config'].includes(info.kind))
            continue;
        roster.push({ id: stable_id('candidate', path), path, kind: ui ? 'surface' : 'source_fallback',
            evidence: [info.evidence], hints: [...kinds].sort(), confidence: 'INFERRED' });
    }
    return roster;
}
export function resolve(topic, inv, entities, relations, evidence, options = {}) {
    const { intent = 'cross_cutting', max_depth = 8, max_nodes = 500 } = options;
    if (!INTENTS.includes(intent) || !Number.isInteger(max_depth) || !Number.isInteger(max_nodes)
        || max_depth < 1 || max_nodes < 1 || !normalize(topic))
        throw new Error('Invalid semantic scope request or traversal budget');
    const boundaries = validate_boundaries(options.boundaries ?? []);
    const exclusions = validate_boundaries(options.exclusions ?? []);
    const examples = validate_boundaries(options.examples ?? []);
    const keep = (p) => in_boundary(p, boundaries, exclusions);
    const roster = surface_roster(inv, boundaries, exclusions);
    const by_id = Object.fromEntries(entities.map(e => [e.id, e]));
    const refs = Object.fromEntries(evidence.map(e => [e.id, e]));
    const query = normalize(topic);
    const query_words = query.split(' ');
    // Search terms are vocabulary, not aliases or semantic proof.
    const matches = new Set(entities.filter(e => [e.id, e.title, ...(e.aliases ?? []), ...(e.search_terms ?? [])]
        .some(term => {
        const normalized = normalize(term);
        const words = new Set(normalized.split(' '));
        return query === normalized || query_words.every(word => words.has(word));
    })).map(e => e.id));
    const paths = new Set(Object.keys(inv.files).filter(p => keep(p) && (examples.includes(p) || query === normalize(p))));
    const frontier = [];
    if (!matches.size)
        frontier.push({ id: 'concept-resolution', reason: 'Query has no known concept; independently investigate the source roster.' });
    const allowed = intent === 'ui_standardization' ? UI_RELATIONS : new Set([...SETTING_RELATIONS, ...UI_RELATIONS]);
    const adjacency = new Map();
    for (const relation of relations) {
        if (allowed.has(relation.kind)) {
            for (const [source, target] of [[relation.source, relation.target], [relation.target, relation.source]]) {
                if (!adjacency.has(source))
                    adjacency.set(source, []);
                adjacency.get(source).push([relation, target]);
            }
        }
    }
    const queue = [...matches].sort().map(key => [key, 0, []]);
    const visited = new Set();
    const included_relations = new Map();
    const provenance = {};
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const [key, depth, chain] = queue[cursor];
        if (visited.has(key))
            continue;
        if (visited.size >= max_nodes) {
            frontier.push({ id: 'node-limit:' + key, reason: 'Traversal node budget', entity: key, via: chain });
            continue;
        }
        visited.add(key);
        provenance[key] = chain;
        for (const [relation, other] of [...(adjacency.get(key) ?? [])].sort((a, b) => compare(a[0].id, b[0].id))) {
            included_relations.set(relation.id, relation);
            if (!visited.has(other)) {
                if (depth >= max_depth)
                    frontier.push({ id: 'depth-limit:' + relation.id, reason: 'Traversal depth budget', entity: other, via: [...chain, relation.id] });
                else
                    queue.push([other, depth + 1, [...chain, relation.id]]);
            }
        }
    }
    const claims = [...[...visited].sort().filter(key => Object.hasOwn(by_id, key)).map(key => by_id[key]), ...included_relations.values()];
    for (const claim of claims)
        for (const key of claim.evidence)
            if (Object.hasOwn(refs, key) && keep(refs[key].path))
                paths.add(refs[key].path);
    for (const relation of included_relations.values())
        if (!established(relation)) {
            frontier.push({ id: 'unreviewed-relation:' + relation.id, reason: 'A relevant semantic connection remains inferred, stale or conflicting.' });
        }
    // Ancestors supply anchor context; unrelated siblings are not edit obligations.
    const concepts = new Set([...matches].filter(key => ['concept', 'feature', 'setting', 'feature_flag', 'data_entity'].includes(by_id[key].kind)));
    for (let changed = true; changed;) {
        changed = false;
        for (const relation of included_relations.values()) {
            if (relation.kind === 'has_aspect' && concepts.has(relation.source) && !concepts.has(relation.target)) {
                concepts.add(relation.target);
                changed = true;
            }
        }
    }
    const ancestors = new Set(concepts);
    for (let i = 0; i < max_depth; i++) {
        const added = [...included_relations.values()].filter(r => r.kind === 'has_aspect' && ancestors.has(r.target)).map(r => r.source);
        added.forEach(key => ancestors.add(key));
    }
    const anchors = [], occurrences = [], candidate_occurrences = [];
    for (const relation of included_relations.values()) {
        if (relation.kind === 'primary_surface' && ancestors.has(relation.source)) {
            const surface = by_id[relation.target] ?? {};
            if (established(relation) && established(surface))
                anchors.push(surface.id);
            else
                frontier.push({ id: 'unreviewed-anchor:' + relation.id, reason: 'Primary-surface claim requires current source review.' });
        }
    }
    for (const entity of entities) {
        const occurrence = entity.occurrence ?? {};
        if (entity.kind !== 'occurrence' || !concepts.has(occurrence.concept))
            continue;
        const locations = (occurrence.implementation ?? []).map((r) => r.path);
        const surface = by_id[occurrence.surface] ?? {};
        locations.push(...(surface.evidence ?? []).filter((key) => Object.hasOwn(refs, key)).map((key) => refs[key].path));
        if (locations.length && !locations.some(keep))
            continue;
        (established(entity) && established(surface) && established(by_id[occurrence.concept] ?? {}) ? occurrences : candidate_occurrences).push(entity.id);
        visited.add(entity.id);
        locations.filter(keep).forEach(p => paths.add(p));
    }
    if (intent === 'ui_standardization' && concepts.size && !anchors.length) {
        frontier.push({ id: 'primary-surface', reason: 'No current evidence-backed primary surface; investigate independently of prompt examples.' });
    }
    if (intent === 'settings_change')
        for (const key of [...concepts].sort()) {
            if (!['setting', 'feature_flag'].includes(by_id[key].kind))
                continue;
            const stages = by_id[key].details ?? {};
            for (const stage of ['writer', 'validation', 'persistence', 'cache_projection', 'reader', 'observable_effect']) {
                if (!established(by_id[key]) || !stages[stage])
                    frontier.push({ id: `settings-stage:${key}:${stage}`, reason: `Missing source-reviewed settings segment: ${stage}` });
            }
        }
    for (const item of [...inv.skipped, ...(inv.ignored ?? []), ...(inv.limitations ?? [])]) {
        if (keep(item.path))
            frontier.push({ id: stable_id('frontier', canonical_json(item)), ...item });
    }
    // Investigate the independent roster; it is not a list of required edits.
    roster.forEach(c => paths.add(c.path));
    return { policy: POLICY, topic, intent, examples, boundaries, exclusions, concepts: [...concepts].sort(),
        entities: [...visited].sort(), relations: [...included_relations.keys()].sort(), required_anchors: [...new Set(anchors)].sort(),
        occurrences: [...new Set(occurrences)].sort(), candidate_occurrences: [...new Set(candidate_occurrences)].sort(), roster,
        paths: [...paths].filter(p => Object.hasOwn(inv.files, p)).sort(), frontier, provenance,
        required_policies: [...DISCOVERY_POLICIES[intent]], limits: { max_depth, max_nodes } };
}
