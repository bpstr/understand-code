/** Shared vocabulary and version-one-compatible evidence identity. */
import { createHash } from 'node:crypto';

export const KINDS = ['system', 'module', 'feature', 'flow', 'entrypoint', 'ui_surface', 'component',
  'setting', 'feature_flag', 'data_entity', 'external_system', 'event', 'job', 'permission',
  'test_behavior', 'decision', 'constraint', 'knowledge_gap', 'concept', 'occurrence'];
export const RELATIONS = ['implemented_by', 'exposed_at', 'entered_through', 'executes', 'calls', 'reads',
  'writes', 'emits', 'consumes', 'written_by', 'persisted_in', 'read_by', 'affects', 'reused_by',
  'guards', 'controls', 'verifies', 'depends_on', 'invalidates', 'propagates_to', 'constrained_by',
  'configured_by', 'has_aspect', 'primary_surface', 'presents', 'renders', 'occurs_on', 'realizes'];
export const CONFIDENCES = ['EXTRACTED', 'CORROBORATED', 'INFERRED', 'UNKNOWN'];
export const RELATION_ENDPOINTS: Record<string, [string[], string[]]> = {
  has_aspect: [['feature', 'concept'], ['concept']],
  primary_surface: [['feature', 'concept'], ['ui_surface']],
  presents: [['ui_surface'], ['concept', 'feature', 'setting', 'data_entity']],
  renders: [['component', 'ui_surface'], ['component']],
  occurs_on: [['occurrence'], ['ui_surface']],
  realizes: [['occurrence'], ['concept', 'feature', 'setting', 'data_entity']],
};

export function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function stable_id(kind: string, key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'root';
  return `${kind}.${slug}-${digest(key).slice(0, 8)}`;
}
export function check_id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,159}$/.test(value);
}

/** Python sorts Unicode code points; JS's default sorts UTF-16 code units. */
export function compare_text(a: string, b: string): number {
  const aa = Array.from(a, c => c.codePointAt(0)!);
  const bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
}
function quoted(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Retain v1's sorted-key, ensure_ascii JSON bytes at persisted hash boundaries.
 * Object keys are serialized directly: JSON.stringify would reorder integer keys.
 */
function serialize(value: unknown, compact: boolean, indent: number | null, depth: number): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers are outside the JSON contract');
    return Object.is(value, -0) ? '-0.0' : JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('Non-JSON value in canonical serialization');
  const array = Array.isArray(value);
  const pairs = array ? value.map(item => serialize(item, compact, indent, depth + 1))
    : Object.keys(value).sort(compare_text).map(key => quoted(key) + (compact ? ':' : ': ') +
      serialize((value as Record<string, unknown>)[key], compact, indent, depth + 1));
  const [open, close] = array ? ['[', ']'] : ['{', '}'];
  if (!pairs.length) return open + close;
  if (indent !== null) return open + '\n' + ' '.repeat(indent * (depth + 1)) +
    pairs.join(',\n' + ' '.repeat(indent * (depth + 1))) + '\n' + ' '.repeat(indent * depth) + close;
  return open + pairs.join(compact ? ',' : ', ') + close;
}
export function canonical_json(value: unknown, compact = false): string { return serialize(value, compact, null, 0); }
export const python_json = canonical_json;
export function pretty_json(value: unknown, indent = 2): string { return serialize(value, false, indent, 0); }
