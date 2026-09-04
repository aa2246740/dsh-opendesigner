# 03. 双层代码编译器与 AST 就地切片修改机制

---

## 1. 设计挑战：可视化修改与工程源码的冲突

在传统可视化工具生成代码时，普遍存在两大严重弊端：
1. **代码格式全量格式化洗牌**：简单修改一个类名，导致整个文件的缩进、单双引号、分号、换行被 Prettier/Babel 全量重写，破坏 Git Blame 与代码审查。
2. **丢失注释与高级语法**：TypeScript 类型标注、JSX 表达式注释、Hooks 逻辑往往在重新 `print(AST)` 过程中被意外吞没或改写。

Lunagraph 的突破在于构建了**“双层分级切片编译器（Two-Tier Slicing Compiler）”**。

```
                     ┌─────────────────────────────┐
                     │     画布发生属性或代码修改   │
                     └──────────────┬──────────────┘
                                    │
                               判断修改类型
                                    │
               ┌────────────────────┴────────────────────┐
          【属性/类名/样式微调】                     【结构/逻辑变动】
               │                                         │
               ▼                                         ▼
    Tier 1: 确定性 Babel 切片                  Tier 2: AI 结构化代码合并
         (sourceEdit.ts)                           (claudeMerge.ts)
   ─────────────────────────────             ─────────────────────────────
   • 零 Token 消耗 / 毫秒级执行              • 保持 Hooks、State 与复杂函数
   • 定位目标 JSXElement                     • 支持 Claude CLI / Grok / OpenAI
   • 字节偏移就地替换字符串                   • 结构化 JSON Schema 严格补丁
   • 100% 保持其余部分格式与注释              • 本地精确文本补丁执行器
```

---

## 2. Tier 1：确定性 AST 切片修改 (`sourceEdit.ts`)

`sourceEdit.ts` 专门处理最高频的视觉微调场景（拖拽改宽高、点击改颜色、调整内边距等）。

### 核心实现原理
1. **轻量语法树解析**：
   使用 `@babel/parser` 将目标源文件解析为 AST（启用 `jsx` 与 `typescript` 插件），保留 `tokens` 与字符起始/结束偏移量（`start`, `end`, `loc`）。
2. **节点精准匹配**：
   通过调用方传入的元素标识符（如特定的行号、列号或带属性的定位器），在 AST 中遍历找到对应的 `JSXOpeningElement`。
3. **针对 `className` 的 Token 级替换**：
   - 如果目标属性为字面量字符串（如 `className="p-4 text-red-500 rounded"`）：
   - 提取出原有类名列表，根据 Tailwind 冲突消除规则（类名语义分组，如文本颜色、背景色、Padding 属于互斥组），精准计算出需要剔除的子字符串起始位置与替换字符串。
   - **关键操作：不使用 Babel Generator 重写文件**，而是直接对**原始源文件字符串（Raw Source String）**进行切片拼接：
     ```typescript
     const updatedSource = source.slice(0, targetStart) + newClassString + source.slice(targetEnd);
     ```
4. **针对 `style={{ ... }}` 的行内合并**：
   - 检查属性是否为 `JSXExpressionContainer` 且内部为 `ObjectExpression`。
   - 若为纯静态字面量对象，定位目标属性的 key-value 偏移区间就地替换。
5. **安全降级防线**：
   - 若遇到动态类名调用（如 `className={cn("base", isActive && "active", customClass)}`）或包含复杂三元运算，`sourceEdit.ts` 不会强行替换破坏代码，而是立即返回：
     ```json
     { "ok": false, "reason": "not-literal" }
     ```
   - 系统自动将该变更转交给 Tier 2 处理。

---

## 3. Tier 2：AI 结构化合并引擎 (`claudeMerge.ts`)

当改动涉及 DOM 节点层级重排、增删子组件、或者动态表达式时，系统交由 Tier 2 引擎。

### 官方源码关键发现：早已内嵌 OpenAI 规范！
我们在逆向中发现，虽然官方客户端对外部只暴露 Claude，但其编译器源码 `claudeMerge.ts` 早已实现了完整的通用模型接入抽象：

```typescript
// 源码来自 packages/compiler/src/codegen/claudeMerge.ts
function resolveSaveToCodeAiFromEnv(env = process.env) {
  const mode = env.SAVE_TO_CODE_MODE || "cli"; // 支持 "api" 模式与 "cli" 模式
  const provider = env.SAVE_TO_CODE_PROVIDER || (env.GROK_API_KEY ? "grok" : "anthropic");
  const apiKey = provider === "grok" ? (env.GROK_API_KEY || env.XAI_API_KEY) : env.ANTHROPIC_API_KEY;
  const apiBaseUrl = env.GROK_API_BASE_URL || "https://api.x.ai/v1";
  // ...
}
```

### JSON Schema 结构化补丁协议
在 `api` 模式下，系统不要求模型直接吐出整段冗长代码（防止幻觉与全量重写），而是通过 JSON Schema 严格约束输出为“代码补丁集”：

```json
{
  "name": "save_to_code_edits",
  "description": "A set of surgical find-and-replace text edits to apply to the source file",
  "parameters": {
    "type": "object",
    "properties": {
      "edits": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "old_string": {
              "type": "string",
              "description": "Exact text chunk in the original file to be replaced"
            },
            "new_string": {
              "type": "string",
              "description": "New replacement code chunk"
            },
            "replace_all": {
              "type": "boolean",
              "description": "Whether to replace all occurrences or only the unique one"
            }
          },
          "required": ["old_string", "new_string"]
        }
      }
    },
    "required": ["edits"]
  }
}
```

### 本地补丁应用校验
在获取模型返回的 `edits` 数组后，本地引擎执行确定性校验：
1. 遍历每个 `edit`，检查 `old_string` 在原始文件中的出现频次。
2. 若 `replace_all` 为 false 且 `old_string` 在文件中出现次数大于 1，立即中止替换并报错，防止意外替换同名变量或结构。
3. 应用补丁后，重新进行 AST 快速语法解析，若出现语法解析错误（SyntaxError），立即触发回滚。

---

## 4. JSX 双向转换器 (`parseJSX.ts` & `generateJSX.ts`)

为了在画布 Flat Store（扁平化组件树）与实际 JSX 语法之间自由切换，编译器提供了双向序列化工具：
- **`parseJSX`**：将 React JSX 字符串解析为扁平化的画布节点对象（提取 props, tag, children 关联, 纯文本节点）。
- **`generateJSX`**：将扁平化节点树逆向拼接为缩进规范、格式优美的标准 JSX 语法，智能合并空标签与自闭合标签（`<div />`）。
