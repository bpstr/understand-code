"""Closed, evidence-bound authoring contracts; never execute documented code.

Document purpose, normative basis and evidence confidence are separate dimensions.
Cross-field checks here complement the deliberately small JSON Schema validator.
"""
from datetime import datetime
import json

from .ontology import digest

PROFILE_TOPICS = {
    'reference': ('inputs', 'outputs', 'errors', 'side-effects'),
    'how-to': ('prerequisites', 'steps', 'verification', 'troubleshooting'),
    'tutorial': ('prerequisites', 'steps', 'verification'),
    'explanation': ('context', 'design', 'tradeoffs'),
    'specification': ('behavior', 'interfaces', 'data', 'failures', 'security', 'quality', 'verification'),
}
EXAMPLE_PROFILES = frozenset(('reference', 'how-to', 'tutorial'))


def example_fingerprint(example: dict) -> str:
    """Bind an external check to the exact snippet, setup and claimed outcome."""
    return digest(json.dumps({key: example[key] for key in
                             ('language', 'code', 'prerequisites', 'expected')}, sort_keys=True))


def _nonblank(value) -> None:
    if isinstance(value, str) and not value.strip():
        raise ValueError('Documentation text must not be blank')
    if isinstance(value, dict):
        for item in value.values():
            _nonblank(item)
    elif isinstance(value, list):
        for item in value:
            _nonblank(item)


def _unique(items: list[dict], label: str) -> None:
    if len({item['id'] for item in items}) != len(items):
        raise ValueError(f'Duplicate documentation {label} ID')


def validate_documents(entity: dict, refs: dict, snapshot: str) -> None:
    """Validate authored payloads after closed shape/current-evidence validation.

Nested references must be owned by the entity so existing retention, freshness,
impact and retirement behavior also applies to authored documents.
"""
    documents = entity.get('documentation', [])
    _nonblank(documents)
    _unique(documents, 'document')
    owned = set(entity['evidence'])

    def citations(values: list[str], label: str, required: bool = False) -> None:
        if any(key not in owned or key not in refs for key in values):
            raise ValueError(f'{label}: documentation evidence must belong to its parent entity and current task')
        if required and not values:
            raise ValueError(f'{label}: documented content requires evidence')

    for document in documents:
        citations(document.get('canonical_sources', []), 'Canonical sources')
        sections = document['sections']
        _unique(sections, 'section')
        for section in sections:
            citations(section['evidence'], 'Section', section['status'] == 'documented')
            if section['status'] != 'documented' and ('steps' in section or 'table' in section):
                raise ValueError('Unknown/not-applicable sections contain a reason, not asserted steps or tables')
            table = section.get('table')
            if table and any(len(row) != len(table['columns']) for row in table['rows']):
                raise ValueError('Documentation table rows must match the column count')
        requirements = document.get('requirements', [])
        _unique(requirements, 'requirement')
        for requirement in requirements:
            basis = requirement['basis']
            citations(requirement['evidence'], 'Requirement', basis in ('observed', 'specified'))
            kinds = {refs[key]['kind'] for key in requirement['evidence']}
            if basis == 'observed' and not kinds.intersection(('source', 'config')):
                raise ValueError('Observed requirements need implementation source/config evidence')
            if basis == 'specified' and not kinds.intersection(('documentation', 'human')):
                raise ValueError('Specified requirements need documentary authority, not implementation alone')
            if basis == 'proposed' and not requirement.get('origin'):
                raise ValueError('Proposed requirements need an explicit origin; review is not approval')
            allowed = {'as-built': ('observed', 'unknown'), 'proposal': ('proposed', 'unknown')}
            if document['mode'] in allowed and basis not in allowed[document['mode']]:
                raise ValueError('Requirement basis contradicts document mode; use a mixed document when appropriate')
            verification = requirement['verification']
            citations(verification['test_evidence'], 'Requirement verification')
            if any(refs[key]['kind'] != 'test' for key in verification['test_evidence']):
                raise ValueError('Requirement test_evidence must cite test assertions, not execution claims')
            if basis == 'unknown' and verification['method'] != 'unresolved':
                raise ValueError('Unknown requirements must retain unresolved verification')
        examples = document.get('examples', [])
        _unique(examples, 'example')
        for example in examples:
            citations(example['evidence'], 'Example', example['kind'] == 'runnable')
            validation = example['validation']
            status = validation['status']
            provenance = validation.get('provenance')
            if example['kind'] == 'illustrative' and status != 'not-run':
                raise ValueError('Illustrative examples cannot claim executed validation')
            if status == 'not-run':
                if validation['level'] != 'none' or provenance is not None:
                    raise ValueError('An unexecuted example cannot contain check provenance or a validation level')
                continue
            if validation['level'] == 'none' or not provenance:
                raise ValueError('Checked examples require a validation level and external provenance')
            if provenance['snapshot'] != snapshot:
                raise ValueError('Example check belongs to a stale source snapshot')
            if provenance['example_sha256'] != example_fingerprint(example):
                raise ValueError('Example check fingerprint does not match code, prerequisites and expected result')
            if status == 'passed' and provenance['exit_code'] != 0:
                raise ValueError('A passing example check requires exit code zero')
            try:
                checked_at = datetime.fromisoformat(provenance['checked_at'].replace('Z', '+00:00'))
                if checked_at.tzinfo is None or checked_at.utcoffset() is None:
                    raise ValueError('timezone absent')
            except ValueError as error:
                raise ValueError('Example check timestamp must include a timezone') from error


def validate_document_ids(entities: list[dict], known_entities: list[dict]) -> None:
    """Keep one durable owner per generated document, including replacements."""
    owners = {}
    for entity in known_entities + entities:
        for document in entity.get('documentation', []):
            owner = owners.setdefault(document['id'], entity['id'])
            if owner != entity['id']:
                raise ValueError('Duplicate document ID across entities; document ownership cannot silently move')
