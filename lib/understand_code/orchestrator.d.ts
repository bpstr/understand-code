type Obj = Record<string, any>;
export declare function load(root: string, output: string): Obj | null;
export declare function lock<T>(root: string, output: string, operation: () => T): T;
export declare function baseline(inv: Obj): Obj[];
export interface RunOptions {
    change_request?: Obj | null;
    change_scope?: string | null;
    ledger_paths?: string[] | null;
    knowledge_path?: string | null;
    amend_standard?: boolean;
}
export declare function run(root: string, output: string, command: string, mode?: string, provider?: string, focus?: string | null, base?: string | null, finding_paths?: string[] | null, max_files?: number, max_bytes?: number, options?: RunOptions): Obj;
export {};
