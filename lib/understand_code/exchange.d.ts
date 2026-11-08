type Data = Record<string, any>;
export declare const MAX_BYTES = 5000000;
export declare const CAPABILITIES: string[];
export declare function export_knowledge(state: Data, current: Data): Data;
export declare function validate_references(envelope: Data): void;
export declare function import_knowledge(root: string, output: string, file: string): Data;
/** Atomic explicit export; no overwriting unrelated files or following links. */
export declare function write_export(file: string, envelope: Data): void;
export {};
