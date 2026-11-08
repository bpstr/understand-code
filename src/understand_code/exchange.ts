/** Change Knowledge Exchange v1: bounded, offline, candidate-only adapters.
 * Imports never upgrade external claims into native facts. Original confidence,
 * review and stale alternatives remain in the archived envelope.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { __version__ } from './index.js';
import { fingerprint, source_manifest, validate_boundaries } from './change_scope.js';
import { validate_contract } from './contracts.js';
import { excluded, safe_path, verify as verify_evidence, read_source, source_hash, split_lines } from './evidence.js';
import { RELATION_ENDPOINTS, stable_id, pretty_json } from './ontology.js';

type Data = Record<string, any>;
export const MAX_BYTES = 5_000_000;
export const CAPABILITIES = ['source-qualified-references-v1', 'snapshot-manifests-v1', 'reviewed-semantic-findings-v1',
  'independent-surface-candidates-v1', 'candidate-only-import-v1'];

export function export_knowledge(state: Data, current: Data): Data {
  const entities: Data[] = structuredClone(state.entities);
  const gaps: Data[] = structuredClone(state.gaps);
  // Authored views are native-only. Keep the pinned v1 wire schema unchanged,
  // including conflict alternatives, and do not mutate the stored native state.
  for (const claim of [...entities, ...gaps.flatMap(gap => gap.alternatives ?? [])]) delete claim.documentation;
  const envelope = { contract: 'change-knowledge', version: 1, producer: { id: 'understand-code', version: __version__ },
    repositories: [{ id: 'repository.local', manifest: source_manifest(current) }], capabilities: [...CAPABILITIES],
    entities: entities.filter(e => e.kind !== 'occurrence'), occurrences: entities.filter(e => e.kind === 'occurrence'),
    relations: structuredClone(state.relations),
    evidence: state.evidence.map((e: Data) => ({ ...structuredClone(e), repository: 'repository.local' })), gaps };
  validate_contract('change-knowledge', envelope);
  validate_references(envelope);
  return envelope;
}
export function validate_references(envelope: Data): void {
  const unique = (items: Data[], label: string): Record<string, Data> => {
    const mapping = Object.fromEntries(items.map(item => [item.id, item]));
    if (Object.keys(mapping).length !== items.length) throw new Error(`Duplicate ${label} ID`);
    return mapping;
  };
  const repositories = unique(envelope.repositories, 'repository');
  const refs = unique(envelope.evidence, 'evidence');
  const entities = unique([...envelope.entities, ...envelope.occurrences], 'entity/occurrence');
  const relations = unique(envelope.relations, 'relation');
  if (Object.keys(entities).some(key => Object.hasOwn(relations, key))) throw new Error('Entity and relation identities overlap');
  unique(envelope.gaps, 'gap');
  for (const repository of Object.values(repositories)) {
    const manifest = repository.manifest;
    const body = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'id'));
    if (fingerprint(body) !== manifest.id) throw new Error('Source manifest identity mismatch');
    for (const p of [...Object.keys(manifest.files), ...manifest.deleted]) validate_boundaries([p]);
    for (const item of [...manifest.ignored, ...manifest.limitations]) validate_boundaries([item.path]);
  }
  for (const ref of Object.values(refs)) {
    validate_boundaries([ref.path]);
    if (!Object.hasOwn(repositories, ref.repository) || ref.end_line < ref.start_line) throw new Error('Unbound evidence repository or invalid range');
  }
  const alternatives: Data[] = envelope.gaps.flatMap((gap: Data) => gap.alternatives ?? []);
  for (const claim of [...Object.values(entities), ...Object.values(relations), ...alternatives]) {
    if (claim.evidence.some((key: string) => !Object.hasOwn(refs, key))) throw new Error('Dangling exchange evidence reference');
    if (claim.confidence !== 'UNKNOWN' && !claim.evidence.length) throw new Error('Exchange claims need original evidence');
    for (const ref of [...(claim.code_references ?? []), ...(claim.occurrence?.implementation ?? [])]) {
      validate_boundaries([ref.path]);
      if (!Object.hasOwn(repositories, ref.repository) || ref.start_line > ref.end_line) throw new Error('Unbound code reference or invalid range');
    }
    if (claim.kind === 'occurrence') {
      const occurrence = claim.occurrence;
      if (!occurrence || entities[occurrence.surface]?.kind !== 'ui_surface'
          || !['concept', 'feature', 'setting', 'data_entity'].includes(entities[occurrence.concept]?.kind)) {
        throw new Error('Unresolved occurrence membership reference');
      }
    }
  }
  if (envelope.entities.some((e: Data) => e.kind === 'occurrence') || envelope.occurrences.some((e: Data) => e.kind !== 'occurrence')) {
    throw new Error('Occurrences must use the dedicated wire collection');
  }
  for (const relation of Object.values(relations)) {
    if (!Object.hasOwn(entities, relation.source) || !Object.hasOwn(entities, relation.target)) throw new Error('Dangling exchange relation endpoint');
    const rule = (RELATION_ENDPOINTS as Record<string, [Iterable<string>, Iterable<string>]>)[relation.kind];
    if (rule && (!new Set(rule[0]).has(entities[relation.source].kind) || !new Set(rule[1]).has(entities[relation.target].kind))) {
      throw new Error('Illegal exchange relation endpoints');
    }
    if (['occurs_on', 'realizes'].includes(relation.kind)) {
      const field = relation.kind === 'occurs_on' ? 'surface' : 'concept';
      if (entities[relation.source].occurrence?.[field] !== relation.target) throw new Error('Exchange relation contradicts occurrence membership');
    }
  }
}
export function import_knowledge(root: string, output: string, file: string): Data {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('Knowledge exchange exceeds 5 MB');
  // Fatal decoding preserves the contract's rejection of malformed UTF-8.
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  const envelope: Data = JSON.parse(raw);
  validate_contract('change-knowledge', envelope);
  validate_references(envelope);
  const gaps: Data[] = [], candidates: Data[] = [];
  const manifests: Record<string, Data> = Object.fromEntries(envelope.repositories.map((r: Data) => [r.id, r.manifest]));
  const gap = (identity: string, reason: string, file_path?: string): void => {
    const item: Data = { id: stable_id('exchange_gap', identity + reason), reason };
    if (file_path) item.path = file_path;
    gaps.push(item);
  };
  for (const [repository, manifest] of Object.entries(manifests)) {
    if (repository !== 'repository.local') { gap(repository, 'Repository binding unresolved; no external root is read'); continue; }
    for (const p of [...Object.keys(manifest.files), ...manifest.deleted]) {
      if (excluded(p, output)) throw new Error('Exchange manifest references excluded/generated material');
      safe_path(root, p);
    }
  }
  for (const ref of envelope.evidence) {
    if (ref.repository !== 'repository.local') continue;
    if (excluded(ref.path, output)) throw new Error('Exchange evidence references excluded/generated material');
    safe_path(root, ref.path);
    const local = Object.fromEntries(Object.entries(ref).filter(([key]) => !['repository', 'producer_id'].includes(key)));
    const error = verify_evidence(root, local, output);
    if (error || manifests[ref.repository].files[ref.path] !== ref.sha256) gap(ref.id, error || 'Evidence disagrees with imported source manifest', ref.path);
    candidates.push({ path: ref.path, evidence: ref.id, confidence: 'INFERRED', producer: envelope.producer.id,
      original_confidence: 'preserved on original claim' });
  }
  for (const claim of [...envelope.entities, ...envelope.occurrences]) {
    for (const ref of [...(claim.code_references ?? []), ...(claim.occurrence?.implementation ?? [])]) {
      if (ref.repository !== 'repository.local') continue;
      if (excluded(ref.path, output)) throw new Error('Exchange code reference targets excluded material');
      safe_path(root, ref.path);
      if (manifests[ref.repository].files[ref.path] !== ref.sha256) gap(claim.id, 'Code reference disagrees with imported source manifest', ref.path);
      try {
        const text = read_source(root, ref.path);
        if (source_hash(text) !== ref.sha256 || ref.end_line > split_lines(text).length) gap(claim.id, 'Stale code reference or range', ref.path);
      } catch { gap(claim.id, 'Unavailable code reference', ref.path); }
    }
  }
  return { sha256: fingerprint(envelope), producer: envelope.producer.id, status: gaps.length ? 'quarantined' : 'candidate-only',
    envelope, candidates, gaps, note: 'Imported claims are hints, not native source-reviewed requirements. No external tool was run.' };
}

/** Atomic explicit export; no overwriting unrelated files or following links. */
export function write_export(file: string, envelope: Data): void {
  file = path.resolve(file);
  const anchor = path.parse(file).root;
  safe_path(anchor, path.relative(anchor, file).split(path.sep).join('/'));
  const parent = path.dirname(file);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('Export directory does not exist');
  if (fs.existsSync(file)) {
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('Refuse to overwrite unrelated large file');
    let existing: unknown;
    try { existing = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))); }
    catch { throw new Error('Refuse to overwrite an unrelated file'); }
    if (!existing || Array.isArray(existing) || typeof existing !== 'object' || (existing as Data).contract !== 'change-knowledge') {
      throw new Error('Refuse to overwrite an unrelated file');
    }
  }
  const text = pretty_json(envelope, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Knowledge export exceeds 5 MB; narrow the supported scope');
  const temporary = path.join(parent, '.change-knowledge-' + randomUUID());
  try {
    fs.writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
