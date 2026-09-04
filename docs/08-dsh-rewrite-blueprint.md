# 08. 基于 DeepSeek Harness 的系统重写与模块落地蓝图

---

## 1. 为什么选择 DeepSeek Harness (DSH) 作为重构基座？

Lunagraph 的致命短板在于它的**中心化与单一厂商绑定**：
- 强行绑定 Claude Code CLI 与 Anthropic 订阅体系。
- 画布数据与计费配额绑定在官方云端，无法真正离线、私有化使用。
- 难以融入企业既有的私有模型基础设施与开发流水线。

**DeepSeek Harness (DSH)** 提供了极其出色的现代化 Agent 与扩展架构：
1. **强大的 Cordis 微内核架构**：支持依赖注入、细粒度生命周期管理、插件热插拔。
2. **现代 Web 客户端加载系统**：通过 `__ModuleLoader__` 支持独立前端组件的按需动态装载。
3. **原生多模型 Agent 生态**：天然无缝对接 DeepSeek-V3 / R1、本地模型（Ollama/vLLM）及主流商业大模型。

---

## 2. dsh-opendesigner 架构蓝图

```
+-------------------------------------------------------------------------------+
|                            dsh-opendesigner 架构全景                           |
+-------------------------------------------------------------------------------+
| [DSH Web Client 前端视窗层]                                                   |
| - 导出为 DSH 客户端插件: exports["./client"]                                  |
| - 无限 2D 画布视口 (DOMMatrix 平移/缩放, 6线智能吸附, 8向多选手柄)             |
| - 真实 React 19 组件热渲染沙箱 (内置 next-shims 离线模拟)                      |
| - 样式检查器 (StylesPanel): 布局/边距/填充/色彩/排版/阴影/圆角控制器           |
| - 资产与组件抽取面板: 自动扫描 *.compositions.tsx 生成拖拽图元卡片            |
+-------------------------------------------------------------------------------+
                                        ▲
                                        │ DSH IPC / 内部事件总线 (EventBus)
                                        ▼
+-------------------------------------------------------------------------------+
| [DSH 插件服务核心层 (Cordis Service / Server)]                                |
| - 服务定义: class OpenDesignerService extends Service                         |
| - 本地优先存储引擎 (LocalDiskBackend):                                         |
|     * 画布持久化至当前项目的 .designer/canvas.json                             |
|     * 与本地 Git 工作区 100% 融合，无任何云端数据库外泄                        |
| - 双层代码编译器 (@openluna/compiler):                                         |
|     * Tier 1: sourceEdit.ts (Babel AST 字符串切片就地毫秒级替换)              |
|     * Tier 2: aiMerge.ts (JSON Schema 结构化补丁安全合并)                      |
|     * flatStore.ts (byId 关系型扁平 AST 状态树)                                |
| - 本地 MCP 适配器 (MCP Bridge Service):                                        |
|     * 暴露与官方对齐的标准 38 个工具接口 (canvas_claim, canvas_edit 等)        |
|     * 移除破坏性操作的阻塞式弹窗，支持安全白名单自动化审批                     |
+-------------------------------------------------------------------------------+
                                        ▲
                                        │ OpenAI 规范 / JSON Schema 结构化补丁
                                        ▼
+-------------------------------------------------------------------------------+
| [解耦型多模型网关 (Any-Model AI Gateway)]                                      |
| - 优先驱动: DeepSeek-V3 / DeepSeek-R1                                         |
| - 本地离线: Ollama / vLLM (Qwen 2.5 Coder, Llama 等)                           |
| - 灵活支持: OpenAI GPT-4o, Claude 3.7 Sonnet, xAI Grok                        |
| - 视觉自省机制: Canvas Screenshot 离屏快照 -> 多模态审阅 (Critique Loop)       |
+-------------------------------------------------------------------------------+
```

---

## 3. 核心模块实现规划

### (1) 插件服务声明 (`src/server/index.ts`)
```typescript
import { Context, Service } from "cordis";

export interface OpenDesignerConfig {
  port?: number;
  autoApprove?: boolean;
  modelProvider?: "deepseek" | "openai" | "ollama";
}

export class OpenDesignerService extends Service {
  static inject = ["tools"];

  constructor(ctx: Context, config: OpenDesignerConfig) {
    super(ctx, "openDesigner", true);
    // 1. 初始化本地持久化管理器 (.designer/canvas.json)
    // 2. 注册 38 个 MCP 工具到 DSH tools 服务
    // 3. 启动本地代码切片编译器与监听器
  }
}
```

### (2) 客户端模块加载 (`src/client/index.ts`)
遵循 DSH 客户端规范，编译为标准的客户端 Bundle：
```typescript
// 客户端入口通过 window.__ModuleLoader__ 进行沙箱安全挂载
declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (entry: { id: string; factory: () => unknown }) => void;
    };
  }
}
```

---

## 4. 实施路线图（四阶段交付）

### 阶段 1：核心编译与状态引擎（MVP 基础）
- [x] 完成详尽技术逆向与架构规范编写（`docs/01-08`）。
- [ ] 编写轻量 `sourceEdit.ts`：支持 Babel AST 对类名和行内样式的无损就地替换。
- [ ] 编写 `flatStore.ts`：实现 `byId` 扁平组件关系库与序列化。

### 阶段 2：本地优先 MCP 服务与 DSH 服务端插件
- [ ] 落地 DSH 服务端 Cordis 插件，注册 38 个标准工具（`canvas_claim`, `canvas_edit`, `take_screenshot` 等）。
- [ ] 实现 `.designer/canvas.json` 本地磁盘持久化，消除云端依赖。
- [ ] 集成 DeepSeek-V3 / R1 的 `api` 模式代码合并器（JSON Schema 结构化补丁）。

### 阶段 3：DSH Web Client 视觉画布开发
- [ ] 构建基于 DOMMatrix 仿射变换的无限 2D 画布。
- [ ] 实现 6 线智能吸附（`snapping.ts`）与 8 向手柄伴随缩放（`multiResize.ts`）。
- [ ] 引入 `next-shims` 运行时环境，挂载真实 React 19 组件。

### 阶段 4：生态化与 Build in Public 发布
- [ ] 编写 Figma Kiwi 二进制剪贴板转换器，支持 Figma 一键粘贴。
- [ ] 在 GitHub 开源（MIT 协议），并发布官方演示视频与使用指南。
