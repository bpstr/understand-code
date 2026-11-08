type Obj = Record<string, any>;
export declare function parse_args(argv: string[]): Obj;
export declare function parser(): {
    parse_args: typeof parse_args;
};
export declare function main(argv?: string[]): number;
export {};
