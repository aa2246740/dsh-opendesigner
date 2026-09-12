/**
 * Exclusive Tailwind class merging. Kept free of Babel so the web client can import it.
 */
/**
 * 获取 Tailwind 类名 Token 的互斥分类槽位
 * 如果两个 Token 属于同一个分类槽位，则互斥替换
 */
export declare function getTailwindCategory(token: string): string;
/**
 * 彻底修复的 Tailwind 类名 Token 合并算法
 * 按 Tailwind 类别词根分组互斥替换，确保如 text-red-500 能被正确替换为 text-blue-500
 */
export declare function mergeTailwindTokens(existingClasses: string, tokensToAddOrReplace: string): string;
export declare function dropTailwindCategory(existingClasses: string, category: string): string;
export declare const mergeTailwindClasses: typeof mergeTailwindTokens;
//# sourceMappingURL=tailwindMerge.d.ts.map