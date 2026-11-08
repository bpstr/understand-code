/** Closed, evidence-bound authoring contracts. Documented code is never executed. */
import { digest, canonical_json } from './ontology.js';
export const PROFILE_TOPICS = {
    reference: ['inputs', 'outputs', 'errors', 'side-effects'],
    'how-to': ['prerequisites', 'steps', 'verification', 'troubleshooting'],
    tutorial: ['prerequisites', 'steps', 'verification'],
    explanation: ['context', 'design', 'tradeoffs'],
    specification: ['behavior', 'interfaces', 'data', 'failures', 'security', 'quality', 'verification'],
};
export const EXAMPLE_PROFILES = new Set(['reference', 'how-to', 'tutorial']);
/** Bind an external check to the exact snippet, setup and claimed outcome. */
export function example_fingerprint(example) {
    return digest(canonical_json(Object.fromEntries(['language', 'code', 'prerequisites', 'expected'].map(key => [key, example[key]])), false));
}
function nonblank(value) {
    if (typeof value === 'string' && !value.trim())
        throw new Error('Documentation text must not be blank');
    if (Array.isArray(value))
        value.forEach(nonblank);
    else if (value && typeof value === 'object')
        Object.values(value).forEach(nonblank);
}
function unique(items, label) {
    if (new Set(items.map(item => item.id)).size !== items.length)
        throw new Error(`Duplicate documentation ${label} ID`);
}
/** Strict ISO timestamp check, including calendar validity and explicit timezone. */
export function timezone_timestamp(value) {
    // Date.parse accepts impossible dates by normalizing them; validate the actual
    // calendar before accepting an attestation timestamp.
    const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
    if (!match)
        return false;
    const [, y, m, d, h, min, s, zone] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
        || Number(h) > 23 || Number(min) > 59 || Number(s ?? '0') > 59)
        return false;
    if (zone !== 'Z') {
        const offset = zone.slice(1).replace(':', '');
        if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59)
            return false;
    }
    return true;
}
/** Nested references must be owned by the entity so its evidence lifecycle applies. */
export function validate_documents(entity, refs, snapshot) {
    const documents = entity.documentation ?? [];
    nonblank(documents);
    unique(documents, 'document');
    const owned = new Set(entity.evidence);
    function citations(values, label, required = false) {
        if (values.some(key => !owned.has(key) || !Object.hasOwn(refs, key))) {
            throw new Error(`${label}: documentation evidence must belong to its parent entity and current task`);
        }
        if (required && !values.length)
            throw new Error(`${label}: documented content requires evidence`);
    }
    for (const document of documents) {
        citations(document.canonical_sources ?? [], 'Canonical sources');
        const sections = document.sections;
        unique(sections, 'section');
        for (const section of sections) {
            citations(section.evidence, 'Section', section.status === 'documented');
            if (section.status !== 'documented' && ('steps' in section || 'table' in section)) {
                throw new Error('Unknown/not-applicable sections contain a reason, not asserted steps or tables');
            }
            const table = section.table;
            if (table && table.rows.some((row) => row.length !== table.columns.length)) {
                throw new Error('Documentation table rows must match the column count');
            }
        }
        const requirements = document.requirements ?? [];
        unique(requirements, 'requirement');
        for (const requirement of requirements) {
            const basis = requirement.basis;
            citations(requirement.evidence, 'Requirement', ['observed', 'specified'].includes(basis));
            const kinds = new Set(requirement.evidence.map((key) => refs[key].kind));
            if (basis === 'observed' && !kinds.has('source') && !kinds.has('config')) {
                throw new Error('Observed requirements need implementation source/config evidence');
            }
            if (basis === 'specified' && !kinds.has('documentation') && !kinds.has('human')) {
                throw new Error('Specified requirements need documentary authority, not implementation alone');
            }
            if (basis === 'proposed' && !requirement.origin)
                throw new Error('Proposed requirements need an explicit origin; review is not approval');
            const allowed = { 'as-built': ['observed', 'unknown'], proposal: ['proposed', 'unknown'] };
            if (Object.hasOwn(allowed, document.mode) && !allowed[document.mode].includes(basis)) {
                throw new Error('Requirement basis contradicts document mode; use a mixed document when appropriate');
            }
            const verification = requirement.verification;
            citations(verification.test_evidence, 'Requirement verification');
            if (verification.test_evidence.some((key) => refs[key].kind !== 'test')) {
                throw new Error('Requirement test_evidence must cite test assertions, not execution claims');
            }
            if (basis === 'unknown' && verification.method !== 'unresolved')
                throw new Error('Unknown requirements must retain unresolved verification');
        }
        const examples = document.examples ?? [];
        unique(examples, 'example');
        for (const example of examples) {
            citations(example.evidence, 'Example', example.kind === 'runnable');
            const validation = example.validation;
            const status = validation.status;
            const provenance = validation.provenance;
            if (example.kind === 'illustrative' && status !== 'not-run')
                throw new Error('Illustrative examples cannot claim executed validation');
            if (status === 'not-run') {
                if (validation.level !== 'none' || provenance != null) {
                    throw new Error('An unexecuted example cannot contain check provenance or a validation level');
                }
                continue;
            }
            if (validation.level === 'none' || !provenance)
                throw new Error('Checked examples require a validation level and external provenance');
            if (provenance.snapshot !== snapshot)
                throw new Error('Example check belongs to a stale source snapshot');
            if (provenance.example_sha256 !== example_fingerprint(example)) {
                throw new Error('Example check fingerprint does not match code, prerequisites and expected result');
            }
            if (status === 'passed' && provenance.exit_code !== 0)
                throw new Error('A passing example check requires exit code zero');
            if (!timezone_timestamp(provenance.checked_at))
                throw new Error('Example check timestamp must include a timezone');
        }
    }
}
/** One durable owner per generated document, including replacements. */
export function validate_document_ids(entities, known_entities) {
    const owners = new Map();
    for (const entity of [...known_entities, ...entities]) {
        for (const document of entity.documentation ?? []) {
            if (!owners.has(document.id))
                owners.set(document.id, entity.id);
            if (owners.get(document.id) !== entity.id) {
                throw new Error('Duplicate document ID across entities; document ownership cannot silently move');
            }
        }
    }
}
