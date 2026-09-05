/**
 * Exclusive Tailwind class merging. Kept free of Babel so the web client can import it.
 */

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
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+[^\]]*\])$/.test(baseToken)) {
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
  if (/^border-(t|b|l|r)(-\d+|-\[\d+[^\]]*\])?$/.test(baseToken)) {
    const side = baseToken.match(/^border-(t|b|l|r)/)![1];
    return `${prefix}border-width-${side}`;
  }
  if (/^border(-\d+|-\[\d+[^\]]*\])?$/.test(baseToken)) {
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

export const mergeTailwindClasses = mergeTailwindTokens;

