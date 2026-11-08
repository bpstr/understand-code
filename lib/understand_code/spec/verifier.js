/** Read-only verification: source freshness and integrity are distinct from semantics. */
import fs from 'node:fs';
import { verify as verify_evidence, safe_path } from '../evidence.js';
import { digest } from '../ontology.js';
import { generated } from './writer.js';
import { assess_documents } from './documentation.js';
export function verify(root, output, state, current) {
    const errors = [];
    const stale = [];
    const unreviewed = [];
    const manifest = state.manifest;
    for (const [relative, expected] of Object.entries(manifest.managed)) {
        try {
            const filename = safe_path(root, output + '/' + relative);
            if (digest(generated(fs.readFileSync(filename, 'utf8'))) !== expected)
                errors.push(`Generated content changed: ${relative}`);
        }
        catch (error) {
            errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    for (const ref of state.evidence) {
        const error = verify_evidence(root, ref, output);
        if (error)
            stale.push({ evidence: ref.id, path: ref.path, reason: error });
    }
    const previous = state.inventory.files;
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(current.files)])]
        .filter((filename) => previous[filename]?.sha256 !== current.files[filename]?.sha256).sort();
    const known = new Set(state.entities.map((entity) => entity.id));
    const refs = new Set(state.evidence.map((ref) => ref.id));
    for (const claim of [...state.entities, ...state.relations]) {
        if (claim.evidence.some((ref) => !refs.has(ref)))
            errors.push(`Dangling evidence on ${claim.id}`);
        if (claim.stale || claim.conflict)
            errors.push(`Unresolved claim: ${claim.id}`);
        if (claim.review?.status !== 'source-reviewed')
            unreviewed.push(claim.id);
    }
    for (const relation of state.relations) {
        if (!known.has(relation.source) || !known.has(relation.target))
            errors.push(`Dangling relation: ${relation.id}`);
    }
    const pending = state.plan.tasks.filter((task) => task.status !== 'accepted').map((task) => task.id);
    return { ok: errors.length === 0 && stale.length === 0 && changed.length === 0, errors, stale_evidence: stale,
        changed_files: changed, unreviewed_claims: unreviewed, pending_tasks: pending,
        coverage_complete: pending.length === 0 && state.plan.deferred.length === 0 && current.skipped.length === 0,
        documentation_quality: assess_documents(state, current),
        semantic_truth: 'not mechanically provable; source-reviewed records identify a human/native reviewer judgment' };
}
