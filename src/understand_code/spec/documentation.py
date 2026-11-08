"""Render reviewed documentation and assess its bounded readiness contract.

The assessment checks explicit structure and provenance. It does not execute an
example or decide whether prose follows from the cited source.
"""
from collections import Counter
import json
import os
import re
from urllib.parse import quote

from ..documentation import EXAMPLE_PROFILES, PROFILE_TOPICS, example_fingerprint
from ..ontology import digest
from .writer import entity_path, escape, page, source_link


def document_path(document: dict) -> str:
    return "documents/" + document["id"] + ".md"


def prose(text: str) -> str:
    """Preserve paragraphs without accepting arbitrary Markdown or HTML."""
    paragraphs = re.split(r"\n[ \t]*\n", text.replace("\r\n", "\n").replace("\r", "\n").strip())
    result = []
    for paragraph in paragraphs:
        value = escape(paragraph).replace("~", "\\~").replace("$", "\\$")
        value = re.sub(r"^(\s*)([-+])(?=\s)", r"\1\\\2", value)
        value = re.sub(r"^(\s*)(\d+)([.)])(?=\s)", r"\1\2\\\3", value)
        result.append(value)
    return "\n\n".join(result)


def field(label: str, value: str) -> str:
    return f"**{label}:** {prose(value)}\n\n"


def table(columns: list[str], rows: list[list[str]]) -> str:
    return ("| " + " | ".join(escape(value) for value in columns) + " |\n"
            + "| " + " | ".join("---" for _ in columns) + " |\n"
            + "".join("| " + " | ".join(escape(value) for value in row) + " |\n" for row in rows) + "\n")


def fenced_example(example: dict) -> str:
    # A longer fence preserves literal backticks and ownership markers in code.
    code = example["code"]
    width = max([2] + [len(match) for match in re.findall(r"`+", code)]) + 1
    fence = "`" * width
    return fence + example["language"] + "\n" + code + ("" if code.endswith("\n") else "\n") + fence + "\n\n"


def sources(ids: list[str], refs: dict, path: str, output: str) -> str:
    return ", ".join(source_link(path, output, refs[key]) if key in refs
                     else f"Missing evidence `{escape(key)}`" for key in ids) or "None supplied."


MODE_NOTICES = {
    "as-built": "As-built documentation describes the source snapshot. It does not establish observed deployment behavior.",
    "proposal": "Proposal: target behavior is not approved or implemented merely because this document was source-reviewed.",
    "mixed": "Mixed document: each requirement declares its basis. Proposed items are not evidence of approval or implementation.",
}

BASIS_NOTICES = {
    "observed": "Observed in source; not a claim of successful execution",
    "specified": "Specified by documentation or an explicit human record; implementation is not established by that record",
    "proposed": "Proposed target behavior; approval and implementation remain separate",
    "unknown": "Unknown; unresolved requirement",
}


