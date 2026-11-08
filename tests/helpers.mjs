/** Prepared offline fixtures only. These helpers never run fixture/application code. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { git, head } from '../lib/understand_code/git.js';
import { capture, read_source, split_lines } from '../lib/understand_code/evidence.js';
import { load, run } from '../lib/understand_code/orchestrator.js';
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const OUT = 'docs/codebase';
export const REVIEW = { status: 'source-reviewed', reviewer: 'prepared-fixture-reviewer', method: 'Prepared source contract; no inference or live application execution' };
export class EngineFixture {
  constructor(t, source = 'legacy') {
    this.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'understand-code-test-'));
    this.root = path.join(this.temp, 'repo');
    fs.cpSync(path.join(FIXTURES, source), this.root, { recursive: true });
    t.after(() => fs.rmSync(this.temp, { recursive: true, force: true }));
  }
  bootstrap(options = {}) { return this.run('bootstrap', options); }
  run(command, options = {}) {
    const { mode = 'standard', provider = 'codex', focus = null, base = null, finding_paths = [], max_files = 2000, max_bytes = 5_000_000, ...rest } = options;
    return run(this.root, OUT, command, mode, provider, focus, base, finding_paths, max_files, max_bytes, rest);
  }
  state() { return load(this.root, OUT); }
  read(filename) { return fs.readFileSync(path.join(this.root, filename), 'utf8'); }
  write(filename, content) { const file = path.join(this.root, filename); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; }
  prepared() {
    const task = this.state().plan.tasks.find(t => t.role === 'domain-discoverer');
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'prepared/checkout.json'), 'utf8'));
    const refs = ['checkout.py', 'settings.py', 'test_checkout.py'].map(p => capture(p, read_source(this.root, p), 1,
      split_lines(read_source(this.root, p)).length, head(this.root), p.startsWith('test_') ? 'test' : 'source'));
    return { schema_version: 1, task_id: task.id, snapshot: task.snapshot,
      entities: [{ ...fixture.entity, evidence: [refs[0].id, refs[2].id] }, { ...fixture.setting, evidence: [refs[1].id] }],
      relations: [{ ...fixture.relation, evidence: [refs[0].id, refs[1].id] }], evidence: refs, gaps: [fixture.gap], review: fixture.review };
  }
  apply(bundle) { const file = path.join(this.temp, 'response.json'); fs.writeFileSync(file, JSON.stringify(bundle)); return this.run('apply', { finding_paths: [file] }); }
  git(...args) { return git(this.root, ...args); }
  init_git() { this.git('init', '-b', 'main'); this.git('config', 'user.name', 'Fixture'); this.git('config', 'user.email', 'fixture@example.invalid'); this.git('add', '.'); this.git('commit', '-m', 'Add prepared legacy fixture'); }
}
export function snapshot_files(root) {
  const result = {};
  const walk = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) result[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
  } };
  walk(root); return result;
}
