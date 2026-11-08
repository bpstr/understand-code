/** Offline command-line interface. No provider invocation or network transport. */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { __version__ } from './index.js';
import { audit } from './audit.js';
import { inventory } from './discovery.js';
import { capture, read_source, excluded } from './evidence.js';
import { head, isolate } from './git.js';
import { load, run } from './orchestrator.js';
import { verify } from './spec/verifier.js';
import { new_request, assess, validate_standard } from './coverage.js';
import { INTENTS } from './change_scope.js';
import { export_knowledge, write_export } from './exchange.js';
const COMMANDS = ['bootstrap', 'focus', 'update', 'verify', 'agent-audit', 'status', 'apply', 'evidence', 'scope', 'export-knowledge', 'import-knowledge'];
const MUTATIONS = ['bootstrap', 'focus', 'update', 'apply', 'scope', 'import-knowledge'];
const HELP = `Understand Code ${__version__}\nReconstruct an evidence-backed Codebase Spec with native Claude/Codex investigations.\n\nUsage: understand-code <command> [options]\nCommands: ${COMMANDS.join(', ')}\n\nCommon options:\n  --repo <path>       Repository root (default: .)\n  --output <path>     Dedicated output directory (default: docs/codebase)\n  --max-files <n>     File budget (default: 2000)\n  --max-bytes <n>     Byte budget (default: 5000000)\n  --help             Show command-specific options\n  --version          Show version\n\nEvery command is offline. Source and examples are never executed.\n`;
function option_definitions(command) {
    const result = {
        help: { type: 'boolean', short: 'h' }, repo: { type: 'string', default: '.' }, output: { type: 'string', default: 'docs/codebase' },
        'max-files': { type: 'string', default: '2000' }, 'max-bytes': { type: 'string', default: '5000000' },
    };
    const string = (name, value) => { result[name] = { type: 'string', ...(value !== undefined ? { default: value } : {}) }; };
    const flag = (name) => { result[name] = { type: 'boolean', default: false }; };
    const repeat = (name) => { result[name] = { type: 'string', multiple: true, default: [] }; };
    if (MUTATIONS.includes(command)) {
        string('mode', 'standard');
        string('provider', 'codex');
        repeat('findings');
    }
    if (['scope', 'apply', 'verify'].includes(command))
        string('change-scope');
    if (command === 'apply')
        repeat('ledger');
    if (['export-knowledge', 'import-knowledge'].includes(command))
        string('file');
    if (command === 'scope') {
        string('intent', 'cross_cutting');
        string('criteria');
        flag('amend-standard');
        repeat('example');
        repeat('boundary');
        repeat('exclude-path');
        string('max-depth', '8');
        string('max-nodes', '500');
    }
    if (command === 'bootstrap')
        string('write-mode', 'worktree');
    if (command === 'update')
        string('base');
    if (command === 'verify') {
        flag('require-complete');
        flag('require-doc-quality');
        flag('require-change-complete');
    }
    if (command === 'evidence') {
        string('start');
        string('end');
        string('kind', 'source');
    }
    return result;
}
export function parse_args(argv) {
    if (argv.length === 1 && argv[0] === '--version')
        return { version: true };
    if (!argv.length || ['--help', '-h'].includes(argv[0]))
        return { help: true };
    const command = argv[0];
    if (!COMMANDS.includes(command))
        throw new Error(`Unknown command: ${command}. Use --help for available commands.`);
    const parsed = parseArgs({ args: argv.slice(1), options: option_definitions(command), strict: true, allowPositionals: true });
    const args = { command, ...Object.fromEntries(Object.entries(parsed.values).map(([k, v]) => [k.replaceAll('-', '_'), v])) };
    if (args.help)
        return args;
    const permitsPosition = ['bootstrap', 'focus', 'scope', 'evidence'].includes(command);
    if (parsed.positionals.length > (permitsPosition ? 1 : 0))
        throw new Error('Unexpected positional arguments');
    if (['focus', 'evidence'].includes(command) && !parsed.positionals.length)
        throw new Error(`${command} requires a ${command === 'focus' ? 'topic' : 'path'}`);
    if (permitsPosition && parsed.positionals.length)
        args[['bootstrap', 'evidence'].includes(command) ? 'path' : 'topic'] = parsed.positionals[0];
    if (['export-knowledge', 'import-knowledge'].includes(command) && !args.file)
        throw new Error(`${command} requires --file`);
    if (command === 'evidence' && (args.start === undefined || args.end === undefined))
        throw new Error('evidence requires --start and --end');
    for (const key of ['max_files', 'max_bytes', 'max_depth', 'max_nodes', 'start', 'end'])
        if (args[key] !== undefined) {
            if (!/^-?\d+$/.test(args[key]) || !Number.isSafeInteger(Number(args[key])))
                throw new Error(`--${key.replaceAll('_', '-')} must be an integer`);
            args[key] = Number(args[key]);
        }
    for (const [key, values] of Object.entries({ mode: ['quick', 'standard', 'deep'], provider: ['codex', 'claude'], write_mode: ['worktree', 'local'],
        intent: INTENTS, kind: ['source', 'test', 'config', 'documentation', 'human'] }))
        if (args[key] !== undefined && !values.includes(args[key]))
            throw new Error(`Invalid --${key.replaceAll('_', '-')}: ${args[key]}`);
    return args;
}
export function parser() { return { parse_args }; }
export function main(argv = process.argv.slice(2)) {
    try {
        const args = parse_args(argv);
        if (args.version) {
            console.log(__version__);
            return 0;
        }
        if (args.help) {
            process.stdout.write(HELP);
            if (args.command) {
                console.log(`\n${args.command} options:`);
                for (const [name, opt] of Object.entries(option_definitions(args.command)))
                    console.log(`  --${name}${opt.type === 'string' ? ' <value>' : ''}${opt.multiple ? ' (repeatable)' : ''}${opt.default !== undefined ? ` (default: ${JSON.stringify(opt.default)})` : ''}`);
                const argument = args.command === 'bootstrap' ? '[path]' : args.command === 'scope' ? '[topic]' : args.command === 'focus' ? '<topic>' : args.command === 'evidence' ? '<path>' : '';
                if (argument)
                    console.log(`  Positional: ${argument}`);
            }
            return 0;
        }
        if (args.max_files < 1 || args.max_bytes < 1)
            throw new Error('Scan budgets must be positive');
        let root = path.resolve(args.command === 'bootstrap' && args.path ? args.path : args.repo);
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
            throw new Error('Repository directory does not exist');
        root = fs.realpathSync(root);
        if (args.command === 'bootstrap' && args.write_mode === 'worktree')
            root = isolate(root);
        if (args.command === 'verify' && args.require_change_complete && !args.change_scope)
            throw new Error('--require-change-complete requires --change-scope');
        let result;
        if (MUTATIONS.includes(args.command)) {
            let request = null;
            if (args.command === 'scope') {
                if (args.change_scope) {
                    if (args.topic || args.boundary.length || args.example.length || args.exclude_path.length || args.intent !== 'cross_cutting' || args.max_depth !== 8 || args.max_nodes !== 500)
                        throw new Error('Resume with --change-scope; do not silently replace its saved request');
                    if (Boolean(args.criteria) !== args.amend_standard)
                        throw new Error('A standard amendment requires both --criteria and --amend-standard');
                    if (args.criteria) {
                        const saved = load(root, args.output);
                        if (!saved?.change_scopes?.[args.change_scope])
                            throw new Error('Unknown change scope');
                        if (fs.statSync(args.criteria).size > 1_000_000)
                            throw new Error('Acceptance standard exceeds 1 MB');
                        request = structuredClone(saved.change_scopes[args.change_scope].request);
                        request.standard = JSON.parse(fs.readFileSync(args.criteria, 'utf8'));
                        validate_standard(request.standard);
                    }
                }
                else {
                    if (args.amend_standard)
                        throw new Error('--amend-standard requires --change-scope');
                    if (!args.topic)
                        throw new Error('New scope requires a topic');
                    let standard = null;
                    if (args.criteria) {
                        if (fs.statSync(args.criteria).size > 1_000_000)
                            throw new Error('Acceptance standard exceeds 1 MB');
                        standard = JSON.parse(fs.readFileSync(args.criteria, 'utf8'));
                    }
                    request = new_request(args.topic, args.intent, standard, { boundaries: args.boundary, examples: args.example,
                        exclusions: args.exclude_path, max_depth: args.max_depth, max_nodes: args.max_nodes });
                }
            }
            result = run(root, args.output, args.command, args.mode, args.provider, args.topic ?? null, args.base ?? null, args.findings, args.max_files, args.max_bytes, { change_request: request, change_scope: args.change_scope ?? null,
                ledger_paths: args.ledger ?? null, knowledge_path: args.command === 'import-knowledge' ? args.file : null, amend_standard: args.amend_standard ?? false });
        }
        else if (args.command === 'evidence') {
            if (excluded(args.path, args.output))
                throw new Error('Cannot cite generated output, secrets, or excluded paths');
            result = capture(args.path, read_source(root, args.path), args.start, args.end, head(root), args.kind);
        }
        else if (args.command === 'agent-audit')
            result = audit(root, inventory(root, args.output, args.max_files, args.max_bytes));
        else {
            const state = load(root, args.output);
            if (!state)
                throw new Error('No Codebase Spec exists. Run bootstrap first.');
            const current = inventory(root, args.output, args.max_files, args.max_bytes);
            if (args.command === 'export-knowledge') {
                const envelope = export_knowledge(state, current);
                write_export(args.file, envelope);
                console.log(JSON.stringify({ file: path.resolve(args.file), contract: 'change-knowledge', version: 1, entities: envelope.entities.length, occurrences: envelope.occurrences.length }));
                return 0;
            }
            const checks = verify(root, args.output, state, current);
            if (args.command === 'verify' && args.change_scope) {
                const scope = state.change_scopes?.[args.change_scope];
                if (!scope)
                    throw new Error('Unknown change scope');
                checks.change_coverage = assess(scope, state, current);
            }
            result = args.command === 'verify' ? checks : { manifest: state.manifest, verification: checks,
                tasks: state.plan.tasks.map((t) => ({ id: t.id, role: t.role, status: t.status })) };
            if (args.command === 'verify' && (!checks.ok || (args.require_complete && !checks.coverage_complete) ||
                (args.require_doc_quality && !checks.documentation_quality.ready) || (args.require_change_complete && !checks.change_coverage.change_complete))) {
                console.log(JSON.stringify(result, null, 2));
                return 1;
            }
        }
        console.log(JSON.stringify(result, null, 2));
        return 0;
    }
    catch (error) {
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return 2;
    }
}