def render_documents(state: dict, output: str) -> dict[str, str]:
    refs = {ref["id"]: ref for ref in state["evidence"]}
    snapshot = state["plan"]["snapshot"]
    documents = {}
    for entity in state["entities"]:
        for document in entity.get("documentation", []):
            path = document_path(document)
            body = (field("Purpose", document["purpose"]) + field("Audience", document["audience"])
                    + field("Scope", document["scope"]))
            body += f"Profile: **{document['profile']}**. Mode: **{document['mode']}**.\n\n"
            body += MODE_NOTICES[document["mode"]] + "\n\n"
            if entity.get("stale") or entity.get("conflict"):
                body += "**Unresolved: this document inherits a stale or conflicting claim. Treat its content as historical until source review.**\n\n"
            elif document["mode"] != "proposal" and entity["confidence"] not in ("EXTRACTED", "CORROBORATED"):
                body += f"**Unestablished: this document inherits {entity['confidence']} confidence; current behavior needs source review.**\n\n"
            for section in document["sections"]:
                body += f"## {escape(section['title'])}\n\n"
                body += f"Topic: `{section['topic']}`. Status: **{section['status']}**.\n\n"
                body += prose(section["content"]) + "\n\n"
                if section.get("steps"):
                    body += "\n".join(f"{index}. {escape(step)}" for index, step in enumerate(section["steps"], 1)) + "\n\n"
                if section.get("table"):
                    body += table(section["table"]["columns"], section["table"]["rows"])
                if section["evidence"]:
                    body += "Sources: " + sources(section["evidence"], refs, path, output) + "\n\n"
            requirements = document.get("requirements", [])
            if requirements:
                body += "## Requirements and traceability\n\n"
                if document.get("requirement_convention"):
                    body += field("Requirement convention", document["requirement_convention"])
                body += ("Verification procedures below are intent, not execution results. Test citations identify assertions; "
                         "they do not establish that those assertions passed.\n\n")
                body += "| Requirement | Basis | Verification method | Supporting sources | Test assertions |\n| --- | --- | --- | --- | --- |\n"
                for requirement in requirements:
                    verification = requirement["verification"]
                    body += (f"| `{requirement['id']}` | {requirement['basis']} | {verification['method']} | "
                             f"{sources(requirement['evidence'], refs, path, output)} | "
                             f"{sources(verification['test_evidence'], refs, path, output)} |\n")
                body += "\n"
                for requirement in requirements:
                    verification = requirement["verification"]
                    body += f"### {escape(requirement['id'])}\n\n"
                    body += field("Basis", BASIS_NOTICES[requirement["basis"]])
                    body += field("Statement", requirement["statement"]) + field("Rationale", requirement["rationale"])
                    if requirement.get("origin"):
                        body += field("Origin", requirement["origin"])
                    body += field("Verification procedure", verification["procedure"])
                    body += field("Expected result", verification["expected"])
            if document.get("examples"):
                body += "## Examples\n\n"
            for example in document.get("examples", []):
                validation = example["validation"]
                body += f"### {escape(example['title'])}\n\n" + field("Kind", example["kind"])
                body += field("Prerequisites", example["prerequisites"]) + fenced_example(example)
                body += field("Expected result", example["expected"])
                if example["evidence"]:
                    body += "Sources: " + sources(example["evidence"], refs, path, output) + "\n\n"
                body += field("Validation status", validation["status"]) + field("Validation level", validation["level"])
                body += field("Validation reason", validation["reason"])
                if example["kind"] == "illustrative":
                    body += "Illustrative example; not verified execution.\n\n"
                provenance = validation.get("provenance")
                if provenance:
                    if provenance["snapshot"] != snapshot or provenance["example_sha256"] != example_fingerprint(example):
                        body += "**Stale external validation: the recorded check does not bind this snapshot and example.**\n\n"
                    body += "External check attestation; Understand Code did not execute this example.\n\n"
                    labels = (("command", "Command"), ("environment", "Environment"), ("snapshot", "Source snapshot"),
                              ("checked_at", "Checked at"), ("runner", "Runner"), ("output_sha256", "Output SHA-256"),
                              ("example_sha256", "Example SHA-256"), ("exit_code", "Exit code"))
                    body += table(["Provenance", "Value"], [[label, str(provenance[key])] for key, label in labels])
            body += "## Provenance and review\n\n"
            body += f"Evidence confidence: **{entity['confidence']}**. Citation checks establish identity, not semantic truth.\n\n"
            review = entity.get("review", {"status": "unreviewed"})
            body += field("Source review", review["status"])
            if review.get("reviewer"):
                body += field("Reviewer", review["reviewer"])
            if review.get("method"):
                body += field("Review method", review["method"])
            body += f"Inventory commit: `{escape(state['inventory']['commit'])}`. Inventory snapshot: `{snapshot}`.\n\n"
            evidence_commits = sorted({refs[key]["commit"] for key in entity["evidence"] if key in refs})
            body += "Cited evidence commits: " + (", ".join(f"`{escape(commit)}`" for commit in evidence_commits)
                                                 or "none supplied") + ".\n\n"
            target = os.path.relpath(entity_path(entity), "documents")
            body += f"Model entry: [{escape(entity['title'])}]({quote(target, safe='/')}).\n\n"
            if document.get("canonical_sources"):
                body += "### Canonical sources\n\n" + sources(document["canonical_sources"], refs, path, output) + "\n\n"
                body += "Preserve these existing contracts and records; resolve contradictions explicitly.\n\n"
            body += "## Maintenance\n\n"
            if document.get("owner"):
                body += field("Owner", document["owner"])
            body += "Review this document when:\n\n" + "\n".join(f"- {escape(trigger)}" for trigger in document["review_when"]) + "\n"
            documents[path] = page(document["title"], body,
                                   {"id": document["id"], "kind": "documentation", "confidence": entity["confidence"]})
    return documents


