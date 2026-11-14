export declare function getWindowsChromiumMasterKey(userDataDir: string, label: string, timeoutMs?: number): Promise<{
    ok: true;
    value: Buffer;
} | {
    ok: false;
    error: string;
}>;
//# sourceMappingURL=windowsMasterKey.d.ts.map