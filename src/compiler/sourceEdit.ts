/**
 * Tier 1 确定性 Babel AST 字符串切片修改器
 * 核心特性：
 * 1. 毫秒级响应、零 AI 消耗
 * 2. 接入 @babel/parser 与 @babel/traverse 实现精准定位
 * 3. 彻底修复 Tailwind 互斥类名合并算法缺陷（按类别词根槽位排他替换）
 * 4. 采用无损字符串 slice 切片拼接，100% 保持源码格式、单双引号与注释
 */

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { mergeTailwindTokens } from "./tailwindMerge.ts";

export { getTailwindCategory, mergeTailwindTokens, mergeTailwindClasses } from "./tailwindMerge.ts";

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
 * 基于精确切片区间的 className 更新
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
 * 依据 (targetLine, targetColumn) 精确寻找最匹配的 JSXOpeningElement 节点
 * 严格支持同一行多元素精确定位，优先选取最内层且包含 targetColumn 的元素
 */
export function findBestMatchingOpeningElement(ast: any, targetLine: number, targetColumn: number): any {
  const trav = (traverse as any).default || traverse;
  const candidates: Array<{ node: any; contains: boolean; dist: number; range: number }> = [];

  trav(ast, {
    JSXOpeningElement(path: any) {
      const node = path.node;
      const { start, end } = node.loc;

      // 检查 (targetLine, targetColumn) 是否在行号范围内
      const lineInRange = start.line <= targetLine && targetLine <= end.line;
      if (!lineInRange) return;

      let contains = false;
      if (start.line === end.line) {
        contains = targetColumn >= start.column && targetColumn <= end.column;
      } else {
        if (targetLine === start.line) {
          contains = targetColumn >= start.column;
        } else if (targetLine === end.line) {
          contains = targetColumn <= end.column;
        } else {
          contains = true;
        }
      }

      const dist = Math.abs(start.column - targetColumn);
      const range = node.end - node.start;
      candidates.push({ node, contains, dist, range });
    }
  });

  if (candidates.length === 0) return null;

  // 排序优先级：
  // 1. 严格包含 targetColumn 的节点排在最前
  // 2. 在包含的前提下，开销范围最小的（最内层节点）优先
  // 3. 若均不包含，则按 start.column 距离 targetColumn 最近的优先
  candidates.sort((a, b) => {
    if (a.contains && !b.contains) return -1;
    if (!a.contains && b.contains) return 1;
    if (a.contains && b.contains) {
      return a.range - b.range;
    }
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.range - b.range;
  });

  return candidates[0].node;
}

/**
 * 基于 Babel AST 精准行列号定位的源码就地切片更新
 */
export function updateSourceCodeDeterministically(request: SlicingEditRequest): SlicingEditResult {
  const { sourceCode, targetLine, targetColumn, newClassName, newStyleProp } = request;

  let ast: any;
  try {
    ast = parse(sourceCode, {
      sourceType: "module",
      plugins: ["jsx", "typescript"]
    });
  } catch (err: any) {
    return { ok: false, reason: `parse-error: ${err.message}` };
  }

  // 寻找精准匹配的 JSXOpeningElement
  const targetOpeningNode = findBestMatchingOpeningElement(ast, targetLine, targetColumn);

  if (!targetOpeningNode) {
    return { ok: false, reason: `target-element-not-found at ${targetLine}:${targetColumn}` };
  }

  let workingCode = sourceCode;

  // 1. 处理 className 修改
  if (newClassName !== undefined) {
    const classAttr = targetOpeningNode.attributes.find(
      (attr: any) => attr.type === "JSXAttribute" && attr.name && attr.name.name === "className"
    );

    if (classAttr) {
      // 如果已有 className
      if (!classAttr.value || classAttr.value.type !== "StringLiteral") {
        // 动态表达式（如 className={cn(...)}），安全降级
        return { ok: false, reason: "not-literal" };
      }

      const existingClassStr = classAttr.value.value;
      const merged = mergeTailwindTokens(existingClassStr, newClassName);
      const raw = classAttr.value.extra?.raw || `"${existingClassStr}"`;
      const quote = raw[0] === "'" ? "'" : '"';
      const replacement = `${quote}${merged}${quote}`;

      const res = updateClassNameDeterministically(
        workingCode,
        classAttr.value.start,
        classAttr.value.end,
        replacement
      );
      if (!res.ok) return res;
      workingCode = res.code!;
    } else {
      // 无 className，在 openingElement 闭合前插入
      const insertPos = targetOpeningNode.selfClosing
        ? targetOpeningNode.end - 2
        : targetOpeningNode.end - 1;

      const insertion = ` className="${newClassName}"`;
      workingCode = workingCode.slice(0, insertPos) + insertion + workingCode.slice(insertPos);
    }
  }

  // 2. 处理 style 属性修改
  if (newStyleProp !== undefined) {
    const { key, value } = newStyleProp;
    const formattedVal = typeof value === "string" ? `"${value}"` : `${value}`;

    // 重新解析以获取准确偏移（若 className 修改改变了字符串长度）
    const freshAst = parse(workingCode, { sourceType: "module", plugins: ["jsx", "typescript"] });
    const freshNode = findBestMatchingOpeningElement(freshAst, targetLine, targetColumn) || targetOpeningNode;

    const styleAttr = freshNode.attributes.find(
      (attr: any) => attr.type === "JSXAttribute" && attr.name && attr.name.name === "style"
    );

    if (styleAttr) {
      if (
        !styleAttr.value ||
        styleAttr.value.type !== "JSXExpressionContainer" ||
        styleAttr.value.expression.type !== "ObjectExpression"
      ) {
        return { ok: false, reason: "not-literal" };
      }

      const objExpr = styleAttr.value.expression;
      const existingProp = objExpr.properties.find(
        (p: any) => p.type === "ObjectProperty" && (p.key.name === key || p.key.value === key)
      );

      if (existingProp) {
        workingCode =
          workingCode.slice(0, existingProp.value.start) +
          formattedVal +
          workingCode.slice(existingProp.value.end);
      } else {
        // 在对象内部插入新属性
        const insertPos = objExpr.end - 1;
        const needsComma = objExpr.properties.length > 0;
        const insertion = `${needsComma ? ", " : ""}${key}: ${formattedVal} `;
        workingCode = workingCode.slice(0, insertPos) + insertion + workingCode.slice(insertPos);
      }
    } else {
      // 插入 style 属性
      const insertPos = freshNode.selfClosing ? freshNode.end - 2 : freshNode.end - 1;
      const insertion = ` style={{ ${key}: ${formattedVal} }}`;
      workingCode = workingCode.slice(0, insertPos) + insertion + workingCode.slice(insertPos);
    }
  }

  return { ok: true, code: workingCode };
}