def assess_documents(state: dict, current: dict) -> dict:
    """Assess authored documents only; never reinterpret legacy verification."""
    refs = {ref["id"]: ref for ref in state["evidence"]}
    snapshot = digest(json.dumps({path: value["sha256"] for path, value in current["files"].items()}, sort_keys=True))
    changed = snapshot != state["plan"]["snapshot"]
    ids = Counter(document["id"] for entity in state["entities"] for document in entity.get("documentation", []))
    reports = []
    for entity in state["entities"]:
        for document in entity.get("documentation", []):
            blockers, warnings = [], []
            if ids[document["id"]] != 1:
                blockers.append("Document ID is not globally unique.")
            required = set(PROFILE_TOPICS[document["profile"]])
            present = {section["topic"] for section in document["sections"]}
            for topic in sorted(required - present):
                blockers.append(f"Missing required topic: {topic}.")
            for section in document["sections"]:
                if section["status"] == "unknown":
                    message = f"Unresolved topic {section['topic']}: {section['id']}."
                    (blockers if section["topic"] in required else warnings).append(message)
            if not any(section["status"] == "documented" for section in document["sections"]):
                blockers.append("No documented sections; a document of only unknown or not-applicable sections is not ready.")
            if entity.get("review", {}).get("status") != "source-reviewed":
                blockers.append("Owning claim is unreviewed; source review is required, including for not-applicable decisions.")
            if entity.get("stale") or entity.get("conflict"):
                blockers.append("Owning claim is stale or conflicting.")
            if document["mode"] != "proposal" and entity["confidence"] not in ("EXTRACTED", "CORROBORATED"):
                blockers.append("Owning claim is not established; current-behavior documentation needs reviewed evidence.")
            if changed:
                blockers.append("Source snapshot changed since this document was generated.")
            for key in entity["evidence"]:
                ref = refs.get(key)
                if ref is None:
                    blockers.append(f"Missing supporting evidence: {key}.")
                elif current["files"].get(ref["path"], {}).get("sha256") != ref["sha256"]:
                    blockers.append(f"Stale or unavailable supporting evidence: {ref['path']}.")
            requirements = document.get("requirements", [])
            if document["profile"] == "specification" and not requirements:
                blockers.append("Specification has no requirements or verification intent.")
            for requirement in requirements:
                if requirement["basis"] == "unknown":
                    blockers.append(f"Unknown requirement: {requirement['id']}.")
                if requirement["verification"]["method"] == "unresolved":
                    blockers.append(f"Unresolved requirement verification: {requirement['id']}.")
                if requirement["basis"] == "specified":
                    warnings.append(f"Specified requirement {requirement['id']} is documentary intent, not proof of implementation.")
                if requirement["basis"] == "proposed":
                    warnings.append(f"Proposed requirement {requirement['id']} does not establish approval or implementation.")
            examples = document.get("examples", [])
            if document["profile"] in EXAMPLE_PROFILES and not examples:
                blockers.append("This document profile requires an example.")
            for example in examples:
                if example["kind"] == "illustrative":
                    warnings.append(f"Illustrative example {example['id']} is not verified execution.")
                    continue
                validation = example["validation"]
                provenance = validation.get("provenance", {})
                if validation["status"] != "passed" or validation["level"] != "behavior":
                    blockers.append(f"Runnable example {example['id']} needs a passed behavior check; "
                                    f"recorded {validation['status']} at {validation['level']} level.")
                if (not provenance or provenance.get("snapshot") != snapshot
                        or provenance.get("example_sha256") != example_fingerprint(example)):
                    blockers.append(f"Runnable example {example['id']} has missing or stale validation provenance.")
            reports.append({"id": document["id"], "entity": entity["id"], "ready": not blockers,
                            "blockers": list(dict.fromkeys(blockers)), "warnings": list(dict.fromkeys(warnings))})
    return {"ready": bool(reports) and all(report["ready"] for report in reports),
            "scope": "Authored documents only; repository-wide coverage is reported separately.",
            "documents": reports, "total": len(reports),
            "limitations": "Structural readiness and current citations do not prove semantic correctness, approval, "
                           "execution, or whole-repository completeness. Source review and external check attestations "
                           "remain accountable judgments; this tool never executes examples."}
