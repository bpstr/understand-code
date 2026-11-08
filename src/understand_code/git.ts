/** Git commands use literal argument arrays, no shell and no application process. */
import childProcess from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compare_text } from './ontology.js';
type Options = { optional?: boolean };
export function git(root: string, ...args: (string | Options)[]): string {
  const options: Options = typeof args.at(-1) === 'object' ? args.pop() as Options : {};
  const result = childProcess.spawnSync('git', ['-C', root, ...args as string[]], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (options.optional) return '';
    throw new Error(result.error?.message || result.stderr?.trim() || 'Git command failed');
  }
  return result.stdout.trim();
}
function raw_git(root: string, args: string[]): string {
  const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Git command failed');
  return result.stdout;
}
export function head(root: string): string { return git(root, 'rev-parse', '--verify', 'HEAD', { optional: true }) || 'uncommitted'; }
export function files(root: string): string[] | null {
  if (!git(root, 'rev-parse', '--show-toplevel', { optional: true })) return null;
  return [...new Set(raw_git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort(compare_text);
}
export function changes(root: string, base: string): Record<string, any>[] {
  const revision = git(root, 'rev-parse', '--verify', '--end-of-options', base + '^{commit}');
  const tokens = raw_git(root, ['diff', '--name-status', '-z', '-M', revision, '--']).split('\0');
  const output: Record<string, any>[] = [];
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i++], filename = tokens[i++];
    const item: Record<string, any> = { status, path: filename };
    if (/^[RC]/.test(status)) { item.old_path = filename; item.path = tokens[i++]; }
    output.push(item);
  }
  return output;
}
export function isolate(root: string): string {
  if (head(root) === 'uncommitted') throw new Error('Worktree mode requires a commit. Use --write-mode local for an unborn/non-Git repository.');
  if (git(root, 'status', '--porcelain')) throw new Error('Worktree mode needs a clean checkout; commit first or explicitly use --write-mode local.');
  const name = 'understand-code-' + randomUUID().replaceAll('-', '').slice(0, 8);
  const destination = path.join(path.dirname(root), path.basename(root) + '-' + name);
  git(root, 'worktree', 'add', '-b', 'codex/' + name, destination, 'HEAD');
  return destination;
}
