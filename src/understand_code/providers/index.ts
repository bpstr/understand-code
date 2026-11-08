/** Native-session task adapters, deliberately without a network/provider transport. */
import { render as claude_prompt } from './claude.js';
import { render as codex_prompt } from './codex.js';

export function render(provider: string, task: Record<string, any>): string {
  if (provider === 'claude') return claude_prompt(task);
  if (provider === 'codex') return codex_prompt(task);
  throw new Error(`Unsupported provider: ${provider}`);
}
