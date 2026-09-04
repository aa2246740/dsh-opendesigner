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
 * 获取 Tailwind 类名 Token 的互斥分类槽位
 * 如果两个 Token 属于同一个分类槽位，则互斥替换
 */
export function getTailwindCategory(token: string): string {
  // 分离可能存在的修饰前缀（如 hover:, focus:, md:, dark: 等）
  const colonIdx = token.lastIndexOf(":");
  const prefix = colonIdx !== -1 ? token.slice(0, colonIdx + 1) : "";
  const baseToken = colonIdx !== -1 ? token.slice(colonIdx + 1) : token;

  // 1. 文本相关：细分颜色、字号、对齐、粗细、排版、换行、溢出、透明度
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(baseToken)) {
    return `${prefix}text-size`;
  }
  if (/^text-(left|center|right|justify|start|end)$/.test(baseToken)) {
    return `${prefix}text-align`;
  }
  if (/^text-(wrap|nowrap|balance|pretty)$/.test(baseToken)) {
    return `${prefix}text-wrap`;
  }
  if (/^text-(ellipsis|clip)$/.test(baseToken)) {
    return `${prefix}text-overflow`;
  }
  if (/^text-opacity-/.test(baseToken)) {
    return `${prefix}text-opacity`;
  }
  if (/^text-/.test(baseToken)) {
    return `${prefix}text-color`;
  }
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(baseToken)) {
    return `${prefix}font-weight`;
  }
  if (/^font-(sans|serif|mono)$/.test(baseToken)) {
    return `${prefix}font-family`;
  }
  if (/^(italic|not-italic)$/.test(baseToken)) {
    return `${prefix}font-style`;
  }

  // 2. 背景相关：细分颜色、尺寸、位置、重复、剪裁、渐变、透明度
  if (/^bg-(auto|cover|contain)$/.test(baseToken)) {
    return `${prefix}bg-size`;
  }
  if (/^bg-(bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top)$/.test(baseToken)) {
    return `${prefix}bg-position`;
  }
  if (/^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/.test(baseToken)) {
    return `${prefix}bg-repeat`;
  }
  if (/^bg-(clip-border|clip-padding|clip-content|clip-text)$/.test(baseToken) || /^bg-clip-/.test(baseToken)) {
    return `${prefix}bg-clip`;
  }
  if (/^bg-(origin-border|origin-padding|origin-content)$/.test(baseToken) || /^bg-origin-/.test(baseToken)) {
    return `${prefix}bg-origin`;
  }
  if (/^bg-(gradient-to-[trbl]{1,2}|none)$/.test(baseToken) || /^bg-gradient-/.test(baseToken)) {
    return `${prefix}bg-gradient`;
  }
  if (/^bg-opacity-/.test(baseToken)) {
    return `${prefix}bg-opacity`;
  }
  if (/^bg-/.test(baseToken)) {
    return `${prefix}bg-color`;
  }

  // 3. 边框与圆角
  if (/^rounded-(t|b|l|r|tl|tr|bl|br)(-.*)?$/.test(baseToken)) {
    const side = baseToken.match(/^rounded-(t|b|l|r|tl|tr|bl|br)/)![1];
    return `${prefix}rounded-${side}`;
  }
  if (/^rounded(-.*)?$/.test(baseToken)) {
    return `${prefix}rounded`;
  }
  if (/^border-(solid|dashed|dotted|double|none|hidden)$/.test(baseToken)) {
    return `${prefix}border-style`;
  }
  if (/^border-(collapse|separate)$/.test(baseToken)) {
    return `${prefix}border-collapse`;
  }
  if (/^border-opacity-/.test(baseToken)) {
    return `${prefix}border-opacity`;
  }
  if (/^border-(t|b|l|r)(-\d+)?$/.test(baseToken)) {
    const side = baseToken.match(/^border-(t|b|l|r)/)![1];
    return `${prefix}border-width-${side}`;
  }
  if (/^border(-\d+)?$/.test(baseToken)) {
    return `${prefix}border-width`;
  }
  if (/^border-/.test(baseToken)) {
    return `${prefix}border-color`;
  }

  // 4. 内边距 (Padding) 与外边距 (Margin) - 兼容负外边距互斥，如 -m-4 与 m-4
  const spacingMatch = baseToken.match(/^(-?[mp][xytrbl]?)-/);
  if (spacingMatch) {
    const dir = spacingMatch[1].replace(/^-/, "");
    return `${prefix}spacing-${dir}`;
  }

  // 5. 尺寸与宽高
  if (/^w-/.test(baseToken)) return `${prefix}w`;
  if (/^h-/.test(baseToken)) return `${prefix}h`;
  if (/^min-w-/.test(baseToken)) return `${prefix}min-w`;
  if (/^max-w-/.test(baseToken)) return `${prefix}max-w`;
  if (/^min-h-/.test(baseToken)) return `${prefix}min-h`;
  if (/^max-h-/.test(baseToken)) return `${prefix}max-h`;

  // 6. 布局模式与对齐
  if (/^flex-(row|row-reverse|col|col-reverse)$/.test(baseToken)) return `${prefix}flex-direction`;
  if (/^flex-(wrap|wrap-reverse|nowrap)$/.test(baseToken)) return `${prefix}flex-wrap`;
  if (/^flex-(1|auto|initial|none)$/.test(baseToken) || /^grow(-.*)?$/.test(baseToken) || /^shrink(-.*)?$/.test(baseToken)) {
    return `${prefix}flex-grow-shrink`;
  }
  if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/.test(baseToken)) {
    return `${prefix}display`;
  }
  if (/^items-/.test(baseToken)) return `${prefix}items`;
  if (/^justify-items-/.test(baseToken)) return `${prefix}justify-items`;
  if (/^justify-/.test(baseToken)) return `${prefix}justify-content`;
  if (/^gap-x-/.test(baseToken)) return `${prefix}gap-x`;
  if (/^gap-y-/.test(baseToken)) return `${prefix}gap-y`;
  if (/^gap-/.test(baseToken)) return `${prefix}gap`;

  // 7. 定位体系
  if (/^(static|fixed|absolute|relative|sticky)$/.test(baseToken)) return `${prefix}position`;
  if (/^-?top-/.test(baseToken)) return `${prefix}top`;
  if (/^-?right-/.test(baseToken)) return `${prefix}right`;
  if (/^-?bottom-/.test(baseToken)) return `${prefix}bottom`;
  if (/^-?left-/.test(baseToken)) return `${prefix}left`;
  if (/^-?inset-/.test(baseToken)) return `${prefix}inset`;
  if (/^z-/.test(baseToken)) return `${prefix}z-index`;

  // 8. 效果与状态
  if (/^shadow(-.*)?$/.test(baseToken)) return `${prefix}shadow`;
  if (/^opacity-/.test(baseToken)) return `${prefix}opacity`;
  if (/^cursor-/.test(baseToken)) return `${prefix}cursor`;
  if (/^overflow-x-/.test(baseToken)) return `${prefix}overflow-x`;
  if (/^overflow-y-/.test(baseToken)) return `${prefix}overflow-y`;
  if (/^overflow-/.test(baseToken)) return `${prefix}overflow`;

  // 兜底：按前缀划分
  const dashIdx = baseToken.lastIndexOf("-");
  return dashIdx > 0 ? `${prefix}${baseToken.slice(0, dashIdx + 1)}` : `${prefix}${baseToken}`;
}

/**
 * 彻底修复的 Tailwind 类名 Token 合并算法
 * 按 Tailwind 类别词根分组互斥替换，确保如 text-red-500 能被正确替换为 text-blue-500
 */
export function mergeTailwindTokens(existingClasses: string, tokensToAddOrReplace: string): string {
  const existingTokens = existingClasses.split(/\s+/).filter(Boolean);
  const incomingTokens = tokensToAddOrReplace.split(/\s+/).filter(Boolean);

  let currentTokens = [...existingTokens];

  for (const incomingToken of incomingTokens) {
    const targetCategory = getTailwindCategory(incomingToken);
    currentTokens = currentTokens.filter((t) => getTailwindCategory(t) !== targetCategory);
    currentTokens.push(incomingToken);
  }

  return currentTokens.join(" ");
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
