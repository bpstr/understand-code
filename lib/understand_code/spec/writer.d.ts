type RecordData = Record<string, any>;
export declare const START = "<!-- understand-code:generated:start -->";
export declare const END = "<!-- understand-code:generated:end -->";
export declare const HUMAN = "\n\n## Maintainer notes\n\n<!-- understand-code:human -->\n";
export declare function json_text(value: unknown): string;
export declare function jsonl(values: unknown[]): string;
export declare function escape(text: unknown): string;
/** Percent-encode a relative Markdown URL exactly, preserving only path separators. */
export declare function quote_path(value: string): string;
export declare function page(title: string, body: string, entity?: RecordData | null): string;
/** Ignore literal ownership markers inside standalone CommonMark fences. */
export declare function split_generated(text: string): [string, string];
export declare function generated(text: string): string;
export declare function append_generated(text: string, content: string): string;
export declare function source_link(page_path: string, output: string, ref: RecordData): string;
export declare function entity_path(entity: RecordData): string;
export declare function render(state: RecordData, output: string): Record<string, string>;
/** Preflight every conflict before mutation; preserve unmanaged files and human notes. */
export declare function write(output: string, docs: Record<string, string>, metadata: Record<string, string>, manifest: RecordData): void;
export {};
