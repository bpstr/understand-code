/** Transactional directory replacement with protected human regions. */
import fs from 'node:fs';
import path from 'node:path';
import { canonical_json, pretty_json, digest, stable_id } from '../ontology.js';
import { safe_path } from '../evidence.js';
import { assess } from '../coverage.js';
import { document_path, render_documents } from './documentation.js';

type RecordData = Record<string, any>;

export const START = '<!-- understand-code:generated:start -->';
export const END = '<!-- understand-code:generated:end -->';
export const HUMAN = '\n\n## Maintainer notes\n\n<!-- understand-code:human -->\n';

export function json_text(value: unknown): string { return pretty_json(value, 2) + '\n'; }
export function jsonl(values: unknown[]): string { return values.map((value) => canonical_json(value) + '\n').join(''); }

export function escape(text: unknown): string {
  let value = String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', ' ');
  for (const character of ['\\', '`', '*', '_', '[', ']', '|', '#']) value = value.replaceAll(character, '\\' + character);
  return value;
}

/** Percent-encode a relative Markdown URL exactly, preserving only path separators. */
export function quote_path(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

export function page(title: string, body: string, entity: RecordData | null = null): string {
  let front = '';
  if (entity) front = '---\n' + ['id', 'kind', 'confidence'].map((key) => `${key}: ${canonical_json(entity[key])}`).join('\n') + '\n---\n';
  return front + START + `\n# ${escape(title)}\n\n` + body.trimEnd() + '\n' + END + HUMAN;
}

/** Ignore literal ownership markers inside standalone CommonMark fences. */
export function split_generated(text: string): [string, string] {
  const starts: number[] = [];
  const ends: number[] = [];
  let fence: [string, number] | null = null;
  let offset = 0;
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  for (const line of lines) {
    const candidate = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)[\r\n]*$/.exec(line);
    if (fence) {
      if (candidate && candidate[1][0] === fence[0] && candidate[1].length >= fence[1] && !candidate[2].trim()) fence = null;
    } else if (candidate && (candidate[1][0] !== '`' || !candidate[2].includes('`'))) {
      fence = [candidate[1][0], candidate[1].length];
    } else {
      for (let index = line.indexOf(START); index !== -1; index = line.indexOf(START, index + START.length)) starts.push(offset + index);
      for (let index = line.indexOf(END); index !== -1; index = line.indexOf(END, index + END.length)) ends.push(offset + index);
    }
    offset += line.length;
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) {
    throw new Error('Managed document markers are missing, duplicated, or reordered');
  }
  const boundary = ends[0] + END.length;
  return [text.slice(0, boundary), text.slice(boundary)];
}

export function generated(text: string): string { return split_generated(text)[0]; }
export function append_generated(text: string, content: string): string {
  const [prefix, suffix] = split_generated(text);
  return prefix.slice(0, -END.length) + content + END + suffix;
}

export function source_link(page_path: string, output: string, ref: RecordData): string {
  const relative = path.posix.relative(path.posix.join(output, path.posix.dirname(page_path)), ref.path);
  return `[${escape(ref.path)}:${ref.start_line}](${quote_path(relative)}#L${ref.start_line}-L${ref.end_line})`;
}

export function entity_path(entity: RecordData): string {
  const folders: Record<string, string> = { feature: 'features', flow: 'flows', setting: 'settings', feature_flag: 'settings',
    entrypoint: 'entrypoints', ui_surface: 'ui', component: 'ui', data_entity: 'data', concept: 'concepts', occurrence: 'occurrences',
    external_system: 'integrations', permission: 'cross-cutting', event: 'flows', job: 'flows' };
  return (Object.hasOwn(folders, entity.kind) ? folders[entity.kind] : 'architecture') + '/' + entity.id + '.md';
}

