"""Shared vocabulary; identifiers survive renames through explicit aliases."""
import hashlib
import re

KINDS = (
    "system", "module", "feature", "flow", "entrypoint", "ui_surface", "component",
    "setting", "feature_flag", "data_entity", "external_system", "event", "job",
    "permission", "test_behavior", "decision", "constraint", "knowledge_gap",
)
RELATIONS = (
    "implemented_by", "exposed_at", "entered_through", "executes", "calls", "reads",
    "writes", "emits", "consumes", "written_by", "persisted_in", "read_by", "affects",
    "reused_by", "guards", "controls", "verifies", "depends_on", "invalidates",
    "propagates_to", "constrained_by", "configured_by",
)
CONFIDENCES = ("EXTRACTED", "CORROBORATED", "INFERRED", "UNKNOWN")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_id(kind: str, key: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")[:72] or "root"
    return f"{kind}.{slug}-{digest(key)[:8]}"


def check_id(value: str) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[a-z][a-z0-9_.-]{0,159}", value))
