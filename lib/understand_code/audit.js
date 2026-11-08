/** Instruction observations and recommendations. This module never edits instructions. */
import fs from 'node:fs';
import path from 'node:path';
import { read_source } from './evidence.js';
export function audit(root, inventory) {
    const instructions = [];
    const issues = [];
    const texts = new Map();
    for (const [filename, value] of Object.entries(inventory.files)) {
        const info = value;
        if (!info.instruction)
            continue;
        const text = read_source(root, filename);
        texts.set(filename, text);
        instructions.push({ path: filename, bytes: info.bytes, evidence: info.evidence ?? null,
            scope: path.posix.dirname(filename), override: path.posix.basename(filename) === 'AGENTS.override.md' });
        if (info.bytes > 16_000)
            issues.push({ path: filename, confidence: 'EXTRACTED', issue: 'Instruction file exceeds 16 KiB; consider scoped references.' });
        const patterns = new Map([
            ['build/test guidance', /\b(test|pytest|unittest|build|check)\b/i],
            ['Git workflow', /\b(branch|commit|pull request|worktree)\b/i],
            ['architecture pointer', /codebase|architecture/i],
        ]);
        for (const [label, pattern] of patterns) {
            if (!pattern.test(text))
                issues.push({ path: filename, confidence: 'INFERRED', issue: `No ${label} keyword found; inspect before recommending additions.` });
        }
        for (const match of text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
            const link = match[1];
            if (!link.includes('://') && !/^(mailto:|#|\/)/.test(link)
                && !fs.existsSync(path.join(root, path.posix.dirname(filename), link))) {
                issues.push({ path: filename, confidence: 'EXTRACTED', issue: `Local link target is missing: ${link}` });
            }
        }
    }
    if (!instructions.length)
        issues.push({ path: null, confidence: 'UNKNOWN', issue: 'No supported instruction files found within the scanned scope.' });
    for (const [left, text] of texts) {
        for (const [right, other] of texts) {
            if (left < right && text.trim() && text.trim() === other.trim()) {
                issues.push({ path: left, confidence: 'EXTRACTED', issue: `Content duplicates ${right}.` });
            }
        }
    }
    return { instructions, issues, limitations: [
            'Keyword checks do not prove missing guidance or instruction conflicts.',
            'Resolve semantic conflicts with the instruction-auditor specialist.',
            'Read applicable ancestor and host-level instructions outside the scanned root manually.',
        ] };
}
