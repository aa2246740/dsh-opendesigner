> **Status.** Historical notes. Not the shipped product spec. Do not use this file as an implementation checklist. Do not extend reverse-engineered protocol detail from it. See [README](../README.md) and [SHIPPED.md](./SHIPPED.md).

# 06. Figma Kiwi 二进制剪贴板协议解析与 Tailwind 映射

---

## 1. 业务场景与技术挑战

Lunagraph 最具杀伤力的特性之一就是**对 Figma 的零成本迁移**：用户无需导出 SVG、无需安装外部中介插件，只需在 Figma 客户端中选中任意图层按下 `Cmd+C`，随后在 Lunagraph 画布上按下 `Cmd+V`，该图层即刻被无损转换为由 React 19 和 Tailwind CSS 编写的真实组件代码。

### 技术壁垒：Figma 剪贴板不是纯文本
在 macOS/Windows 剪贴板中，Figma 复制出的不仅是图片，还会写入一种特有的自定义二进制 MIME 类型：
- `application/x-figma-schema-kiwi` 或带特定 header 包装的二进制流。
- 其数据序列化格式为 Figma 专有的 **Kiwi 二进制模式（Kiwi Binary Schema）**。

---

## 2. Figma 剪贴板解包全流程 (`packages/compiler/src/runtime/figma/`)

```
[系统剪贴板 (Clipboard API)]
             │ 提取二进制数据流
             ▼
[Kiwi 模式解包器 (kiwi.ts)]
             │ 解析 Schema 字节码
             ▼
[节点树场景索引重建 (buildSceneIndex)]
             │ nodeMap + childrenMap 扁平映射
             ▼
[属性语义转译器 (figmaNodeChangesToStore)]
             │ AutoLayout → Flex/Grid, Fill → bg-*, Typography → font-*
             ▼
[输出为 React JSX 与 Flat Store 节点]
```

### 关键步骤 1：Kiwi 二进制解码 (`kiwi.ts`)
Kiwi 是一种紧凑高效的二进制协议（类似 Protocol Buffers）。解码器读取剪贴板中的字节数组：
1. 校验 Schema Magic Number。
2. 解码变长整数（Varint）与字符串表。
3. 按照 Figma Document 结构反序列化出各图层节点对象（`NodeChanges` 数组）。

### 关键步骤 2：场景索引构建 (`buildSceneIndex`)
反序列化出的节点往往是无序列表，每个变更项带有 `guid`（全局唯一标识）与 `parentIndex`。
通过建立两大索引：
- `nodeMap: Map<string, FigmaNode>`：通过 GUID 极速检索节点属性。
- `childrenMap: Map<string, string[]>`：构建由父指向子的有序层次结构。

---

## 3. Figma 视觉属性到 Tailwind CSS 的映射矩阵

转译器 `toStore.ts` 负责将 Figma 矢量属性转换为生产级 Tailwind v4 类名：

| Figma 原始属性 | 内部解析结构 | 映射输出的 Tailwind 类名 / JSX |
|---|---|---|
| **AutoLayout (Horizontal)** | `stackMode: "HORIZONTAL"`, `itemSpacing: 16` | `flex flex-row gap-4 items-center` |
| **AutoLayout (Vertical)** | `stackMode: "VERTICAL"`, `itemSpacing: 8` | `flex flex-col gap-2` |
| **Padding** | `paddingLeft: 24`, `paddingTop: 12` ... | `px-6 py-3` |
| **Solid Fill** | `{ r: 0.13, g: 0.58, b: 0.95, a: 1 }` | `bg-blue-500`（自动匹配 Tailwind 调色板最接近值） |
| **Border / Stroke** | `strokeWeight: 1`, `color: #E2E8F0` | `border border-slate-200` |
| **Corner Radius** | `cornerRadius: 12` | `rounded-xl` |
| **Drop Shadow** | `type: "DROP_SHADOW"`, `blur: 16`, `offset: { x:0, y:4 }` | `shadow-md` |
| **Typography** | `fontSize: 14`, `fontWeight: 600`, `lineHeight: 20` | `text-sm font-semibold leading-5` |

---

## 4. dsh-opendesigner 复刻建议

在基于 DeepSeek Harness 重构时，剪贴板模块应当：
1. **轻量纯 JS 移植**：Kiwi 二进制解析器纯粹依赖 `ArrayBuffer` 与位运算，可直接移植为无依赖的纯 TypeScript 模块。
2. **支持兜底格式**：若剪贴板内没有 Kiwi 二进制数据（如用户从其他软件复制），自动降级为检测 HTML 片段或 SVG 矢量，走标准 JSX 生成分支。