export function render(state: RecordData, output: string): Record<string, string> {
  const inv = state.inventory;
  const refs: Record<string, RecordData> = Object.fromEntries(state.evidence.map((ref: RecordData) => [ref.id, ref]));
  const entities: Record<string, RecordData> = Object.fromEntries(state.entities.map((entity: RecordData) => [entity.id, entity]));
  const paths: Record<string, string> = Object.fromEntries(Object.entries(entities).map(([key, entity]) => [key, entity_path(entity)]));
  const docs: Record<string, string> = {};
  for (const [key, entity] of Object.entries(entities)) {
    const filename = paths[key];
    let body = `Confidence: **${entity.confidence}**. Citation checks establish source identity, not semantic truth.\n\n`;
    if (entity.stale || entity.conflict) body += '**Unresolved:** the following is a historical interpretation, withheld from established facts until source review.\n\n';
    body += escape(entity.summary) + '\n\n## Evidence\n\n';
    body += (entity.evidence as string[]).filter((ref) => Object.hasOwn(refs, ref)).map((ref) => `- ${source_link(filename, output, refs[ref])} (\`${ref}\`)`).join('\n')
      || 'No supporting evidence; this is an open question.';
    body += '\n\n## Relationships and change map\n\n';
    const related: RecordData[] = state.relations.filter((relation: RecordData) => [relation.source, relation.target].includes(key));
    for (const relation of related) {
      const other = relation.source === key ? relation.target : relation.source;
      const target = path.posix.relative(path.posix.dirname(filename), paths[other]);
      const direction = relation.source === key ? 'outgoing' : 'incoming';
      body += `- ${direction} \`${relation.kind}\` [${escape(entities[other].title)}](${quote_path(target)}) — ${relation.confidence}`;
      body += '; ' + (relation.evidence as string[]).filter((ref) => Object.hasOwn(refs, ref)).map((ref) => source_link(filename, output, refs[ref])).join(', ') + '\n';
    }
    if (!related.length) body += 'No verified cross-layer relationships recorded. Investigate the cited implementation before changing behavior.\n';
    if (entity.details && typeof entity.details === 'object' && !Array.isArray(entity.details)) {
      body += '\n## Investigation notes (same confidence as this entity)\n\n';
      for (const [label, detail] of Object.entries(entity.details)) body += `- **${escape(label)}:** ${escape(detail)}\n`;
    }
    if (entity.search_terms?.length) body += '\n## Search vocabulary\n\n' + entity.search_terms.map(escape).join(', ') + '\n';
    const occurrences = Object.values(entities).filter((item) => item.occurrence?.concept === key);
    if (['concept', 'feature', 'setting'].includes(entity.kind)) {
      body += '\n## Occurrence inventory and supported variants\n\n';
      for (const occurrence of occurrences) {
        const surface = occurrence.occurrence.surface;
        const relative = path.posix.relative(path.posix.dirname(filename), paths[occurrence.id]);
        const surface_path = path.posix.relative(path.posix.dirname(filename), paths[surface]);
        body += `- [${escape(occurrence.title)}](${quote_path(relative)}) on [${escape(entities[surface].title)}](${quote_path(surface_path)}) — `
          + `${escape(occurrence.occurrence.conditions.join(', ') || 'unconditional static variant')}; ${occurrence.confidence}; ${occurrence.stale ? 'stale' : 'source-bound'}\n`;
      }
      if (!occurrences.length) body += 'No confirmed occurrence inventory yet; this is not evidence of absence.\n';
      body += '\nPrimary surfaces (`primary_surface`) and canonical implementations (`implemented_by`) are distinct relationships above.\n';
    }
    if (entity.occurrence) {
      const occurrence = entity.occurrence;
      body += '\n## Stable occurrence anchor\n\n' + escape(occurrence.anchor) + '\n\n';
      for (const label of ['concept', 'surface']) {
        const other = occurrence[label];
        const relative = path.posix.relative(path.posix.dirname(filename), paths[other]);
        body += `- ${label}: [${escape(entities[other].title)}](${quote_path(relative)})\n`;
      }
      body += '\nConditions: ' + escape(occurrence.conditions.join(', ') || 'unconditional static variant') + '\n';
    }
    const matching_scopes = Object.values(state.change_scopes ?? {}).filter((scope: any) => scope.resolution.entities.includes(key)
      || scope.resolution.required_anchors.includes(key)) as RecordData[];
    if (matching_scopes.length) {
      body += '\n## Change checklist\n\n';
      for (const scope of matching_scopes) {
        const relative = path.posix.relative(path.posix.dirname(filename), 'changes/' + scope.id + '.md');
        body += `- [${escape(scope.request.topic)}](${relative}) — preserve and account for every baseline/target obligation.\n`;
      }
    }
    if (entity.documentation?.length) {
      body += '\n## Documentation and specifications\n\n';
      for (const document of entity.documentation as RecordData[]) {
        const relative = path.posix.relative(path.posix.dirname(filename), document_path(document));
        body += `- [${escape(document.title)}](${quote_path(relative)}) — ${document.profile}, ${document.mode}\n`;
      }
    }
    docs[filename] = page(entity.title, body, entity);
  }
  let index = `Reconstructed source commit: \`${inv.commit}\`. Snapshot: \`${state.plan.snapshot}\`.\n\n`
    + 'This is an evidence index and semantic model, not a guarantee of correctness. Verify source before implementation.\n\n'
    + '## Start here\n\n- [Overview](overview.md)\n- [Coverage and gaps](knowledge-gaps.md)\n'
    + '- [Agent readiness](agent/readiness.md)\n- [Instruction map](agent/instruction-map.md)\n'
    + '- [Build, test and run](operations/build-test-run.md)\n\n## Concepts\n\n';
  index += Object.values(entities).map((entity) => `- [${escape(entity.title)}](${paths[entity.id]}) — ${entity.kind}, ${entity.confidence}`).join('\n')
    || 'Native investigation pending; no product features have been asserted.';
  const scopes = Object.values(state.change_scopes ?? {}) as RecordData[];
  if (scopes.length) index += '\n\n## Change coverage\n\n' + scopes.map((scope) => `- [${escape(scope.request.topic)}](changes/${scope.id}.md)`).join('\n');
  const documents = Object.values(entities).flatMap((entity) => (entity.documentation ?? []) as RecordData[]);
  if (documents.length) index += '\n\n## Documentation and specifications\n\n'
    + documents.map((document) => `- [${escape(document.title)}](${document_path(document)}) — ${document.profile}, ${document.mode}`).join('\n');
  docs['README.md'] = page('Codebase Spec', index);
  docs['overview.md'] = page('Repository overview', `Scanned ${Object.keys(inv.files).length} text files (${inv.bytes_read} bytes).\n\n`
    + 'Languages by file extension: ' + escape(canonical_json(inv.languages))
    + '. Framework and behavioral interpretations require native source review.\n\n'
    + 'Code-intelligence retrieval is host-managed according to applicable agent instructions; external tool output is never source evidence.\n\n'
    + 'See `_meta/inventory.json` for manifests, candidates, evidence and scan exclusions.');
  if (inv.analysis_notes?.length) {
    const notices = new Map<string, number>();
    for (const note of inv.analysis_notes as RecordData[]) notices.set(note.reason, (notices.get(note.reason) ?? 0) + 1);
    const detail = '\n## Static analysis boundaries\n\n'
      + [...notices].map(([reason, count]) => `- ${escape(reason)} (${count} file${count === 1 ? '' : 's'}).`).join('\n')
      + '\n\nThese source files remain available for native source review. Lexical candidates do not establish syntax, behavior or complete coverage. '
      + 'Per-file notes are recorded in `_meta/inventory.json` and supplied to the relevant investigation tasks.\n';
    docs['overview.md'] = append_generated(docs['overview.md'], detail);
  }
  const pending = state.plan.tasks.filter((task: RecordData) => task.status !== 'accepted').length;
  let gaps = `Pending specialist tasks: ${pending}. Deferred scopes: ${state.plan.deferred.length}. Skipped files: ${inv.skipped.length}.\n\n`;
  for (const gap of state.gaps as RecordData[]) gaps += `## ${gap.id}\n\n${escape(gap.question)}\n\nNext step: ${escape(gap.next_step)}\n\n`;
  gaps += 'Full skipped paths and deferred scopes are in `_meta/inventory.json` and `_meta/plan.json`. Missing coverage is not evidence of absent functionality.\n';
  docs['knowledge-gaps.md'] = page('Knowledge gaps and coverage', gaps);
  const issues = state.audit.issues.map((issue: RecordData) => `- ${escape(issue.path || 'Repository')}: ${escape(issue.issue)} (${issue.confidence})`).join('\n');
  docs['agent/readiness.md'] = page('Agent readiness', issues + '\n\n' + state.audit.limitations.join('\n'));
  docs['agent/instruction-map.md'] = page('Instruction map', state.audit.instructions.map((item: RecordData) =>
    `- \`${escape(item.path)}\` — scope \`${escape(item.scope)}\`, ${item.bytes} bytes, override=${item.override ? 'True' : 'False'}`).join('\n')
    || 'No instruction files located within scan scope.');
  const manifests = Object.entries(inv.files).filter(([, value]) => (value as RecordData).manifest).map(([filename]) => filename);
  docs['operations/build-test-run.md'] = page('Build, test and run', 'Commands are not executed during reconstruction. Read and validate repository instructions before running them.\n\nManifest candidates:\n\n'
    + manifests.map((filename) => `- \`${escape(filename)}\``).join('\n'));
  docs['glossary.md'] = page('Glossary', Object.values(entities).map((entity) => `- **${escape(entity.title)}** (\`${entity.id}\`): ${escape(entity.summary)} [${entity.confidence}]`).join('\n')
    || 'Concept vocabulary awaits native investigation.');
  for (const source of Object.keys(inv.files)) {
    const supported = Object.values(entities).filter((entity) => entity.evidence.some((ref: string) => refs[ref]?.path === source));
    const relations: RecordData[] = state.relations.filter((relation: RecordData) => relation.evidence.some((ref: string) => refs[ref]?.path === source));
    if (!supported.length && !relations.length) continue;
    const code_path = 'code/' + stable_id('source', source) + '.md';
    let body = 'Source-backed associations; source inventory alone does not establish behavior.\n\n';
    for (const entity of supported) {
      const link = path.posix.relative('code', paths[entity.id]);
      body += `- [${escape(entity.title)}](${quote_path(link)}) — ${entity.kind}, ${entity.confidence}\n`;
      const backlink = path.posix.relative(path.posix.dirname(paths[entity.id]), code_path);
      docs[paths[entity.id]] = append_generated(docs[paths[entity.id]], `\nSource index: [${escape(source)}](${backlink})\n`);
    }
    for (const relation of relations) body += `- Relation \`${relation.kind}\`: \`${relation.source}\` → \`${relation.target}\`; ${relation.confidence}\n`;
    docs[code_path] = page(source, body);
  }
  for (const scope of scopes) {
    const report = assess(scope, state, inv);
    let body = escape(report.summary) + `\n\nBaseline: \`${scope.baseline.id}\`. Target: \`${scope.target.id}\`.\n\n## Acceptance standard\n\n`;
    for (const criterion of scope.request.standard.criteria as RecordData[]) body += `- \`${criterion.id}\`: ${escape(criterion.description)} (${criterion.verification})\n`;
    if (!scope.request.standard.criteria.length) body += 'Unresolved requirements: no concrete standard supplied.\n';
    body += '\n## Coverage axes\n\n';
    for (const axis of ['inventory_coverage', 'investigation_coverage', 'discovery_coverage', 'occurrence_accounting', 'behavioral_verification']) body += `- \`${axis}\`: **${report[axis].status}**\n`;
    body += '\n## Occurrences and mandatory inspection anchors\n\n| Obligation | Kind | Surface | Disposition |\n| --- | --- | --- | --- |\n';
    for (const [key, obligation] of Object.entries(scope.obligations) as [string, RecordData][]) {
      const disposition = scope.dispositions[key];
      let status = disposition?.disposition ?? 'unresolved';
      if (disposition && disposition.revision !== scope.revision) status += ' (invalidated)';
      body += `| ${escape(key)} | ${obligation.kind} | ${escape(obligation.surface)} | ${escape(status)} |\n`;
    }
    body += '\n## Independent discovery roster\n\n';
    for (const [key, candidate] of Object.entries(scope.candidates) as [string, RecordData][]) {
      const review = scope.candidate_reviews[key] ?? {};
      const status = review.revision === scope.revision ? review.status ?? 'unresolved' : 'unresolved / stale review';
      body += `- \`${escape(candidate.path)}\` — ${escape(status)}\n`;
    }
    body += '\n## Unresolved frontiers\n\n';
    for (const item of report.discovery_coverage.frontier as RecordData[]) body += `- ${escape(item.id)}: ${escape(item.reason)}\n`;
    body += `\nFull provenance, review history, exclusions and current obligations: \`../_meta/change-scopes/${scope.id}/scope.json\`.\n`;
    body += '\nUnderstand Code executed no target-application tests. External execution evidence and static-only acceptance policy are explicit in the coverage report.\n';
    docs['changes/' + scope.id + '.md'] = page(scope.request.topic, body);
  }
  Object.assign(docs, render_documents(state, output));
  return docs;
}

