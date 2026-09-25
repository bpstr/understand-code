"""Transactional directory replacement with human-region preservation."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.parse import quote

from ..ontology import digest

START = "<!-- understand-code:generated:start -->"
END = "<!-- understand-code:generated:end -->"
HUMAN = "\n\n## Maintainer notes\n\n<!-- understand-code:human -->\n"


def json_text(value) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def jsonl(values: list) -> str:
    return "".join(json.dumps(v, sort_keys=True, ensure_ascii=True) + "\n" for v in values)


def escape(text: str) -> str:
    # Claims remain plain text; provider content cannot inject managed regions or HTML.
    value = str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", " ")
    for char in ("\\", "`", "*", "_", "[", "]", "|", "#"):
        value = value.replace(char, "\\" + char)
    return value


def page(title: str, body: str, entity: dict | None = None) -> str:
    front = ""
    if entity:
        front = "---\n" + "\n".join(f"{k}: {json.dumps(entity[k])}" for k in ("id", "kind", "confidence")) + "\n---\n"
    return front + START + f"\n# {escape(title)}\n\n" + body.rstrip() + "\n" + END + HUMAN


def generated(text: str) -> str:
    if text.count(START) != 1 or text.count(END) != 1 or text.index(START) > text.index(END):
        raise ValueError("Managed document markers are missing, duplicated, or reordered")
    return text[:text.index(END) + len(END)]


def source_link(page_path: str, output: str, ref: dict) -> str:
    relative = os.path.relpath(ref["path"], str(Path(output) / Path(page_path).parent))
    return f"[{escape(ref['path'])}:{ref['start_line']}]({quote(relative, safe='/')}#L{ref['start_line']}-L{ref['end_line']})"


def entity_path(entity: dict) -> str:
    folders = {"feature": "features", "flow": "flows", "setting": "settings", "feature_flag": "settings",
               "entrypoint": "entrypoints", "ui_surface": "ui", "component": "ui", "data_entity": "data",
               "concept": "concepts", "occurrence": "occurrences",
               "external_system": "integrations", "permission": "cross-cutting", "event": "flows", "job": "flows"}
    return folders.get(entity["kind"], "architecture") + "/" + entity["id"] + ".md"


def render(state: dict, output: str) -> dict[str, str]:
    inv = state["inventory"]
    refs = {r["id"]: r for r in state["evidence"]}
    entities = {e["id"]: e for e in state["entities"]}
    paths = {key: entity_path(e) for key, e in entities.items()}
    docs = {}
    for key, entity in entities.items():
        path = paths[key]
        body = f"Confidence: **{entity['confidence']}**. Citation checks establish source identity, not semantic truth.\n\n"
        if entity.get("stale") or entity.get("conflict"):
            body += "**Unresolved:** the following is a historical interpretation, withheld from established facts until source review.\n\n"
        body += escape(entity["summary"]) + "\n\n## Evidence\n\n"
        body += "\n".join(f"- {source_link(path, output, refs[r])} (`{r}`)" for r in entity["evidence"] if r in refs) or "No supporting evidence; this is an open question."
        body += "\n\n## Relationships and change map\n\n"
        related = [r for r in state["relations"] if key in (r["source"], r["target"])]
        for r in related:
            other = r["target"] if r["source"] == key else r["source"]
            target = os.path.relpath(paths[other], str(Path(path).parent))
            direction = "outgoing" if r["source"] == key else "incoming"
            body += f"- {direction} `{r['kind']}` [{escape(entities[other]['title'])}]({quote(target, safe='/')}) — {r['confidence']}"
            body += "; " + ", ".join(source_link(path, output, refs[e]) for e in r["evidence"] if e in refs) + "\n"
        if not related:
            body += "No verified cross-layer relationships recorded. Investigate the cited implementation before changing behavior.\n"
        if entity.get("details") and isinstance(entity["details"], dict):
            body += "\n## Investigation notes (same confidence as this entity)\n\n"
            for label, detail in entity["details"].items():
                body += f"- **{escape(label)}:** {escape(detail)}\n"
        if entity.get("search_terms"):
            body += "\n## Search vocabulary\n\n" + ", ".join(escape(t) for t in entity["search_terms"]) + "\n"
        occurrences = [e for e in entities.values() if e.get("occurrence", {}).get("concept") == key]
        if entity["kind"] in ("concept", "feature", "setting"):
            body += "\n## Occurrence inventory and supported variants\n\n"
            for occurrence in occurrences:
                surface = occurrence["occurrence"]["surface"]
                relative = os.path.relpath(paths[occurrence["id"]], str(Path(path).parent))
                surface_path = os.path.relpath(paths[surface], str(Path(path).parent))
                body += (f"- [{escape(occurrence['title'])}]({quote(relative, safe='/')}) on "
                         f"[{escape(entities[surface]['title'])}]({quote(surface_path, safe='/')}) — "
                         f"{escape(', '.join(occurrence['occurrence']['conditions']) or 'unconditional static variant')}; "
                         f"{occurrence['confidence']}; {'stale' if occurrence.get('stale') else 'source-bound'}\n")
            if not occurrences:
                body += "No confirmed occurrence inventory yet; this is not evidence of absence.\n"
            body += "\nPrimary surfaces (`primary_surface`) and canonical implementations (`implemented_by`) are distinct relationships above.\n"
        if entity.get("occurrence"):
            occurrence = entity["occurrence"]
            body += "\n## Stable occurrence anchor\n\n" + escape(occurrence["anchor"]) + "\n\n"
            for label in ("concept", "surface"):
                other = occurrence[label]
                relative = os.path.relpath(paths[other], str(Path(path).parent))
                body += f"- {label}: [{escape(entities[other]['title'])}]({quote(relative, safe='/')})\n"
            body += "\nConditions: " + escape(", ".join(occurrence["conditions"]) or "unconditional static variant") + "\n"
        matching_scopes = [scope for scope in state.get("change_scopes", {}).values()
                           if key in scope["resolution"]["entities"] or key in scope["resolution"]["required_anchors"]]
        if matching_scopes:
            body += "\n## Change checklist\n\n"
            for scope in matching_scopes:
                relative = os.path.relpath("changes/" + scope["id"] + ".md", str(Path(path).parent))
                body += f"- [{escape(scope['request']['topic'])}]({relative}) — preserve and account for every baseline/target obligation.\n"
        docs[path] = page(entity["title"], body, entity)
    index = (f"Reconstructed source commit: `{inv['commit']}`. Snapshot: `{state['plan']['snapshot']}`.\n\n"
             "This is an evidence index and semantic model, not a guarantee of correctness. Verify source before implementation.\n\n"
             "## Start here\n\n- [Overview](overview.md)\n- [Coverage and gaps](knowledge-gaps.md)\n"
             "- [Agent readiness](agent/readiness.md)\n- [Instruction map](agent/instruction-map.md)\n"
             "- [Build, test and run](operations/build-test-run.md)\n\n## Concepts\n\n")
    index += "\n".join(f"- [{escape(e['title'])}]({paths[e['id']]}) — {e['kind']}, {e['confidence']}" for e in entities.values()) or "Native investigation pending; no product features have been asserted."
    if state.get("change_scopes"):
        index += "\n\n## Change coverage\n\n" + "\n".join(
            f"- [{escape(scope['request']['topic'])}](changes/{scope['id']}.md)" for scope in state["change_scopes"].values())
    docs["README.md"] = page("Codebase Spec", index)
    docs["overview.md"] = page("Repository overview", f"Scanned {len(inv['files'])} text files ({inv['bytes_read']} bytes).\n\n"
                              + "Languages by file extension: " + escape(json.dumps(inv["languages"]))
                              + ". Framework and behavioral interpretations require native source review.\n\n"
                              + f"Graphify: {state['graph']['status']}. {escape(state['graph'].get('warning', ''))}\n\n"
                              + "See `_meta/inventory.json` for manifests, candidates, evidence and scan exclusions.")
    pending = sum(t["status"] != "accepted" for t in state["plan"]["tasks"])
    gaps = f"Pending specialist tasks: {pending}. Deferred scopes: {len(state['plan']['deferred'])}. Skipped files: {len(inv['skipped'])}.\n\n"
    for gap in state["gaps"]:
        gaps += f"## {gap['id']}\n\n{escape(gap['question'])}\n\nNext step: {escape(gap['next_step'])}\n\n"
    gaps += "Full skipped paths and deferred scopes are in `_meta/inventory.json` and `_meta/plan.json`. Missing coverage is not evidence of absent functionality.\n"
    docs["knowledge-gaps.md"] = page("Knowledge gaps and coverage", gaps)
    issues = "\n".join(f"- {escape(i['path'] or 'Repository')}: {escape(i['issue'])} ({i['confidence']})" for i in state["audit"]["issues"])
    docs["agent/readiness.md"] = page("Agent readiness", issues + "\n\n" + "\n".join(state["audit"]["limitations"]))
    docs["agent/instruction-map.md"] = page("Instruction map", "\n".join(
        f"- `{escape(i['path'])}` — scope `{escape(i['scope'])}`, {i['bytes']} bytes, override={i['override']}"
        for i in state["audit"]["instructions"]) or "No instruction files located within scan scope.")
    manifests = [p for p, v in inv["files"].items() if v["manifest"]]
    docs["operations/build-test-run.md"] = page("Build, test and run", "Commands are not executed during reconstruction. Read and validate repository instructions before running them.\n\nManifest candidates:\n\n" + "\n".join(f"- `{escape(p)}`" for p in manifests))
    docs["glossary.md"] = page("Glossary", "\n".join(f"- **{escape(e['title'])}** (`{e['id']}`): {escape(e['summary'])} [{e['confidence']}]" for e in entities.values()) or "Concept vocabulary awaits native investigation.")
    from ..ontology import stable_id
    for source in inv["files"]:
        supported = [e for e in entities.values() if any(refs[r]["path"] == source for r in e["evidence"] if r in refs)]
        relations = [r for r in state["relations"] if any(refs[e]["path"] == source for e in r["evidence"] if e in refs)]
        if not supported and not relations:
            continue
        code_path = "code/" + stable_id("source", source) + ".md"
        body = "Source-backed associations; source inventory alone does not establish behavior.\n\n"
        for entity in supported:
            link = os.path.relpath(paths[entity["id"]], "code")
            body += f"- [{escape(entity['title'])}]({quote(link, safe='/')}) — {entity['kind']}, {entity['confidence']}\n"
            # Bidirectional navigation without changing the source file itself.
            entity_doc = docs[paths[entity["id"]]]
            backlink = os.path.relpath(code_path, str(Path(paths[entity["id"]]).parent))
            docs[paths[entity["id"]]] = entity_doc.replace(END, f"\nSource index: [{escape(source)}]({backlink})\n" + END)
        for relation in relations:
            body += f"- Relation `{relation['kind']}`: `{relation['source']}` → `{relation['target']}`; {relation['confidence']}\n"
        docs[code_path] = page(source, body)
    from ..coverage import assess
    for scope in state.get("change_scopes", {}).values():
        report = assess(scope, state, inv)
        body = (escape(report["summary"]) + f"\n\nBaseline: `{scope['baseline']['id']}`. Target: `{scope['target']['id']}`.\n\n"
                "## Acceptance standard\n\n")
        for criterion in scope["request"]["standard"]["criteria"]:
            body += f"- `{criterion['id']}`: {escape(criterion['description'])} ({criterion['verification']})\n"
        if not scope["request"]["standard"]["criteria"]:
            body += "Unresolved requirements: no concrete standard supplied.\n"
        body += "\n## Coverage axes\n\n"
        for axis in ("inventory_coverage", "investigation_coverage", "discovery_coverage", "occurrence_accounting", "behavioral_verification"):
            body += f"- `{axis}`: **{report[axis]['status']}**\n"
        body += "\n## Occurrences and mandatory inspection anchors\n\n| Obligation | Kind | Surface | Disposition |\n| --- | --- | --- | --- |\n"
        for key, obligation in scope["obligations"].items():
            disposition = scope["dispositions"].get(key, {})
            status = disposition.get("disposition", "unresolved")
            if disposition and disposition.get("revision") != scope["revision"]:
                status += " (invalidated)"
            body += f"| {escape(key)} | {obligation['kind']} | {escape(obligation['surface'])} | {escape(status)} |\n"
        body += "\n## Independent discovery roster\n\n"
        for key, candidate in scope["candidates"].items():
            review = scope["candidate_reviews"].get(key, {})
            status = review.get("status", "unresolved") if review.get("revision") == scope["revision"] else "unresolved / stale review"
            body += f"- `{escape(candidate['path'])}` — {escape(status)}\n"
        body += "\n## Unresolved frontiers\n\n"
        for item in report["discovery_coverage"]["frontier"]:
            body += f"- {escape(item['id'])}: {escape(item['reason'])}\n"
        body += f"\nFull provenance, review history, exclusions and current obligations: `../_meta/change-scopes/{scope['id']}/scope.json`.\n"
        body += "\nUnderstand Code executed no target-application tests. External execution evidence and static-only acceptance policy are explicit in the coverage report.\n"
        docs["changes/" + scope["id"] + ".md"] = page(scope["request"]["topic"], body)
    return docs


def write(output: Path, docs: dict[str, str], metadata: dict[str, str], manifest: dict) -> None:
    """Preflight all conflicts before any output mutation; preserve unmanaged files."""
    old = {}
    if output.exists():
        marker = output / "_meta/manifest.json"
        if not marker.is_file() or marker.is_symlink():
            raise ValueError("Output exists without an Understand Code manifest; choose a new output directory")
        old = json.loads(marker.read_text())
        if old.get("producer") != "understand-code":
            raise ValueError("Output is owned by another producer")
        for file in output.rglob("*"):
            if file.is_symlink():
                raise ValueError(f"Symlink in output: {file}")
        for path, expected in old.get("managed", {}).items():
            file = output / path
            if not file.is_file() or digest(generated(file.read_text())) != expected:
                raise ValueError(f"Generated region edited or removed: {path}. Preserve the edit as a maintainer note before regeneration.")
        for path, text in list(docs.items()):
            file = output / path
            if file.exists():
                if path not in old.get("managed", {}):
                    raise ValueError(f"Unmanaged document would be overwritten: {path}")
                prior = file.read_text()
                docs[path] = generated(text) + prior[prior.index(END) + len(END):]
        # Retired pages remain, explicitly retired. Human notes are never deleted.
        for path in set(old.get("managed", {})) - docs.keys():
            prior = (output / path).read_text()
            docs[path] = generated(page("Retired concept", "This concept is no longer in the current model. Consult Git history and maintainer notes; do not use it as current evidence.")) + prior[prior.index(END) + len(END):]
    manifest["managed"] = {path: digest(generated(text)) for path, text in docs.items()}
    manifest["metadata_hashes"] = {**old.get("metadata_hashes", {}), **{path: digest(text) for path, text in metadata.items()}}
    metadata["_meta/manifest.json"] = json_text(manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".understand-code-stage-", dir=output.parent))
    backup = output.parent / (stage.name + "-backup")
    try:
        if output.exists():
            shutil.copytree(output, stage, dirs_exist_ok=True)
        for path, text in {**docs, **metadata}.items():
            destination = stage / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists() and destination.read_text() == text:
                continue
            destination.write_text(text, encoding="utf-8")
        if output.exists():
            output.rename(backup)
        try:
            stage.rename(output)
        except BaseException:
            if backup.exists():
                backup.rename(output)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
