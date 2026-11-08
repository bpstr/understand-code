#!/usr/bin/env node
/** Build versioned local archives/checksums. Publishing belongs to the validated CI release job. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createZip, readZip, walkFiles } from './archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const destination = path.join(ROOT, 'dist');
const checked = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check_distribution.mjs')], { cwd: ROOT, stdio: 'inherit', timeout: 120_000 });
if (checked.error) throw checked.error;
if (checked.status !== 0) throw new Error('Distribution validation failed; no release archives written');
fs.mkdirSync(destination, { recursive: true });
const entries = ['.codex-plugin', '.claude-plugin', '.agents', 'skills', 'agents', 'docs'].flatMap(root =>
  walkFiles(path.join(ROOT, root)).map(file => ({ name: path.relative(ROOT, file).split(path.sep).join('/'), data: fs.readFileSync(file) })));
for (const name of ['README.md', 'INSTALL.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
  entries.push({ name, data: fs.readFileSync(path.join(ROOT, name)) });
}
const plugin = `understand-code-${pkg.version}-plugin.zip`, skill = `understand-code-${pkg.version}-skill.zip`;
for (const [name, content] of [[plugin, entries], [skill, [
  ...entries.filter(entry => entry.name.startsWith('skills/')).map(entry => ({ ...entry, name: entry.name.slice('skills/'.length) })),
  { name: 'understand-code/LICENSE', data: fs.readFileSync(path.join(ROOT, 'LICENSE')) },
]]]) {
  const archive = createZip(content);
  // Validate CRCs and every entry before writing an artifact; fixed metadata also makes rebuilds reproducible.
  readZip(archive);
  fs.writeFileSync(path.join(destination, name), archive);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
  cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
});
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
const packageName = JSON.parse(packed.stdout)[0].filename;
if (packageName !== `understand-code-${pkg.version}.tgz`) throw new Error('Unexpected npm package filename');
const names = [plugin, skill, packageName].sort();
fs.writeFileSync(path.join(destination, 'SHA256SUMS'), names.map(name =>
  `${createHash('sha256').update(fs.readFileSync(path.join(destination, name))).digest('hex')}  ${name}\n`).join(''));
console.log([...names, 'SHA256SUMS'].map(name => path.join(destination, name)).join('\n'));
