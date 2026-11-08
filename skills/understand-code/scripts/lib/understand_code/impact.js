/** Conservative semantic blast-radius analysis, independent of lines changed. */
import { compare_text } from './ontology.js';
export function analyze(old, current, entities, relations, evidence, git_changes = null) {
    const before = old.files ?? {};
    const after = current.files;
    const changed = new Set([...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((filename) => before[filename]?.sha256 !== after[filename]?.sha256));
    for (const item of git_changes ?? []) {
        for (const filename of [item.path, item.old_path])
            if (filename)
                changed.add(filename);
    }
    const refs = new Set(evidence.filter((ref) => changed.has(ref.path)).map((ref) => ref.id));
    const affected = new Set(entities.filter((entity) => entity.evidence.some((key) => refs.has(key))).map((entity) => entity.id));
    for (const relation of relations) {
        if (relation.evidence.some((key) => refs.has(key))) {
            affected.add(relation.source);
            affected.add(relation.target);
        }
    }
    // Dependencies and consumers both require investigation; this does not assert behavior.
    while (true) {
        const count = affected.size;
        for (const relation of relations) {
            if (affected.has(relation.source) || affected.has(relation.target)) {
                affected.add(relation.source);
                affected.add(relation.target);
            }
        }
        if (affected.size === count)
            break;
    }
    const signals = [...new Set(current.candidates.filter((candidate) => changed.has(candidate.path)
            && candidate.kind !== 'symbol').map((candidate) => candidate.kind))].sort();
    return { changed_files: [...changed].sort(compare_text), affected_entities: [...affected].sort(), significance: signals,
        git_changes: git_changes ?? [], new_files: Object.keys(after).filter((filename) => !Object.hasOwn(before, filename)).sort(compare_text),
        deleted_files: Object.keys(before).filter((filename) => !Object.hasOwn(after, filename)).sort(compare_text) };
}
