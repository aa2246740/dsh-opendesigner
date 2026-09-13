/**
 * next/navigation 状态存根
 * 模拟 useRouter, usePathname, useSearchParams, useParams
 */
export declare function setVirtualLocation(pathname: string, search?: string): void;
export declare function useRouter(): {
    push(url: string): void;
    replace(url: string): void;
    back(): void;
    forward(): void;
    refresh(): void;
    prefetch(): void;
};
export declare function usePathname(): string;
export declare function useSearchParams(): URLSearchParams;
export declare function useParams(): Record<string, string>;
//# sourceMappingURL=navigation.d.ts.map