#!/usr/bin/env node
/** CI-only publication of the already tested commit and its exact release artifacts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(program, args, missingAllowed = false) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (missingAllowed && /HTTP 404/.test(result.stderr)) return null;
    throw new Error(`${program} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}
function api(endpoint, optional = false) {
  const result = run('gh', ['api', endpoint], optional);
  return result === null ? null : JSON.parse(result);
}
const context = process.env;
assert.equal(context.GITHUB_REF, 'refs/heads/main', 'Releases must run on main');
assert.ok(['push', 'workflow_dispatch'].includes(context.GITHUB_EVENT_NAME), 'Only a main push or explicit manual workflow may release');
assert.equal(context.GITHUB_REPOSITORY, 'bpstr/understand-code', 'Only the canonical repository may publish this release');
assert.match(context.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/);
assert.equal(run('git', ['rev-parse', 'HEAD']), context.GITHUB_SHA, 'Checkout must match the tested commit');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.match(version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'Use a stable semantic release version');
let previousVersion = null;
if (context.GITHUB_EVENT_NAME === 'push' && context.BEFORE_SHA && !/^0+$/.test(context.BEFORE_SHA)) {
  assert.match(context.BEFORE_SHA, /^[0-9a-f]{40}$/);
  run('git', ['rev-parse', '--verify', `${context.BEFORE_SHA}^{commit}`]);
  const previous = spawnSync('git', ['show', `${context.BEFORE_SHA}:package.json`], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  if (previous.error) throw previous.error;
  if (previous.status === 0) previousVersion = JSON.parse(previous.stdout).version;
  else if (!/does not exist|exists on disk, but not in/.test(previous.stderr)) throw new Error(previous.stderr.trim());
}
const candidate = context.GITHUB_EVENT_NAME === 'workflow_dispatch' ? context.PUBLISH_REQUESTED === 'true' : version !== previousVersion;
if (process.argv.includes('--candidate')) {
  assert.ok(context.GITHUB_OUTPUT, 'GitHub Actions output file is required');
  fs.appendFileSync(context.GITHUB_OUTPUT, `publish=${candidate}\nversion=${version}\n`);
  console.log(candidate ? `Release candidate: ${version}` : 'No version change; release skipped');
  process.exit(0);
}
assert.ok(candidate, 'This event does not authorize a release');
assert.ok(context.GH_TOKEN, 'Publication requires the CI job token');
const repo = context.GITHUB_REPOSITORY, sha = context.GITHUB_SHA, tag = `v${version}`;
const assets = [`understand-code-${version}-plugin.zip`, `understand-code-${version}-skill.zip`, `understand-code-${version}.tgz`].sort();
const checksumFile = path.join(ROOT, 'dist/SHA256SUMS');
const checksums = fs.readFileSync(checksumFile, 'utf8');
const lines = checksums.trim().split('\n');
assert.deepEqual(lines.map(line => line.slice(66)).sort(), assets, 'Release checksums must cover this version only');
for (const line of lines) {
  assert.match(line, /^[0-9a-f]{64}  [A-Za-z0-9.-]+$/);
  const file = path.join(ROOT, 'dist', line.slice(66));
  assert.ok(fs.lstatSync(file).isFile(), 'Release asset must be a regular file');
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), line.slice(0, 64), 'Release asset hash mismatch');
}
function tagCommit(ref) {
  let object = ref.object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = api(`repos/${repo}/git/tags/${object.sha}`).object;
  assert.equal(object.type, 'commit', 'Release tag must resolve to a commit');
  return object.sha;
}
const existingTag = api(`repos/${repo}/git/ref/tags/${tag}`, true);
if (existingTag) assert.equal(tagCommit(existingTag), sha, 'Existing tag targets another commit; never move a release tag');
const existingRelease = api(`repos/${repo}/releases/tags/${tag}`, true);
if (existingRelease) {
  assert.ok(existingTag && !existingRelease.draft, 'An incomplete release needs explicit recovery; it will not be overwritten');
  assert.deepEqual(existingRelease.assets.map(asset => asset.name).sort(), [...assets, 'SHA256SUMS'].sort());
  assert.equal(run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', 'SHA256SUMS', '--output', '-']), checksums.trim(), 'Published checksums differ; never overwrite a release');
  console.log(`Release already published at the exact tested commit: ${existingRelease.html_url}`);
  process.exit(0);
}
const notes = fs.readFileSync(path.join(ROOT, `docs/releases/${tag}.md`), 'utf8');
assert.match(context.GITHUB_RUN_ID ?? '', /^[0-9]+$/);
const notesFile = path.join(ROOT, 'dist/RELEASE_NOTES.md');
fs.writeFileSync(notesFile, `${notes.trim()}\n\nValidated commit: ${sha}\n\n[Validation run](https://github.com/${repo}/actions/runs/${context.GITHUB_RUN_ID}).\n`);
run('gh', ['release', 'create', tag, '--repo', repo, '--target', sha, '--title', `Understand Code ${version}`,
  '--notes-file', notesFile, '--latest', ...(existingTag ? ['--verify-tag'] : []),
  ...[...assets, 'SHA256SUMS'].map(name => path.join(ROOT, 'dist', name))]);
assert.equal(tagCommit(api(`repos/${repo}/git/ref/tags/${tag}`)), sha);
const published = api(`repos/${repo}/releases/tags/${tag}`);
assert.equal(published.draft, false);
assert.deepEqual(published.assets.map(asset => asset.name).sort(), [...assets, 'SHA256SUMS'].sort());
console.log(`Published ${published.html_url} at ${sha}`);
