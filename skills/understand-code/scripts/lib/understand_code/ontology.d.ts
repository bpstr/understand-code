export declare const KINDS: string[];
export declare const RELATIONS: string[];
export declare const CONFIDENCES: string[];
export declare const RELATION_ENDPOINTS: Record<string, [string[], string[]]>;
export declare function digest(value: string): string;
export declare function stable_id(kind: string, key: string): string;
export declare function check_id(value: unknown): value is string;
/** Python sorts Unicode code points; JS's default sorts UTF-16 code units. */
export declare function compare_text(a: string, b: string): number;
export declare function canonical_json(value: unknown, compact?: boolean): string;
export declare const python_json: typeof canonical_json;
export declare function pretty_json(value: unknown, indent?: number): string;
