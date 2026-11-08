#!/usr/bin/env node
/** Exercise exact release packages using prepared fixtures and a PATH with no Python. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractEntries, readZip, readTarGz, walkFiles } from './archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'understand-code-artifacts-'));
const artifactNames = [`understand-code-${version}-plugin.zip`, `understand-code-${version}-skill.zip`, `understand-code-${version}.tgz`].sort();
function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.resolve(directory, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* try the next entry */ }
  }
  throw new Error(`Required build tool missing: ${name}`);
}
const tools = path.join(temporary, 'tools');
fs.mkdirSync(tools);
for (const [name, target] of [['node', process.execPath], ['git', executable('git')]]) fs.symlinkSync(target, path.join(tools, name));
// No inherited credentials, provider configuration, preload hooks, or Python executable are available to the CLI.
const environment = {
  PATH: tools, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
  GIT_AUTHOR_NAME: 'Prepared fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Prepared fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  npm_config_userconfig: os.devNull, npm_config_cache: path.join(temporary, 'npm-cache'),
};
function command(program, args, cwd, expected = 0) {
  const result = spawnSync(program, args, { cwd, env: environment, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${program} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function exercise(name, entrypoint, base) {
  const fixture = path.join(temporary, `fixture-${name}`);
  fs.cpSync(path.join(ROOT, 'tests/fixtures/legacy'), fixture, { recursive: true });
  command('git', ['init', '--quiet'], fixture);
  command('git', ['add', '.'], fixture);
  command('git', ['commit', '--quiet', '-m', 'Prepare offline artifact fixture'], fixture);
  assert.equal(command(process.execPath, [entrypoint, '--version'], temporary).trim(), version);
  assert.match(command(process.execPath, [entrypoint, '--help'], temporary), /bootstrap/);
  const finding = JSON.parse(fs.readFileSync(path.join(base, 'resources/finding.schema.json'), 'utf8'));
  assert.ok(finding.required.includes('evidence'), `${name}: packaged evidence contract missing`);
  command(process.execPath, [entrypoint, 'bootstrap', fixture, '--write-mode', 'local', '--output', 'docs/spec'], temporary);
  const checks = JSON.parse(command(process.execPath, [entrypoint, 'verify', '--repo', fixture, '--output', 'docs/spec'], temporary));
  assert.equal(checks.ok, true);
  assert.equal(checks.documentation_quality.ready, false);
  command(process.execPath, [entrypoint, 'verify', '--repo', fixture, '--output', 'docs/spec', '--require-doc-quality'], temporary, 1);
  const status = JSON.parse(command(process.execPath, [entrypoint, 'status', '--repo', fixture, '--output', 'docs/spec'], temporary));
  assert.equal(status.verification.ok, true);
}
try {
  const sums = fs.readFileSync(path.join(ROOT, 'dist/SHA256SUMS'), 'utf8').trim().split('\n');
  assert.deepEqual(sums.map(line => line.slice(66)).sort(), artifactNames, 'Checksums must cover exactly this version’s artifacts');
  for (const line of sums) {
    assert.match(line, /^[0-9a-f]{64}  [A-Za-z0-9.-]+$/);
    const name = line.slice(66), archive = fs.readFileSync(path.join(ROOT, 'dist', name));
    assert.equal(createHash('sha256').update(archive).digest('hex'), line.slice(0, 64), `${name}: SHA-256 mismatch`);
    const entries = name.endsWith('.zip') ? readZip(archive) : readTarGz(archive);
    assert.ok(entries.length > 20, `${name}: incomplete archive`);
    assert.ok(entries.every(entry => !/\.py[co]?$/.test(entry.name) && !entry.name.split('/').includes('node_modules')), `${name}: unexpected Python/dependency payload`);
    const target = path.join(temporary, name);
    extractEntries(entries, target);
    if (name.endsWith('-skill.zip')) {
      const root = path.join(target, 'understand-code');
      exercise('skill', path.join(root, 'scripts/run.mjs'), path.join(root, 'scripts/lib/understand_code'));
    } else if (name.endsWith('-plugin.zip')) {
      const root = path.join(target, 'skills/understand-code');
      assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.codex-plugin/plugin.json'), 'utf8')).version, version);
      exercise('plugin', path.join(root, 'scripts/run.mjs'), path.join(root, 'scripts/lib/understand_code'));
    } else {
      const root = path.join(target, 'package');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, version);
      assert.ok(walkFiles(path.join(root, 'lib')).some(file => file.endsWith('.d.ts')), 'TypeScript declarations missing from npm package');
      exercise('package', path.join(root, 'bin/understand-code.mjs'), path.join(root, 'lib/understand_code'));
      const npmCli = process.env.npm_execpath ?? fs.realpathSync(executable('npm'));
      const installed = path.join(temporary, 'installed');
      command(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--package-lock=false', '--prefix', installed, path.join(ROOT, 'dist', name)], temporary);
      const packageRoot = path.join(installed, 'node_modules/understand-code');
      exercise('installed', path.join(packageRoot, 'bin/understand-code.mjs'), path.join(packageRoot, 'lib/understand_code'));
    }
  }
  console.log('Released plugin, standalone skill, npm package and offline npm install passed fixture bootstrap/verify with no Python on PATH; no provider calls');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
