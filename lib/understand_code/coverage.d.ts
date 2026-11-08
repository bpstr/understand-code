import { type ScopeOptions } from './change_scope.js';
type Data = Record<string, any>;
export declare const DISPOSITIONS: readonly ["changed_directly", "changed_via_shared_dependency", "already_compliant", "excluded", "removed", "unresolved"];
export declare function validate_standard(standard: Data): void;
export declare function new_request(topic: string, intent: string, standard?: Data | null, options?: ScopeOptions): Data;
export declare function scope_options(request: Data): ScopeOptions;
/** Rediscover independently and retain the union of every observed obligation. */
export declare function refresh(previous: Data | null, request: Data, state: Data, amend_standard?: boolean): Data;
export declare function current_source(scope: Data, inv: Data, generations: Data[]): Data;
export declare function review_template(scope: Data): Data;
/** Validate the whole packet before modifying even the in-memory scope. */
export declare function apply_review(scope: Data, packet: Data, root: string, output: string): Data;
/** Five independent axes. The legacy coverage_complete metric is unchanged. */
export declare function assess(scope: Data, state: Data, current: Data): Data;
export {};
