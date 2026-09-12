export declare class RuntimeBusyError extends Error {
    readonly code = "RUNTIME_BUSY";
    constructor(message?: string);
}
export declare class RuntimeLock {
    private readonly filePath;
    private held;
    constructor(filePath: string);
    acquire(): Promise<void>;
    release(): Promise<void>;
    private createExclusive;
    private readPayload;
}
//# sourceMappingURL=runtimeLock.d.ts.map