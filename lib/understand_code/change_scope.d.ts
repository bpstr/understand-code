type Data = Record<string, any>;
export declare const POLICY = "semantic-change-scope-v1";
export declare const INTENTS: readonly ["ui_standardization", "settings_change", "cross_cutting"];
export declare const UI_RELATIONS: Set<string>;
export declare const SETTING_RELATIONS: Set<string>;
export declare const DISCOVERY_POLICIES: Record<string, string[]>;
export interface ScopeOptions {
    intent?: string;
    examples?: string[];
    boundaries?: string[];
    exclusions?: string[];
    max_depth?: number;
    max_nodes?: number;
}
export declare function fingerprint(value: unknown): string;
export declare function normalize(value: string): string;
export declare function validate_boundaries(paths: string[]): string[];
export declare function in_boundary(path: string, boundaries: string[], exclusions?: string[] | null): boolean;
export declare function source_manifest(inv: Data, boundaries?: string[], exclusions?: string[], generations?: Data[]): Data;
export declare function established(claim: Data): boolean;
/** Every nonempty source-language file is a fallback for native inspection. */
export declare function surface_roster(inv: Data, boundaries?: string[], exclusions?: string[]): Data[];
export declare function resolve(topic: string, inv: Data, entities: Data[], relations: Data[], evidence: Data[], options?: ScopeOptions): Data;
export {};
