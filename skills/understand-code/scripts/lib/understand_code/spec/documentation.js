/** Render documentation and assess structure/provenance, never semantic truth or execution. */
import path from 'node:path';
import { EXAMPLE_PROFILES, PROFILE_TOPICS, example_fingerprint } from '../documentation.js';
import { canonical_json, digest } from '../ontology.js';
import { entity_path, escape, page, quote_path, source_link } from './writer.js';
export function document_path(document) { return 'documents/' + document.id + '.md'; }
/** Preserve paragraphs without allowing arbitrary Markdown or HTML. */
export function prose(text) {
    return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim().split(/\n[ \t]*\n/).map((paragraph) => escape(paragraph).replaceAll('~', '\\~').replaceAll('$', '\\$')
        .replace(/^(\s*)([-+])(?=\s)/, '$1\\$2')
        .replace(/^(\s*)(\d+)([.)])(?=\s)/, '$1$2\\$3')).join('\n\n');
}
export function field(label, value) { return `**${label}:** ${prose(value)}\n\n`; }
export function table(columns, rows) {
    return '| ' + columns.map(escape).join(' | ') + ' |\n'
        + '| ' + columns.map(() => '---').join(' | ') + ' |\n'
        + rows.map((row) => '| ' + row.map(escape).join(' | ') + ' |\n').join('') + '\n';
}
export function fenced_example(example) {
    const code = example.code;
    const width = Math.max(2, ...(code.match(/`+/g) ?? []).map((match) => match.length)) + 1;
    const fence = '`'.repeat(width);
    return fence + example.language + '\n' + code + (code.endsWith('\n') ? '' : '\n') + fence + '\n\n';
}
export function sources(ids, refs, filename, output) {
    return ids.map((key) => Object.hasOwn(refs, key) ? source_link(filename, output, refs[key]) : `Missing evidence \`${escape(key)}\``).join(', ')
        || 'None supplied.';
}
export const MODE_NOTICES = {
    'as-built': 'As-built documentation describes the source snapshot. It does not establish observed deployment behavior.',
    proposal: 'Proposal: target behavior is not approved or implemented merely because this document was source-reviewed.',
    mixed: 'Mixed document: each requirement declares its basis. Proposed items are not evidence of approval or implementation.',
};
export const BASIS_NOTICES = {
    observed: 'Observed in source; not a claim of successful execution',
    specified: 'Specified by documentation or an explicit human record; implementation is not established by that record',
    proposed: 'Proposed target behavior; approval and implementation remain separate',
    unknown: 'Unknown; unresolved requirement',
};
export function render_documents(state, output) {
    const refs = Object.fromEntries(state.evidence.map((ref) => [ref.id, ref]));
    const snapshot = state.plan.snapshot;
    const documents = {};
    for (const entity of state.entities) {
        for (const document of (entity.documentation ?? [])) {
            const filename = document_path(document);
            let body = field('Purpose', document.purpose) + field('Audience', document.audience) + field('Scope', document.scope);
            body += `Profile: **${document.profile}**. Mode: **${document.mode}**.\n\n`;
            body += MODE_NOTICES[document.mode] + '\n\n';
            if (entity.stale || entity.conflict)
                body += '**Unresolved: this document inherits a stale or conflicting claim. Treat its content as historical until source review.**\n\n';
            else if (document.mode !== 'proposal' && !['EXTRACTED', 'CORROBORATED'].includes(entity.confidence)) {
                body += `**Unestablished: this document inherits ${entity.confidence} confidence; current behavior needs source review.**\n\n`;
            }
            for (const section of document.sections) {
                body += `## ${escape(section.title)}\n\nTopic: \`${section.topic}\`. Status: **${section.status}**.\n\n`;
                body += prose(section.content) + '\n\n';
                if (section.steps?.length)
                    body += section.steps.map((step, index) => `${index + 1}. ${escape(step)}`).join('\n') + '\n\n';
                if (section.table)
                    body += table(section.table.columns, section.table.rows);
                if (section.evidence.length)
                    body += 'Sources: ' + sources(section.evidence, refs, filename, output) + '\n\n';
            }
            const requirements = document.requirements ?? [];
            if (requirements.length) {
                body += '## Requirements and traceability\n\n';
                if (document.requirement_convention)
                    body += field('Requirement convention', document.requirement_convention);
                body += 'Verification procedures below are intent, not execution results. Test citations identify assertions; '
                    + 'they do not establish that those assertions passed.\n\n';
                body += '| Requirement | Basis | Verification method | Supporting sources | Test assertions |\n| --- | --- | --- | --- | --- |\n';
                for (const requirement of requirements) {
                    const verification = requirement.verification;
                    body += `| \`${requirement.id}\` | ${requirement.basis} | ${verification.method} | `
                        + `${sources(requirement.evidence, refs, filename, output)} | ${sources(verification.test_evidence, refs, filename, output)} |\n`;
                }
                body += '\n';
                for (const requirement of requirements) {
                    const verification = requirement.verification;
                    body += `### ${escape(requirement.id)}\n\n` + field('Basis', BASIS_NOTICES[requirement.basis]);
                    body += field('Statement', requirement.statement) + field('Rationale', requirement.rationale);
                    if (requirement.origin)
                        body += field('Origin', requirement.origin);
                    body += field('Verification procedure', verification.procedure) + field('Expected result', verification.expected);
                }
            }
            if (document.examples?.length)
                body += '## Examples\n\n';
            for (const example of (document.examples ?? [])) {
                const validation = example.validation;
                body += `### ${escape(example.title)}\n\n` + field('Kind', example.kind);
                body += field('Prerequisites', example.prerequisites) + fenced_example(example) + field('Expected result', example.expected);
                if (example.evidence.length)
                    body += 'Sources: ' + sources(example.evidence, refs, filename, output) + '\n\n';
                body += field('Validation status', validation.status) + field('Validation level', validation.level) + field('Validation reason', validation.reason);
                if (example.kind === 'illustrative')
                    body += 'Illustrative example; not verified execution.\n\n';
                const provenance = validation.provenance;
                if (provenance) {
                    if (provenance.snapshot !== snapshot || provenance.example_sha256 !== example_fingerprint(example)) {
                        body += '**Stale external validation: the recorded check does not bind this snapshot and example.**\n\n';
                    }
                    body += 'External check attestation; Understand Code did not execute this example.\n\n';
                    const labels = [['command', 'Command'], ['environment', 'Environment'], ['snapshot', 'Source snapshot'],
                        ['checked_at', 'Checked at'], ['runner', 'Runner'], ['output_sha256', 'Output SHA-256'],
                        ['example_sha256', 'Example SHA-256'], ['exit_code', 'Exit code']];
                    body += table(['Provenance', 'Value'], labels.map(([key, label]) => [label, String(provenance[key])]));
                }
            }
            body += '## Provenance and review\n\n';
            body += `Evidence confidence: **${entity.confidence}**. Citation checks establish identity, not semantic truth.\n\n`;
            const review = entity.review ?? { status: 'unreviewed' };
            body += field('Source review', review.status);
            if (review.reviewer)
                body += field('Reviewer', review.reviewer);
            if (review.method)
                body += field('Review method', review.method);
            body += `Inventory commit: \`${escape(state.inventory.commit)}\`. Inventory snapshot: \`${snapshot}\`.\n\n`;
            const evidence_commits = [...new Set(entity.evidence.filter((key) => Object.hasOwn(refs, key)).map((key) => refs[key].commit))].sort();
            body += 'Cited evidence commits: ' + (evidence_commits.map((commit) => `\`${escape(commit)}\``).join(', ') || 'none supplied') + '.\n\n';
            const target = path.posix.relative('documents', entity_path(entity));
            body += `Model entry: [${escape(entity.title)}](${quote_path(target)}).\n\n`;
            if (document.canonical_sources?.length) {
                body += '### Canonical sources\n\n' + sources(document.canonical_sources, refs, filename, output) + '\n\n';
                body += 'Preserve these existing contracts and records; resolve contradictions explicitly.\n\n';
            }
            body += '## Maintenance\n\n';
            if (document.owner)
                body += field('Owner', document.owner);
            body += 'Review this document when:\n\n' + document.review_when.map((trigger) => `- ${escape(trigger)}`).join('\n') + '\n';
            documents[filename] = page(document.title, body, { id: document.id, kind: 'documentation', confidence: entity.confidence });
        }
    }
    return documents;
}
/** Assess authored documents only; leave legacy integrity/coverage verification independent. */
export function assess_documents(state, current) {
    const refs = Object.fromEntries(state.evidence.map((ref) => [ref.id, ref]));
    const snapshot = digest(canonical_json(Object.fromEntries(Object.entries(current.files).map(([filename, value]) => [filename, value.sha256]))));
    const changed = snapshot !== state.plan.snapshot;
    const ids = new Map();
    for (const entity of state.entities) {
        for (const document of (entity.documentation ?? []))
            ids.set(document.id, (ids.get(document.id) ?? 0) + 1);
    }
    const reports = [];
    for (const entity of state.entities) {
        for (const document of (entity.documentation ?? [])) {
            const blockers = [];
            const warnings = [];
            if (ids.get(document.id) !== 1)
                blockers.push('Document ID is not globally unique.');
            const required = new Set(PROFILE_TOPICS[document.profile]);
            const present = new Set(document.sections.map((section) => section.topic));
            for (const topic of [...required].filter((topic) => !present.has(topic)).sort())
                blockers.push(`Missing required topic: ${topic}.`);
            for (const section of document.sections) {
                if (section.status === 'unknown')
                    (required.has(section.topic) ? blockers : warnings).push(`Unresolved topic ${section.topic}: ${section.id}.`);
            }
            if (!document.sections.some((section) => section.status === 'documented'))
                blockers.push('No documented sections; a document of only unknown or not-applicable sections is not ready.');
            if (entity.review?.status !== 'source-reviewed')
                blockers.push('Owning claim is unreviewed; source review is required, including for not-applicable decisions.');
            if (entity.stale || entity.conflict)
                blockers.push('Owning claim is stale or conflicting.');
            if (document.mode !== 'proposal' && !['EXTRACTED', 'CORROBORATED'].includes(entity.confidence))
                blockers.push('Owning claim is not established; current-behavior documentation needs reviewed evidence.');
            if (changed)
                blockers.push('Source snapshot changed since this document was generated.');
            for (const key of entity.evidence) {
                const ref = Object.hasOwn(refs, key) ? refs[key] : null;
                if (!ref)
                    blockers.push(`Missing supporting evidence: ${key}.`);
                else if (current.files[ref.path]?.sha256 !== ref.sha256)
                    blockers.push(`Stale or unavailable supporting evidence: ${ref.path}.`);
            }
            const requirements = document.requirements ?? [];
            if (document.profile === 'specification' && !requirements.length)
                blockers.push('Specification has no requirements or verification intent.');
            for (const requirement of requirements) {
                if (requirement.basis === 'unknown')
                    blockers.push(`Unknown requirement: ${requirement.id}.`);
                if (requirement.verification.method === 'unresolved')
                    blockers.push(`Unresolved requirement verification: ${requirement.id}.`);
                if (requirement.basis === 'specified')
                    warnings.push(`Specified requirement ${requirement.id} is documentary intent, not proof of implementation.`);
                if (requirement.basis === 'proposed')
                    warnings.push(`Proposed requirement ${requirement.id} does not establish approval or implementation.`);
            }
            const examples = document.examples ?? [];
            if (EXAMPLE_PROFILES.has(document.profile) && !examples.length)
                blockers.push('This document profile requires an example.');
            for (const example of examples) {
                if (example.kind === 'illustrative') {
                    warnings.push(`Illustrative example ${example.id} is not verified execution.`);
                    continue;
                }
                const validation = example.validation;
                const provenance = validation.provenance;
                if (validation.status !== 'passed' || validation.level !== 'behavior') {
                    blockers.push(`Runnable example ${example.id} needs a passed behavior check; recorded ${validation.status} at ${validation.level} level.`);
                }
                if (!provenance || provenance.snapshot !== snapshot || provenance.example_sha256 !== example_fingerprint(example)) {
                    blockers.push(`Runnable example ${example.id} has missing or stale validation provenance.`);
                }
            }
            reports.push({ id: document.id, entity: entity.id, ready: blockers.length === 0,
                blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] });
        }
    }
    return { ready: reports.length > 0 && reports.every((report) => report.ready),
        scope: 'Authored documents only; repository-wide coverage is reported separately.', documents: reports, total: reports.length,
        limitations: 'Structural readiness and current citations do not prove semantic correctness, approval, '
            + 'execution, or whole-repository completeness. Source review and external check attestations '
            + 'remain accountable judgments; this tool never executes examples.' };
}
