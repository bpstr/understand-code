/** Conservative semantic blast-radius analysis, independent of lines changed. */
import { compare_text } from './ontology.js';
type RecordData = Record<string, any>;

export function analyze(old: RecordData, current: RecordData, entities: RecordData[], relations: RecordData[],
  evidence: RecordData[], git_changes: RecordData[] | null = null): RecordData {
  const before = old.files ?? {};
  const after = current.files;
  const changed = new Set<string>([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((filename) => before[filename]?.sha256 !== after[filename]?.sha256));
  for (const item of git_changes ?? []) {
    for (const filename of [item.path, item.old_path]) if (filename) changed.add(filename);
  }
  const refs = new Set<string>(evidence.filter((ref) => changed.has(ref.path)).map((ref) => ref.id));
  const affected = new Set<string>(entities.filter((entity) => entity.evidence.some((key: string) => refs.has(key))).map((entity) => entity.id));
  for (const relation of relations) {
    if (relation.evidence.some((key: string) => refs.has(key))) {
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
    if (affected.size === count) break;
  }
  const signals = [...new Set<string>(current.candidates.filter((candidate: RecordData) => changed.has(candidate.path)
    && candidate.kind !== 'symbol').map((candidate: RecordData) => candidate.kind))].sort();
  return { changed_files: [...changed].sort(compare_text), affected_entities: [...affected].sort(), significance: signals,
    git_changes: git_changes ?? [], new_files: Object.keys(after).filter((filename) => !Object.hasOwn(before, filename)).sort(compare_text),
    deleted_files: Object.keys(before).filter((filename) => !Object.hasOwn(after, filename)).sort(compare_text) };
}
