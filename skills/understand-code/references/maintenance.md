# Maintenance and recovery

`update --base <revision>` combines Git's committed/staged/unstaged diff with file-hash changes since the last scan, including untracked files, renames and deletions. It finds concepts whose evidence changed and traverses semantic relationships in both directions. Related claims become UNKNOWN pending review; it does not rebind them to fresh source hashes. Route, settings, schema, event, permission, UI and integration candidates prioritize investigation independently of line counts.

`focus <term>` resolves known concept titles/IDs/summaries and paths plus immediate semantic neighbors. Unknown terms fail explicitly. Deferred scopes are visible in `_meta/plan.json`; use a focused run or a wider bootstrap to schedule them. Quick/standard/deep control scope budgets, not certainty. Raising scan budgets is explicit; excluded coverage stays visible.

`verify` returns exit 0 for mechanically current evidence and managed content, exit 1 for drift/integrity errors, exit 2 for invalid input. `--require-complete` additionally fails on pending/deferred tasks or skipped files. Passing does not establish that all repository behavior is understood; read gaps and reviewer records. `status` always reports freshness as well as coverage.

Generated blocks are protected by hashes in `_meta/manifest.json`. Write human knowledge after `<!-- understand-code:human -->`. Edits to generated blocks stop the whole write before replacement. Preserve corrections in maintainer notes and restore the old generated block from Git before regeneration. Unmanaged files are copied unchanged; retired concept pages retain their notes and an explicit retirement notice.

The writer stages the entire output beside the destination, then swaps directories, rolling back on ordinary rename failures. Do not run readers/writers concurrently during publication. A process kill between renames can leave `.understand-code-stage-*-backup` beside the output; inspect both copies, restore the backup if output is missing, then remove only the abandoned stage. A lock in the OS temporary directory contains the writer PID; remove it only after confirming that process is gone. The tool never commits recovery actions automatically.

Do not hand-edit `_meta` to bypass a failed check. Original accepted responses are archived by content hash under `_meta/findings`. Keep rejected response files for diagnosis. A changed claim with conflicting interpretation becomes a gap containing both alternatives; obtain reviewed replacement evidence rather than deleting the history.
