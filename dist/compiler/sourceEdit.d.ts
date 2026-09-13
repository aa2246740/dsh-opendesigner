/**
 * Tier 1 确定性 Babel AST 字符串切片修改器
 * 核心特性：
 * 1. 毫秒级响应、零 AI 消耗
 * 2. 接入 @babel/parser 与 @babel/traverse 实现精准定位
 * 3. 彻底修复 Tailwind 互斥类名合并算法缺陷（按类别词根槽位排他替换）
 * 4. 采用无损字符串 slice 切片拼接，100% 保持源码格式、单双引号与注释
 */
export { getTailwindCategory, mergeTailwindTokens, mergeTailwindClasses, dropTailwindCategory } from "./tailwindMerge.ts";
export interface SlicingEditRequest {
    sourceCode: string;
    targetLine: number;
    targetColumn: number;
    newClassName?: string;
    setClassName?: boolean;
    newStyleProp?: {
        key: string;
        value: string | number;
    };
}
export interface SlicingEditResult {
    ok: boolean;
    code?: string;
    reason?: string;
}
/**
 * 基于精确切片区间的 className 更新
 */
export declare function updateClassNameDeterministically(sourceCode: string, classStartOffset: number, classEndOffset: number, updatedClassLiteral: string): SlicingEditResult;
/**
 * 依据 (targetLine, targetColumn) 精确寻找最匹配的 JSXOpeningElement 节点
 * 严格支持同一行多元素精确定位，优先选取最内层且包含 targetColumn 的元素
 */
export declare function findBestMatchingOpeningElement(ast: any, targetLine: number, targetColumn: number): any;
/**
 * 基于 Babel AST 精准行列号定位的源码就地切片更新
 */
export declare function updateSourceCodeDeterministically(request: SlicingEditRequest): SlicingEditResult;
//# sourceMappingURL=sourceEdit.d.ts.map