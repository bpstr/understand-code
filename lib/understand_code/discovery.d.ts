type Obj = Record<string, any>;
export declare const LANGUAGES: Record<string, string>;
export declare const MANIFESTS: Set<string>;
export declare const INSTRUCTIONS: Set<string>;
export declare const PATTERNS: Record<string, RegExp>;
export declare function inventory(root: string, output: string, max_files?: number, max_bytes?: number): Obj;
export {};
