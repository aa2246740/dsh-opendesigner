export type FilePresence = {
    kind: "absent";
} | {
    kind: "bytes";
    bytes: Buffer;
} | {
    kind: "unreadable";
    code: string;
    message: string;
};
export declare function contentHash(bytes: Buffer): string;
export declare function presenceEqual(a: FilePresence, b: FilePresence): boolean;
export declare function readPresence(filePath: string): Promise<FilePresence>;
export declare function readFileNoFollow(abs: string): Promise<Buffer>;
export declare function readTextNoFollow(abs: string): Promise<string>;
export declare function writeFileNoFollow(abs: string, contents: string | Buffer): Promise<void>;
export declare function copyFileNoFollow(from: string, to: string): Promise<void>;
export declare function unlinkNoFollow(abs: string): Promise<void>;
export declare function withManagedWriteLock<T>(abs: string, fn: () => Promise<T>): Promise<T>;
export declare function managedReplace(abs: string, expectedHash: string | null, data: string | Buffer): Promise<void>;
export declare function managedUnlink(abs: string, expectedHash: string | null): Promise<void>;
//# sourceMappingURL=fileBytes.d.ts.map