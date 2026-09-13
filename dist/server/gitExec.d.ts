export declare const GIT_ISOLATED_ENV: NodeJS.ProcessEnv;
export declare function git(cwd: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function gitBytes(cwd: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<{
    stdout: Buffer;
    stderr: Buffer;
}>;
export declare function isGitRepo(cwd: string): Promise<boolean>;
export declare function isGitRoot(cwd: string): Promise<boolean>;
export declare function gitHead(cwd: string): Promise<string | null>;
export declare function gitShowBytes(cwd: string, ref: string, rel: string): Promise<{
    kind: "absent";
} | {
    kind: "bytes";
    bytes: Buffer;
} | {
    kind: "unreadable";
    code: string;
    message: string;
}>;
//# sourceMappingURL=gitExec.d.ts.map