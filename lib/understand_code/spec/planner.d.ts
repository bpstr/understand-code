type RecordData = Record<string, any>;
export declare const ROLES: Record<string, [string | null, string]>;
export declare const MODES: Record<string, [number, number]>;
export declare function task_for(role: string, selected: string[], snapshot: string, inventory: RecordData, max_paths: number, suffix?: string): RecordData;
/** Round-robin directory branches before applying budgets; preserve every path. */
export declare function balanced_paths(paths: string[]): string[];
export declare function plan(inventory: RecordData, mode: string, focus?: string | null, impact?: RecordData | null, entities?: RecordData[] | null, relations?: RecordData[] | null, evidence?: RecordData[] | null, scope_options?: RecordData | null): RecordData;
export declare function schedule_followups(task_plan: RecordData, requests: RecordData[], inventory: RecordData): void;
export {};
