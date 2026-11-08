type Data = Record<string, any>;
export declare const PROFILE_TOPICS: Record<string, readonly string[]>;
export declare const EXAMPLE_PROFILES: Set<string>;
/** Bind an external check to the exact snippet, setup and claimed outcome. */
export declare function example_fingerprint(example: Data): string;
/** Strict ISO timestamp check, including calendar validity and explicit timezone. */
export declare function timezone_timestamp(value: string): boolean;
/** Nested references must be owned by the entity so its evidence lifecycle applies. */
export declare function validate_documents(entity: Data, refs: Record<string, Data>, snapshot: string): void;
/** One durable owner per generated document, including replacements. */
export declare function validate_document_ids(entities: Data[], known_entities: Data[]): void;
export {};
