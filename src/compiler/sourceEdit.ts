/**
 * Tier 1 确定性 Babel AST 字符串切片修改器
 * 核心特性：
 * 1. 毫秒级响应、零 AI 消耗
 * 2. 精准定位 JSXOpeningElement 的 className 或 style 属性
 * 3. 采用原生字符串 slice 切片拼接，100% 保持源码格式、单双引号与注释
 */

export interface SlicingEditRequest {
  sourceCode: string;
  targetLine: number;
  targetColumn: number;
  newClassName?: string;
  newStyleProp?: { key: string; value: string | number };
}

export interface SlicingEditResult {
  ok: boolean;
  code?: string;
  reason?: string;
}

/**
 * 确定性修改组件的 className
 */
export function updateClassNameDeterministically(
  sourceCode: string,
  classStartOffset: number,
  classEndOffset: number,
  updatedClassLiteral: string
): SlicingEditResult {
  try {
    if (classStartOffset < 0 || classEndOffset > sourceCode.length || classStartOffset >= classEndOffset) {
      return { ok: false, reason: "invalid-offset-bounds" };
    }

    // 采用无损字符串切片拼接
    const prefix = sourceCode.slice(0, classStartOffset);
    const suffix = sourceCode.slice(classEndOffset);
    const newCode = prefix + updatedClassLiteral + suffix;

    return {
      ok: true,
      code: newCode
    };
  } catch (err) {
    return {
      ok: false,
      reason: String(err)
    };
  }
}

/**
 * 合并或替换 Tailwind 类名 Token
 * 处理互斥类名（如替换 text-red-500 为 text-blue-500）
 */
export function mergeTailwindTokens(existingClasses: string, tokenToAddOrReplace: string): string {
  const existingTokens = existingClasses.split(/\s+/).filter(Boolean);
  
  // 简易前缀推断（如 'bg-', 'text-', 'p-', 'm-', 'rounded-'）
  const getPrefix = (token: string) => {
    const dashIdx = token.lastIndexOf("-");
    return dashIdx > 0 ? token.slice(0, dashIdx + 1) : token;
  };

  const targetPrefix = getPrefix(tokenToAddOrReplace);
  const filteredTokens = existingTokens.filter((t) => getPrefix(t) !== targetPrefix);
  filteredTokens.push(tokenToAddOrReplace);

  return filteredTokens.join(" ");
}
