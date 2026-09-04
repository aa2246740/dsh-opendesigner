# dsh-opendesigner

> **An open-source, multi-model, local-first visual React component designer for DeepSeek Harness.**  
> 致力于打破 Lunagraph 的 Claude 闭源绑定，提供完全自主、本地优先、无缝 Git 协作的视觉化代码设计器。

---

## 🌟 核心理念与技术哲学

1. **Zero Handoff（代码即画布）**：
   画布中呈现的是真实的 React 19 节点与 Tailwind CSS 样式，而非基于 SVG/Canvas 的矢量模拟。所见即所写，所改即所得。
2. **双层往返编译（Round-trip Surgical Codegen）**：
   - **Tier 1 确定性 AST 切片（Deterministic Slicing）**：修改类名（Tailwind Token）和行内样式时，基于 Babel AST 定位并在源码字节偏移处就地替换，零 AI 延迟、零 Token 消耗、100% 保持源码格式与注释。
   - **Tier 2 AI 结构化合并（AI Merge）**：对于包含复杂逻辑、Hooks、动态表达式的重构，由多模型以 JSON Schema 补丁形式精准合成源码。
3. **DeepSeek Harness 原生驱动**：
   作为 DSH 的独立插件系统运行，支持 Cordis 依赖注入与生命周期管理，Web 客户端采用动态模块加载机制。
4. **多模型自由适配（Decoupled Any-Model Layer）**：
   解除官方仅绑定 Claude 的限制，原生支持 DeepSeek-V3 / R1、OpenAI GPT-4o、本地 Ollama/vLLM 以及自定义 API 端点。
5. **本地优先与纯粹的 Git 协同（Local-First & Git-Native）**：
   不依赖任何云端数据库，画布状态与项目源码完全存储于本地磁盘，版本控制由本地 Git 原生驱动。

---

## 📚 深度逆向技术全书与设计规范 (`docs/`)

本项目基于对 Lunagraph 客户端与编译器源码的完整逆向工程，建立了体系化的技术文档库：

- [01. 总体架构与设计心智模型](./docs/01-architecture-and-mental-model.md)
- [02. 本地 MCP 服务端与全量 38 个工具协议规约](./docs/02-mcp-protocol-and-38-tools.md)
- [03. 双层代码编译器与 AST 就地切片修改机制](./docs/03-ast-compiler-and-codegen.md)
- [04. 关系型扁平组件状态库 (Flat Store) 规范](./docs/04-flat-store-specification.md)
- [05. 无限画布几何变换、6线智能吸附与多选缩放算法](./docs/05-canvas-geometry-and-interaction.md)
- [06. Figma Kiwi 二进制剪贴板协议解析与 Tailwind 映射](./docs/06-figma-clipboard-engine.md)
- [07. 浏览器端 Next.js 离线沙箱与 next-shims 垫片解析](./docs/07-runtime-sandbox-and-next-shims.md)
- [08. 基于 DeepSeek Harness 的系统重写与模块落地蓝图](./docs/08-dsh-rewrite-blueprint.md)

---

## 🏗️ 目录拓扑

```tree
dsh-opendesigner/
├── docs/                        # 完整逆向全书与规范文档 (8篇)
├── src/
│   ├── compiler/                # Babel AST 切片修改与代码合并引擎
│   ├── store/                   # 关系型扁平 AST 状态树 (byId / 索引模型)
│   ├── server/                  # DSH 后端服务与 MCP 38 个工具适配器
│   └── client/                  # DSH Web Client 画布视图与交互面板
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛡️ 环境安全承诺

本项目为完全自包含的独立仓库，遵循极简与隔离设计，运行与构建过程中严格限定在当前工程目录内，不侵入、不干扰宿主环境中的其他系统服务或现有应用。
