export declare class PathJailError extends Error {
    readonly code = "PATH_JAIL";
    readonly causeCode?: string;
    constructor(message: string, causeCode?: string);
}
export declare function resolveProjectRoot(projectRoot: string): string;
export declare function resolveProjectPath(projectRoot: string, requested: unknown): string;
export declare function assertManagedPath(abs: string): void;
//# sourceMappingURL=pathJail.d.ts.map