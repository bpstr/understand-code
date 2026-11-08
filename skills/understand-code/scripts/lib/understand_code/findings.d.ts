type Data = Record<string, any>;
export declare function required(obj: unknown, fields: Iterable<string>, label: string): void;
export declare function validate(bundle: Data, root: string, output: string, task: Data, known_entities: Data[]): void;
export declare function reconcile(entities: Data[], relations: Data[], bundles: Data[]): [Data[], Data[], Data[]];
export {};
