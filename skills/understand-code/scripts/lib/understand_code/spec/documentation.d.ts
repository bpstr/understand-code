type RecordData = Record<string, any>;
export declare function document_path(document: RecordData): string;
/** Preserve paragraphs without allowing arbitrary Markdown or HTML. */
export declare function prose(text: string): string;
export declare function field(label: string, value: string): string;
export declare function table(columns: string[], rows: string[][]): string;
export declare function fenced_example(example: RecordData): string;
export declare function sources(ids: string[], refs: Record<string, RecordData>, filename: string, output: string): string;
export declare const MODE_NOTICES: Record<string, string>;
export declare const BASIS_NOTICES: Record<string, string>;
export declare function render_documents(state: RecordData, output: string): Record<string, string>;
/** Assess authored documents only; leave legacy integrity/coverage verification independent. */
export declare function assess_documents(state: RecordData, current: RecordData): RecordData;
export {};
