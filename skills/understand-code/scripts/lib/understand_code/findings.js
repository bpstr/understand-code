/** Validate native findings before they become documentation.
 * Mechanical validation establishes citation identity and scope, not semantic
 * truth. Independent review records that judgment without refreshing hashes.
 */
import { isDeepStrictEqual } from 'node:util';
import { verify, safe_path, excluded, read_source, source_hash, split_lines } from './evidence.js';
import { KINDS, RELATIONS, RELATION_ENDPOINTS, CONFIDENCES, check_id, stable_id, canonical_json } from './ontology.js';
import { validate_finding } from './contracts.js';
import { head } from './git.js';
import { validate_documents, validate_document_ids } from './documentation.js';
import { ROLES } from './spec/planner.js';
export function required(obj, fields, label) {
    const names = [...fields];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        throw new Error(`${label} missing required fields: ${names.sort().join(', ')}`);
    const missing = names.filter(key => !Object.hasOwn(obj, key));
    if (missing.length)
        throw new Error(`${label} missing required fields: ${missing.sort().join(', ')}`);
}
export function validate(bundle, root, output, task, known_entities) {
    validate_finding(bundle);
    required(bundle, ['schema_version', 'task_id', 'snapshot', 'entities', 'relations', 'evidence', 'gaps', 'review'], 'finding');
    if (bundle.schema_version !== 1 || bundle.task_id !== task.id || bundle.snapshot !== task.snapshot) {
        throw new Error('Findings do not match the task and source snapshot');
    }
    for (const key of ['entities', 'relations', 'evidence', 'gaps']) {
        if (!Array.isArray(bundle[key]) || bundle[key].length > 500)
            throw new Error(`${key} must be a bounded array (maximum 500)`);
    }
    if (!['entities', 'relations', 'gaps', 'followups', 'resolved_gaps', 'retirements'].some(key => bundle[key]?.length)) {
        throw new Error('An empty response is not a completed investigation; record an explicit knowledge gap');
    }
    if (!bundle.review || Array.isArray(bundle.review) || !['unreviewed', 'source-reviewed'].includes(bundle.review.status)) {
        throw new Error('Review must explicitly be unreviewed or source-reviewed');
    }
    if (bundle.review.status === 'source-reviewed'
        && !['reviewer', 'method'].every(key => typeof bundle.review[key] === 'string' && bundle.review[key].trim())) {
        throw new Error('Source review requires reviewer identity and method');
    }
    const refs = {};
    const commit = head(root);
    for (const ref of bundle.evidence) {
        required(ref, ['id', 'path', 'start_line', 'end_line', 'sha256', 'excerpt_sha256', 'commit', 'kind'], 'evidence');
        if (!task.paths.includes(ref.path))
            throw new Error(`Evidence outside task scope: ${ref.path}`);
        if (ref.commit !== commit)
            throw new Error('Evidence commit does not match the current repository; recapture it');
        if (!['source', 'test', 'config', 'documentation', 'human'].includes(ref.kind))
            throw new Error('Unsupported evidence kind');
        const error = verify(root, ref, output);
        if (error)
            throw new Error(`Evidence rejected ${ref.id}: ${error}`);
        if (Object.hasOwn(refs, ref.id))
            throw new Error('Duplicate evidence ID');
        refs[ref.id] = ref;
    }
    for (const resolution of [...(bundle.resolved_gaps ?? []), ...(bundle.retirements ?? [])]) {
        if (bundle.review.status !== 'source-reviewed' || resolution.evidence.some((key) => !Object.hasOwn(refs, key))) {
            throw new Error('Gap closure needs current source-reviewed evidence');
        }
    }
    const entity_ids = new Set(known_entities.map(e => e.id));
    const entity_map = Object.fromEntries([...known_entities, ...bundle.entities].map(e => [e.id, e]));
    const previous_entities = Object.fromEntries(known_entities.map(e => [e.id, e]));
    const seen = new Set();
    for (const entity of bundle.entities) {
        required(entity, ['id', 'kind', 'title', 'summary', 'confidence', 'evidence'], 'entity');
        if (!KINDS.includes(entity.kind))
            throw new Error('Unknown entity kind');
        if (!entity.id.startsWith(entity.kind + '.'))
            throw new Error('Entity ID must start with its kind');
        for (const key of ['title', 'summary'])
            if (typeof entity[key] !== 'string' || !entity[key].trim() || [...entity[key]].length > 12000) {
                throw new Error(`Invalid entity ${key}`);
            }
        entity_ids.add(entity.id);
        if (previous_entities[entity.id]?.documentation?.length && !Object.hasOwn(entity, 'documentation')) {
            throw new Error('An authored entity update must carry its documentation or explicitly retire it with an empty list');
        }
        validate_documents(entity, refs, task.snapshot);
        if (entity.kind === 'occurrence') {
            const occurrence = entity.occurrence;
            if (!occurrence || !Object.keys(occurrence).length)
                throw new Error('Occurrence requires a concept, surface, stable anchor, conditions and implementation references');
            if (!['concept', 'feature', 'setting', 'data_entity'].includes(entity_map[occurrence.concept]?.kind))
                throw new Error('Occurrence has an unknown concept endpoint');
            if (entity_map[occurrence.surface]?.kind !== 'ui_surface')
                throw new Error('Occurrence has an unknown surface endpoint');
        }
        else if (Object.hasOwn(entity, 'occurrence'))
            throw new Error('Only occurrence entities can contain occurrence membership');
        const code_refs = [...(entity.code_references ?? []), ...(entity.occurrence?.implementation ?? [])];
        for (const ref of code_refs) {
            if (ref.repository !== 'repository.local' || !task.paths.includes(ref.path))
                throw new Error('Code reference outside the bound repository/task');
            const text = read_source(root, ref.path);
            if (source_hash(text) !== ref.sha256 || !(1 <= ref.start_line && ref.start_line <= ref.end_line && ref.end_line <= split_lines(text).length)) {
                throw new Error('Stale code reference or invalid range');
            }
            if (!Object.entries(refs).some(([key, e]) => entity.evidence.includes(key) && e.path === ref.path && e.sha256 === ref.sha256
                && e.start_line <= ref.start_line && ref.start_line <= ref.end_line && ref.end_line <= e.end_line)) {
                throw new Error('Code reference lacks supporting claim evidence');
            }
        }
    }
    validate_document_ids(bundle.entities, known_entities);
    const occurrence_keys = new Map();
    const supplied_ids = new Set(bundle.entities.map((entity) => entity.id));
    for (const entity of Object.values(entity_map)) {
        const occurrence = entity.occurrence;
        if (!occurrence)
            continue;
        const implementations = occurrence.implementation.map((ref) => [ref.repository, ref.path, ref.anchor])
            .sort((a, b) => {
            for (let i = 0; i < a.length; i++) {
                if (a[i] < b[i])
                    return -1;
                if (a[i] > b[i])
                    return 1;
            }
            return 0;
        });
        const identity = canonical_json([occurrence.concept, occurrence.surface, occurrence.anchor, [...occurrence.conditions].sort(), implementations]);
        const previous = occurrence_keys.get(identity);
        if (previous && previous !== entity.id && (supplied_ids.has(previous) || supplied_ids.has(entity.id))) {
            throw new Error('Duplicate occurrence identity; distinct uses need distinct stable anchors');
        }
        occurrence_keys.set(identity, entity.id);
    }
    for (const item of [...bundle.entities, ...bundle.relations]) {
        required(item, ['id', 'confidence', 'evidence'], 'claim');
        if (!check_id(item.id) || seen.has(item.id))
            throw new Error('Invalid or duplicate claim ID');
        seen.add(item.id);
        if (!CONFIDENCES.includes(item.confidence))
            throw new Error('Unknown confidence');
        if (!Array.isArray(item.evidence) || item.evidence.some((x) => typeof x !== 'string' || !Object.hasOwn(refs, x))) {
            throw new Error('Claim references missing evidence');
        }
        if (item.confidence !== 'UNKNOWN' && !item.evidence.length)
            throw new Error('Non-UNKNOWN claims require evidence');
        if (item.confidence === 'CORROBORATED' && new Set(item.evidence.map((x) => refs[x].path)).size < 2) {
            throw new Error('CORROBORATED requires at least two independent source files');
        }
        if (['EXTRACTED', 'CORROBORATED'].includes(item.confidence) && bundle.review.status !== 'source-reviewed') {
            throw new Error('Established claims require recorded source review; use INFERRED until reviewed');
        }
    }
    for (const relation of bundle.relations) {
        required(relation, ['source', 'target', 'kind'], 'relation');
        if (!RELATIONS.includes(relation.kind) || !entity_ids.has(relation.source) || !entity_ids.has(relation.target)) {
            throw new Error('Relation has unknown kind or endpoints');
        }
        const endpoints = RELATION_ENDPOINTS[relation.kind];
        if (endpoints && (!new Set(endpoints[0]).has(entity_map[relation.source].kind) || !new Set(endpoints[1]).has(entity_map[relation.target].kind))) {
            throw new Error('Illegal typed relation endpoints');
        }
        if (['occurs_on', 'realizes'].includes(relation.kind)) {
            const membership = entity_map[relation.source].occurrence ?? {};
            const field = relation.kind === 'occurs_on' ? 'surface' : 'concept';
            if (membership[field] !== relation.target)
                throw new Error('Relation contradicts occurrence membership');
        }
    }
    for (const request of bundle.followups ?? []) {
        if (!Object.hasOwn(ROLES, request.role))
            throw new Error('Unknown follow-up role');
        for (const path of request.paths) {
            safe_path(root, path);
            if (excluded(path, output))
                throw new Error('Follow-up cannot target excluded material');
        }
    }
    for (const gap of bundle.gaps) {
        required(gap, ['id', 'question', 'next_step'], 'gap');
        if ((gap.paths ?? []).some((path) => !task.paths.includes(path)))
            throw new Error('Gap paths outside task scope');
        if (!check_id(gap.id) || !['question', 'next_step'].every(key => typeof gap[key] === 'string' && gap[key].trim()))
            throw new Error('Invalid knowledge gap');
    }
}
export function reconcile(entities, relations, bundles) {
    const entity_map = new Map(entities.map(e => [e.id, e]));
    const relation_map = new Map(relations.map(r => [r.id, r]));
    const gaps = [];
    for (const bundle of bundles) {
        for (const [key, target] of [['entities', entity_map], ['relations', relation_map]]) {
            for (const claim of bundle[key]) {
                const existing = target.get(claim.id);
                const replacement = existing && (existing.stale || existing.conflict) && claim.supersedes === existing.id && bundle.review.status === 'source-reviewed';
                let changed = Boolean(existing && ['summary', 'kind', 'source', 'target', 'occurrence', 'code_references', 'search_terms', 'scope', 'details']
                    .some(k => !isDeepStrictEqual(existing[k], claim[k])));
                // The first authored view is additive. Rewriting/removing established
                // authored text follows the same explicit conflict resolution contract.
                changed = changed || Boolean(existing?.documentation?.length && !isDeepStrictEqual(existing.documentation, claim.documentation));
                if (existing && !replacement && changed) {
                    gaps.push({ id: stable_id('knowledge_gap', claim.id + 'conflict'),
                        question: `Conflicting interpretations for ${claim.id}; which is supported?`,
                        next_step: 'Review both preserved alternatives against source before replacing this claim.', alternatives: [existing, claim] });
                    target.set(claim.id, { ...existing, confidence: 'UNKNOWN', conflict: true });
                }
                else
                    target.set(claim.id, { ...claim, review: bundle.review });
            }
        }
        gaps.push(...bundle.gaps);
    }
    return [[...entity_map.values()], [...relation_map.values()], gaps];
}