/** Reject all output symlinks before copying anything into a staging directory. */
function reject_symlinks(directory: string): void {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Symlink in output: ${directory}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in output: ${filename}`);
    if (entry.isDirectory()) reject_symlinks(filename);
  }
}

/** Preflight every conflict before mutation; preserve unmanaged files and human notes. */
export function write(output: string, docs: Record<string, string>, metadata: Record<string, string>, manifest: RecordData): void {
  let old: RecordData = {};
  // lstat detects a dangling symlink too, unlike existsSync.
  const output_exists = fs.lstatSync(output, { throwIfNoEntry: false });
  if (output_exists) {
    if (output_exists.isSymbolicLink()) throw new Error(`Symlink in output: ${output}`);
    const marker = safe_path(output, '_meta/manifest.json');
    if (!fs.statSync(marker, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('Output exists without an Understand Code manifest; choose a new output directory');
    }
    old = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (old.producer !== 'understand-code') throw new Error('Output is owned by another producer');
    reject_symlinks(output);
    for (const [relative, expected] of Object.entries(old.managed ?? {})) {
      const filename = safe_path(output, relative);
      if (!fs.statSync(filename, { throwIfNoEntry: false })?.isFile() || digest(generated(fs.readFileSync(filename, 'utf8'))) !== expected) {
        throw new Error(`Generated region edited or removed: ${relative}. Preserve the edit as a maintainer note before regeneration.`);
      }
    }
    for (const [relative, text] of Object.entries(docs)) {
      const filename = safe_path(output, relative);
      if (fs.existsSync(filename)) {
        if (!Object.hasOwn(old.managed ?? {}, relative)) throw new Error(`Unmanaged document would be overwritten: ${relative}`);
        docs[relative] = generated(text) + split_generated(fs.readFileSync(filename, 'utf8'))[1];
      }
    }
    for (const relative of Object.keys(old.managed ?? {})) {
      if (Object.hasOwn(docs, relative)) continue;
      const prior = fs.readFileSync(safe_path(output, relative), 'utf8');
      docs[relative] = generated(page('Retired concept', 'This concept is no longer in the current model. Consult Git history and maintainer notes; do not use it as current evidence.')) + split_generated(prior)[1];
    }
  }
  // Even first writes validate filenames before making a staging directory.
  for (const relative of [...Object.keys(docs), ...Object.keys(metadata)]) safe_path(output, relative);
  manifest.managed = Object.fromEntries(Object.entries(docs).map(([relative, text]) => [relative, digest(generated(text))]));
  manifest.metadata_hashes = { ...(old.metadata_hashes ?? {}), ...Object.fromEntries(Object.entries(metadata).map(([relative, text]) => [relative, digest(text)])) };
  metadata['_meta/manifest.json'] = json_text(manifest);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, '.understand-code-stage-'));
  const backup = stage + '-backup';
  try {
    if (fs.existsSync(output)) fs.cpSync(output, stage, { recursive: true, dereference: false });
    for (const [relative, text] of Object.entries({ ...docs, ...metadata })) {
      const destination = safe_path(stage, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === text) continue;
      fs.writeFileSync(destination, text, 'utf8');
    }
    if (fs.existsSync(output)) fs.renameSync(output, backup);
    try { fs.renameSync(stage, output); }
    catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, output);
      throw error;
    }
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
  }
}
