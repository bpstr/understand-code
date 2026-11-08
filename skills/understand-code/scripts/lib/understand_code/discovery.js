/** Bounded language-neutral inventory. Pattern matches are candidates, never behavior. */
import fs from 'node:fs';
import path from 'node:path';
import * as evidence from './evidence.js';
import { files, head } from './git.js';
import { compare_text } from './ontology.js';
export const LANGUAGES = { '.py': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP', '.java': 'Java', '.cs': 'C#', '.swift': 'Swift', '.kt': 'Kotlin',
    '.vue': 'Vue', '.svelte': 'Svelte', '.sql': 'SQL', '.sh': 'Shell' };
export const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile',
    'pom.xml', 'build.gradle', 'Makefile', 'Dockerfile', 'docker-compose.yml', 'compose.yml']);
export const INSTRUCTIONS = new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', 'copilot-instructions.md']);
export const PATTERNS = {
    entrypoint: /(?:@\w+\.(?:get|post|put|patch|delete|route)\(|\b(?:app|router)\.(?:get|post|put|patch|delete)\(|\b(?:webhook|urlpatterns|APIRouter|createServer)\b|__name__\s*==)/,
    setting: /\b(?:getenv|environ|process\.env|featureFlag|feature_flag|settings|config)\b/,
    data_entity: /\b(?:CREATE TABLE|class \w+\([^)]*Model|model \w+\s*\{|schema|migration)\b/,
    ui_surface: /(?:\b(?:function [A-Z]\w*|(?:const|let) [A-Z]\w*|useState|useStore|createRouter|createBrowserRouter)\b|<(?:template|form|Route)\b|\b(?:path|element|Component)\s*:)/,
    event: /\b(?:emit|publish|subscribe|enqueue|consumer|dispatch|queue)\s*\(/,
    permission: /\b(?:permission|authorize|isAdmin|hasRole|requireAuth|check_access)\b/,
    external_system: /\b(?:fetch|requests\.(?:get|post)|axios|https?:\/\/|stripe|boto3)\b/,
    test_behavior: /\b(?:def test_|test\(|it\(|describe\(|assert\b)/,
};
function glob_match(value, pattern) {
    // Python fnmatch-style globs: '*' may cross directory separators. No shell use.
    let expression = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '*')
            expression += '.*';
        else if (c === '?')
            expression += '.';
        else if (c === '[') {
            let start = i + 1;
            if (pattern[start] === '!')
                start++;
            // A closing bracket is literal when it is the first class character.
            if (pattern[start] === ']')
                start++;
            const end = pattern.indexOf(']', start);
            if (end >= start) {
                const body = pattern.slice(i + 1, end), negative = body.startsWith('!');
                const characters = (negative ? body.slice(1) : body).replace(/[\\\[\]\^]/g, '\\$&');
                expression += '[' + (negative ? '^' : '') + characters + ']';
                i = end;
            }
            else
                expression += '\\[';
        }
        else
            expression += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
    try {
        return new RegExp('^' + expression + '(?![\\s\\S])', 'su').test(value);
    }
    catch {
        return value === pattern;
    }
}
export function inventory(root, output, max_files = 2000, max_bytes = 5_000_000) {
    let names = files(root);
    if (names === null) {
        names = [];
        const walk = (directory) => {
            const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare_text(a.name, b.name));
            for (const entry of entries) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory() && !evidence.EXCLUDED.has(entry.name))
                    walk(file);
                else if (!entry.isDirectory())
                    names.push(path.relative(root, file).split(path.sep).join('/'));
            }
        };
        walk(root);
    }
    let ignores = [];
    const ignoreFile = path.join(root, '.understand-codeignore');
    if (fs.existsSync(ignoreFile) && !fs.lstatSync(ignoreFile).isSymbolicLink() && fs.statSync(ignoreFile).isFile())
        ignores = evidence.split_lines(evidence.read_source(root, '.understand-codeignore')).filter(s => s.trim() && !s.startsWith('#')).map(s => s.trim());
    // Repository filenames are arbitrary strings, including Object prototype keys.
    const records = Object.create(null), refs = Object.create(null), languages = Object.create(null);
    const skipped = [], candidates = [], ignored = [], deleted = [], limitations = [], analysis_notes = [];
    const commit = head(root);
    let total = 0, count = 0;
    for (const filename of names.sort(compare_text)) {
        if (evidence.excluded(filename, output))
            continue;
        if (ignores.some(pattern => glob_match(filename, pattern))) {
            ignored.push({ path: filename, reason: 'repository ignore rule' });
            continue;
        }
        if (count >= max_files) {
            skipped.push({ path: filename, reason: 'file budget' });
            continue;
        }
        let text;
        try {
            text = evidence.read_source(root, filename);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                deleted.push(filename);
            else
                skipped.push({ path: filename, reason: error.name });
            continue;
        }
        const size = Buffer.byteLength(text, 'utf8');
        if (total + size > max_bytes) {
            skipped.push({ path: filename, reason: 'byte budget' });
            continue;
        }
        total += size;
        count++;
        const ext = path.posix.extname(filename), name = path.posix.basename(filename), parts = filename.split('/');
        const lines = evidence.split_lines(text);
        let kind = parts.includes('test') || parts.includes('tests') || name.startsWith('test_') || name.includes('.test.') || name.includes('.spec.') ? 'test' : 'source';
        if (ext === '.md')
            kind = 'documentation';
        if (MANIFESTS.has(name) || ['.json', '.toml', '.yaml', '.yml'].includes(ext))
            kind = 'config';
        records[filename] = { sha256: evidence.source_hash(text), bytes: size, lines: lines.length, kind,
            language: LANGUAGES[ext] ?? null, manifest: MANIFESTS.has(name), instruction: INSTRUCTIONS.has(name) || parts.includes('.cursor') };
        if (LANGUAGES[ext])
            languages[LANGUAGES[ext]] = (languages[LANGUAGES[ext]] ?? 0) + 1;
        if (lines.length) {
            const ref = evidence.capture(filename, text, 1, Math.min(8, lines.length), commit, kind);
            refs[ref.id] = ref;
            records[filename].evidence = ref.id;
        }
        for (const [index, line] of lines.entries()) {
            if (!LANGUAGES[ext] && !MANIFESTS.has(name))
                continue;
            for (const [category, pattern] of Object.entries(PATTERNS)) {
                if (!pattern.test(line))
                    continue;
                const ref = evidence.capture(filename, text, index + 1, index + 1, commit, kind);
                refs[ref.id] = ref;
                candidates.push({ kind: category, path: filename, line: index + 1, evidence: ref.id, confidence: 'INFERRED' });
            }
            if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte'].includes(ext)) {
                for (const match of line.matchAll(/<[A-Z][\w.]*\b|\b(?:import|export)\s+[^;]+\bfrom\s*['"]/g)) {
                    const ref = evidence.capture(filename, text, index + 1, index + 1, commit, kind);
                    refs[ref.id] = ref;
                    candidates.push({ kind: 'composition', path: filename, line: index + 1, column: match.index + 1, name: match[0], evidence: ref.id, confidence: 'INFERRED' });
                }
                if (/\bimport\s*\(|\b(?:React\.)?createElement\s*\(|\b(?:eval|new Function)\s*\(/.test(line))
                    limitations.push({ path: filename, reason: `dynamic binding at line ${index + 1}; static roster cannot resolve it` });
            }
            if (ext === '.py') {
                const declaration = /^\s*(?:(?:async\s+)?def|class)\s+([A-Za-z_]\w*)\b/.exec(line);
                if (declaration) {
                    const ref = evidence.capture(filename, text, index + 1, index + 1, commit, kind);
                    refs[ref.id] = ref;
                    candidates.push({ kind: 'symbol', name: declaration[1], path: filename, line: index + 1, evidence: ref.id, confidence: 'INFERRED' });
                }
            }
        }
        if (ext === '.py')
            analysis_notes.push({ path: filename, reason: 'Python declarations are lexical candidates; no Python runtime or AST parser is invoked. Native source review is required.' });
    }
    return { commit, files: records, languages, candidates, evidence: Object.values(refs), skipped, bytes_read: total,
        ignored, deleted, limitations, analysis_notes, discovery_policy: 'surface-roster-v1', limits: { max_files, max_bytes } };
}
