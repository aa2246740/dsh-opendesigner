# 01. 总体架构与设计心智模型

---

## 1. 系统本质：从“矢量画板”到“代码运行时画板”

传统 UI 设计工具（如 Figma、Sketch）与代码开发之间存在不可逾越的鸿沟：
- **矢量画板的局限**：设计稿中的图层是矩形、贝塞尔曲线和矢量对象。导出为代码时，需要进行“语义转译（Handoff）”，转译通常会丢失 Flex 弹性伸缩逻辑、真实文本折行、交互状态以及组件 Props。
- **Lunagraph 的范式转移**：画布上渲染的每一个视觉矩形，直接对应项目代码中的 **真实 React 19 组件实例** 与 **Tailwind CSS 类名**。画布不存在“中间矢量抽象层”，视觉树即真实 DOM 树。

```
[传统设计工具工作流]
Figma (Vector Data) ──转译交付 (Handoff Loss)──> Frontend Code (React / CSS)

[Lunagraph / dsh-opendesigner 闭环工作流]
React Code (Disk / AST) ◄─── 双向无损往返 (Round-trip) ───► Visual Canvas (Live React 19 DOM)
```

---

## 2. 运行时分层拓扑

Lunagraph 采用典型的 Electron 多进程 + 本地 HTTP 服务架构，整体分为四大运行平面：

```
+-------------------------------------------------------------------------------+
| 1. 外部开发环境 (External Plane)                                               |
|    - VS Code / Cursor / 终端命令行                                            |
|    - 外部 AI 客户端 (Claude Desktop / Roo Code / 本地脚本)                    |
+-------------------------------------------------------------------------------+
                                 │
                         HTTP MCP (Port 21209)
                                 ▼
+-------------------------------------------------------------------------------+
| 2. 主进程服务层 (Main Process Plane - Node.js)                                  |
|    - HTTP MCP Server (mcpServer.ts): 提供 38 个工具接口                         |
|    - Claim 锁注册中心 (claimRegistry): 元素级并发互斥控制 (TTL 300s)           |
|    - 权限门禁与审批控制器 (requestToolApproval & DESTRUCTIVE_TOOLS)            |
|    - 本地伪终端管理器 (terminal.ts - node-pty)                                |
|    - 源码确定性切片修改引擎 (sourceEdit.ts)                                   |
+-------------------------------------------------------------------------------+
                                 │
                            Electron IPC
                                 ▼
+-------------------------------------------------------------------------------+
| 3. 渲染器外壳层 (Renderer Shell Plane - React + Tailwind)                      |
|    - 状态管理: 扁平 AST Store (ensureV2.ts - byId / children / parent)         |
|    - 工具栏与侧边栏: Pages, Layers, Assets (*.compositions.tsx), Terminal, Git|
|    - 样式检查器 (StylesPanel): 布局、边距、颜色、字体、阴影、圆角                |
|    - 画布手势与几何计算: 2D 仿射变换、6线智能吸附 (snapping.ts)、伴随缩放      |
|    - MCP 画布调度适配器 (useCanvasToolHandler.ts)                             |
+-------------------------------------------------------------------------------+
                                 │
                       Webview / iframe 隔离
                                 ▼
+-------------------------------------------------------------------------------+
| 4. 真实组件沙箱层 (Component Sandbox Plane)                                   |
|    - 浏览器原生动态加载 (Vite + esm.sh 动态导入)                              |
|    - Next.js 服务端组件垫片环境 (next-shims: image, link, navigation, font)   |
|    - React 19 动态挂载沙箱 (ComponentCompiler.ts & executeModule.ts)         |
|    - 异常防御与快照回退 (type: 'capture' 图像降级)                            |
+-------------------------------------------------------------------------------+
```

---

## 3. 双向往返编辑模型 (Round-trip Editing Mental Model)

整个系统的运转核心在于“**视觉操作与磁盘代码的无缝同步**”：

### (1) Canvas → Code（画布向代码流动）
- 用户在画布上拖拽调整元素尺寸、间距，或在右侧属性面板点击修改颜色、字体。
- 系统首先定位到该元素在源码文件中的 AST 节点（通过 Fiber 携带的行列号或组件标识）。
- **分级处理决策**：
  - **Tier 1 路径（确定性 Babel AST 切片）**：若变更仅为 Tailwind 类名增删（如 `bg-blue-500` 变为 `bg-emerald-600`）或静态行内 style，直接调用 `sourceEdit.ts` 执行源码字符串切片替换。**耗时 < 5ms，无外部网络请求，格式与注释 100% 保持**。
  - **Tier 2 路径（AI 结构化合并）**：若涉及复杂的 JSX 嵌套结构变化、条件表达式、动态模板字符串或逻辑重构，自动触发代码合并模块（`claudeMerge.ts`），利用结构化补丁（JSON Schema）安全应用修改。

### (2) Code → Canvas（代码向画布流动）
- 用户在本地 VS Code 或外部编辑器修改代码并保存。
- 本地文件监听器捕获文件变动，触发沙箱内的 HMR 热更新。
- 画布沙箱就地重载该组件模块，扁平 AST Store（`ensureV2.ts`）自动比对并刷新选区与属性覆盖层，用户无需刷新整个页面。

---

## 4. AI Agent 原生协同设计

不同于普通设计工具将 AI 视为边缘的“生成插画”或“生成文案”工具，Lunagraph 将整个画布设计为 **AI 友好的操作界面**：
1. **结构化读写（JSX-First）**：AI 可以通过 `canvas_read` 获得干净、规范的 JSX 结构树，通过 `canvas_edit` 发送类似查找替换（`old_string` / `new_string`）的精细补丁。
2. **并发互斥机制（Claim Locks）**：多 Agent 或人机并发协同场景下，AI 在动任何元素之前必须先调用 `canvas_claim` 申请锁定，防止协同冲突。
3. **视觉闭环验收（Self-Critique Loop）**：AI 修改完成后，系统在协议层面强制要求其必须调用 `take_screenshot` 进行多模态视觉验收，确认无布局坍塌后方允许调用 `canvas_release` 释放锁。
