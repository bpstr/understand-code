"""Consume Graphify node-link exports without launching extraction or inference.

The semantic export is a sidecar. It never overwrites Graphify's source graph.
"""
import json
from pathlib import Path

from .evidence import safe_path
from .ontology import digest


def load(root: Path, path: str = "graphify-out/graph.json") -> dict:
    source = safe_path(root, path)
    if not source.exists():
        return {"status": "unavailable", "nodes": [], "links": [], "path": path,
                "warning": "Graphify export unavailable; native graph tools or scoped source inspection are required."}
    if source.stat().st_size > 30_000_000:
        raise ValueError("Graphify export exceeds the 30 MB import limit")
    raw = source.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        raise ValueError("Expected Graphify node-link JSON with a nodes array")
    links = data.get("links", data.get("edges", []))
    if not isinstance(links, list) or any(not isinstance(n, dict) or "id" not in n for n in data["nodes"]):
        raise ValueError("Invalid Graphify nodes or links")
    if any(not isinstance(e, dict) or "source" not in e or "target" not in e for e in links):
        raise ValueError("Invalid Graphify edge endpoints")
    # Imported graph edges guide retrieval only. Their freshness/causality is not assumed.
    return {"status": "imported-unverified", "path": path, "sha256": digest(raw),
            "nodes": data["nodes"], "links": links,
            "warning": "Graph edges are retrieval hints; verify every selected relationship against current source."}


def context(graph: dict, paths: list[str], limit: int = 80) -> dict:
    paths_set = set(paths)
    nodes = [n for n in graph["nodes"] if n.get("file", n.get("source_file", n.get("path"))) in paths_set][:limit]
    ids = {str(n["id"]) for n in nodes}
    links = [e for e in graph["links"] if str(e["source"]) in ids or str(e["target"]) in ids][:limit]
    return {"nodes": nodes, "links": links, "confidence": "UNVERIFIED_RETRIEVAL_HINTS"}


def export(entities: list[dict], relations: list[dict]) -> dict:
    return {"directed": True, "multigraph": True,
            "graph": {"producer": "understand-code", "schema_version": 1,
                      "purpose": "semantic sidecar; merge through a compatible graph consumer"},
            "nodes": [{**e, "label": e["title"], "type": e["kind"]} for e in entities],
            "links": [{**r, "relation": r["kind"]} for r in relations]}
