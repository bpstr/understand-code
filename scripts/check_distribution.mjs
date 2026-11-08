#!/usr/bin/env node
/** Offline package, schema, link, skill and self-contained runner validation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { walkFiles } from './archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
const errors = [];
const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build_bundle.mjs'), '--check'], {
  cwd: ROOT, encoding: 'utf8', timeout: 120_000,
});
if (built.error || built.status !== 0) {
  console.error(built.error?.message ?? built.stderr ?? built.stdout);
  process.exit(1);
}
const { __version__ } = await import('../lib/understand_code/index.js');
const { KINDS, RELATIONS } = await import('../lib/understand_code/ontology.js');
for (const directory of ['.codex-plugin', '.claude-plugin']) {
  const data = read(`${directory}/plugin.json`);
  if (data.name !== 'understand-code' || data.version !== __version__) errors.push(`Version/name mismatch: ${directory}`);
  if (!fs.statSync(path.join(ROOT, data.skills)).isDirectory()) errors.push(`Missing skill directory: ${directory}`);
}
const pkg = read('package.json'), lock = read('package-lock.json');
if (pkg.name !== 'understand-code' || pkg.version !== __version__ || lock.version !== __version__ ||
    lock.packages[''].version !== __version__) errors.push('Node package/lock version mismatch');
if (pkg.type !== 'module' || pkg.engines?.node !== '>=22') errors.push('Package must be ESM on Node.js 22 or newer');
if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.optionalDependencies ?? {}).length) errors.push('Unexpected runtime dependency');
if (read('.claude-plugin/marketplace.json').plugins[0].version !== __version__) errors.push('Claude marketplace version mismatch');
for (const [name, vocabulary] of [['entity', KINDS], ['relation', RELATIONS]]) {
  try { assert.deepEqual(read(`schemas/${name}.schema.json`).properties.kind.enum, [...vocabulary]); }
  catch { errors.push(`Schema vocabulary mismatch: ${name}`); }
}
const document = read('schemas/documentation.schema.json'), entity = read('schemas/entity.schema.json'), finding = read('schemas/finding.schema.json');
try { assert.deepEqual(entity.properties.documentation.items, document); }
catch { errors.push('Embedded documentation contract differs from canonical schema'); }
try { assert.deepEqual(finding.properties.entities.items, entity); }
catch { errors.push('Embedded entity contract differs from canonical schema'); }
for (const directory of ['src', 'lib', 'scripts', 'skills']) {
  for (const file of walkFiles(path.join(ROOT, directory))) {
    if (/\.py[co]?$/.test(file)) errors.push(`Python runtime/build file remains: ${path.relative(ROOT, file)}`);
  }
}
if (fs.existsSync(path.join(ROOT, 'pyproject.toml'))) errors.push('Obsolete Python package metadata remains');
for (const directory of ['skills', 'docs']) {
  for (const file of walkFiles(path.join(ROOT, directory)).filter(file => file.endsWith('.md'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#', 1)[0];
      if (target && !/^[a-z][a-z+.-]*:/i.test(target) && !fs.existsSync(path.resolve(path.dirname(file), target))) {
        errors.push(`Broken link ${path.relative(ROOT, file)} → ${target}`);
      }
    }
  }
}
const skill = fs.readFileSync(path.join(ROOT, 'skills/understand-code/SKILL.md'), 'utf8');
if (!/^---\nname: understand-code\ndescription: .+\n/m.test(skill)) errors.push('Skill needs a valid name and description frontmatter');
if (skill.split('\n').length > 500) errors.push('Skill should keep its main instructions under 500 lines');
for (const runner of ['bin/understand-code.mjs', 'skills/understand-code/scripts/run.mjs']) {
  const result = spawnSync(process.execPath, [path.join(ROOT, runner), '--version'], {
    cwd: path.dirname(ROOT), encoding: 'utf8', timeout: 30_000,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== __version__) errors.push(`Entrypoint failed outside repository: ${runner}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Distribution valid: ${__version__}, ${KINDS.length} entity kinds, ${RELATIONS.length} relation kinds; no Python runtime`);
