"""Conservative semantic blast-radius analysis, independent of lines changed."""


def analyze(old: dict, current: dict, entities: list[dict], relations: list[dict], evidence: list[dict],
            git_changes: list[dict] | None = None) -> dict:
    before, after = old.get("files", {}), current["files"]
    changed = sorted(p for p in set(before) | set(after) if before.get(p, {}).get("sha256") != after.get(p, {}).get("sha256"))
    # --base can point farther back than the previous scan. Include both sources of change.
    for item in git_changes or []:
        changed.extend(p for p in (item.get("path"), item.get("old_path")) if p and p not in changed)
    changed_set = set(changed)
    refs = {e["id"] for e in evidence if e["path"] in changed_set}
    affected = {e["id"] for e in entities if refs.intersection(e["evidence"])}
    for relation in relations:
        if refs.intersection(relation["evidence"]):
            affected.update((relation["source"], relation["target"]))
    # Both directions: dependencies and consumers need investigation, not automatic claims.
    while True:
        neighbors = {r[k] for r in relations if r["source"] in affected or r["target"] in affected
                     for k in ("source", "target")}
        if neighbors.issubset(affected):
            break
        affected |= neighbors
    signals = sorted({c["kind"] for c in current["candidates"] if c["path"] in changed_set and c["kind"] != "symbol"})
    return {"changed_files": sorted(changed_set), "affected_entities": sorted(affected),
            "significance": signals, "git_changes": git_changes or [],
            "new_files": sorted(set(after) - set(before)), "deleted_files": sorted(set(before) - set(after))}
