type Options = {
    optional?: boolean;
};
export declare function git(root: string, ...args: (string | Options)[]): string;
export declare function head(root: string): string;
export declare function files(root: string): string[] | null;
export declare function changes(root: string, base: string): Record<string, any>[];
export declare function isolate(root: string): string;
export {};
