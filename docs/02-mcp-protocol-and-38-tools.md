> **Status.** Historical notes. Not the shipped product spec. Do not use this file as an implementation checklist. Do not extend reverse-engineered protocol detail from it. See [README](../README.md) and [SHIPPED.md](./SHIPPED.md).

# 02. 本地 MCP 服务端与全量 38 个工具协议规约

---

## 1. 通信架构与网络拓扑

Lunagraph 在主进程中启动了一个原生的 HTTP MCP 服务端（`src/main/mcpServer.ts`）：
- **绑定地址**：`127.0.0.1`（严格限制在环回接口，拒绝外部网络直接连入）
- **监听端口**：默认 `21209`（主域名规则包含 `lunagraph.com` 时），内网开发环境为 `23563`。
- **协议版本**：`2024-11-05`
- **能力宣告 (Capabilities)**：
  ```json
  {
    "capabilities": {
      "tools": {}
    }
  }
  ```
  *(注意：官方服务端未宣告 prompts 与 resources 能力，所有交互完全通过 Tools 驱动)*。

### 路由定义
1. `GET /health`：存活探针，返回 HTTP 200。
2. `POST /mcp`：外部通用 MCP 接入端点（Cursor / Claude Desktop / 自定义客户端）。
   - **必需请求头**：`Mcp-Session-Id: <UUIDv4>`
   - 外部会话初始处于未绑定状态，必须首先调用 `project_list` 和 `project_pick` 绑定目标工程。
3. `POST /mcp/:projectId?chatTab=:chatTabId`：客户端内置 AI 聊天专用通道。
   - 显式通过 URL 路径与 Query 参数绑定当前工程与聊天会话 Tab，省去外部选工程环节。

---

## 2. 握手与动态上下文注入 (Handshake & Instructions)

在处理客户端发起的 `method: "initialize"` 请求时，服务端除了常规协议握手，还会调用 `buildMcpServerInstructions` 动态构建全局系统指令：

```markdown
# 动态注入的全局 Rules 摘要
1. Call `read_skill({ name: "opendesigner-design" })` before canvas mutations in this plugin. Historical Lunagraph skill names are not used.
2. 注入当前项目 CSS 变量与设计令牌摘要（提取自 globals.css）：包含色彩系统、Radius、阴影规范等。
3. 并发锁定规约：严禁在未成功取得 canvas_claim 锁的情况下调用 canvas_edit / canvas_update。
4. 视觉验收闭环：每次完成画布编辑后，必须调用 take_screenshot 自检，否则 canvas_release 将拒绝释放锁。
```

---

## 3. 全量 38 个工具分类详查表

### 类别 1：工程文件与资源管理（Project Tools，10 个）

| 工具名称 | 参数 Schema | 返回格式 | 核心逻辑与用途 |
|---|---|---|---|
| `project_list` | `{}` | `string`（多行工程列表，含 ID 与 Name） | 列出当前客户端内打开的所有工程。 |
| `project_pick` | `projectId: string` | `{ success: boolean }` | 将当前 MCP Session 绑定到指定工程，解锁后续操作。 |
| `project_read` | `path: string, offset?: number, limit?: number` | `{ content: string, totalLines: number }` | 读取工程文件内容，附带行号，支持大文件切片读取。 |
| `project_glob` | `pattern: string` | `{ matches: string[] }` | 根据 Glob 模式匹配工程内的文件路径。 |
| `project_grep` | `pattern: string, pathPrefix?: string` | `{ matches: { path: string, line: number, text: string }[] }` | 在工程源码中执行正则检索，支持上下文行展开。 |
| `project_write` | `path: string, content: string` | `{ success: boolean }` | 覆写或新建工程文件（属于破坏性工具，受审批拦截）。 |
| `project_write_batch` | `files: { path: string, content: string }[]` | `{ written: string[] }` | 批量快速创建新代码文件，用于脚手架导入。 |
| `project_edit` | `path: string, old_string: string, new_string: string, replace_all?: boolean` | `{ success: boolean }` | 基于唯一字符串匹配替换，精准就地修改代码。 |
| `project_delete` | `path: string` | `{ success: boolean }` | 删除工程内指定文件（破坏性工具）。 |
| `project_copy_asset` | `sourcePath: string, targetPath: string` | `{ success: boolean }` | 复制二进制图片、字体等静态资源至工程公共目录。 |

### 类别 2：宿主本地磁盘文件穿透（Local Filesystem Tools，7 个）

为支持从宿主已有 React/Next.js 代码库导入组件，提供了带白名单校验的本地磁盘操作工具：

| 工具名称 | 核心功能 | 安全控制机制 |
|---|---|---|
| `local_read` / `local_read_batch` | 读取宿主本地磁盘文件（1-10个） | 受 `isExistingPathAllowed` 路径访问权限拦截。 |
| `local_write` / `local_edit` | 写入或修改宿主本地代码文件 | 属于 `DESTRUCTIVE_TOOLS`，触发系统授权弹窗。 |
| `local_glob` / `local_grep` | 在宿主本地磁盘上执行模式查找与内容检索 | 只能在经用户明确授权的根目录下执行。 |
| `scan_project` | 扫描本地 React 代码库元信息 | 自动解析 `package.json`、Tailwind 配置、图标库及组件导出清单。 |

### 类别 3：画布直接控制与操作（Canvas Direct Tools，13 个）

这是 Lunagraph 视觉交互的核心资产：

| 工具名称 | 输入规约 | 核心作用与行为特征 |
|---|---|---|
| `canvas_list` | `{}` | 列出当前工程所有画布页面、页面 ID、当前焦点页。 |
| `canvas_create_page` | `name: string` | 创建全新空白画布页面，并将其设为当前活动画布。 |
| `canvas_read` | `elementId?: string, pageId?: string` | 以标准化结构化 JSX 形式读取画布节点，同时计算并返回 `covering_hash`。 |
| `canvas_claim` | `elementId: string, covering_hash: string` | **排他并发锁**。校验覆盖哈希确保读取未过期，下发 `claim_id`，启动 300 秒超时倒计时。 |
| `canvas_release` | `claim_id: string` | **释放排他锁**。若该元素被修改过但未调用 `take_screenshot` 视觉验收，直接拒绝释放！ |
| `canvas_add` | `jsx: string, parentId?: string` | 将新 JSX 代码解析后插入画布指定容器中。 |
| `canvas_update` | `claim_id: string, elementId: string, jsx: string` | 整体替换已被锁定的元素 JSX 结构。 |
| `canvas_edit` | `claim_id: string, elementId: string, old_string: string, new_string: string` | 对目标元素进行外科手术式字符串微调。 |
| `canvas_insert` | `claim_id: string, targetId: string, position: "before" \| "after" \| "append", jsx: string` | 插入兄弟或子节点，无需重写整个父容器。 |
| `canvas_delete` | `claim_id: string, elementId: string` | 删除画布指定元素（必须持有该元素或父级的锁）。 |
| `canvas_grep` | `pattern: string` | 在当前画布的 JSX 文本中进行正则搜索，返回匹配的 elementId。 |
| `canvas_query` | `selector: string` | 按 CSS 选择器/组件名语法（如 `Card Button`）快速定位画布元素。 |
| `canvas_create_import_scaffold` | `{}` | 自动构建设计系统导入参考页（左栏主题色卡与 Typography，右栏组件容器）。 |

### 类别 4：设计上下文与视觉探查（Design & Theme Tools，6 个）

| 工具名称 | 功能描述 |
|---|---|
| `get_theme` | 提取当前工程的 Tailwind 全局 Token（CSS 变量、颜色映射、Radius、Shadows）。 |
| `get_design_context` | 一键打包获取项目主题、注册组件清单以及当前画布摘要，AI 初始化会话的首选工具。 |
| `search_components` | 按名称检索工程中可用的 React 组件、Props 参数说明与样例代码。 |
| `search_icons` | 检索当前工程配置的图标库（如 Phosphor、Lucide），返回合法图标名。 |
| `set_icon_library` | 切换或绑定工程所使用的图标库。 |
| `take_screenshot` | 针对指定画布元素进行高保真离屏渲染截图，返回 Base64 编码的 PNG，闭环驱动视觉校验。 |

### 类别 5：工作流技能体系（Skills Tools，2 个）

| 工具名称 | 功能描述 |
|---|---|
| `list_skills` | 列出内置工作流技能（现为 `opendesigner-design`, `opendesigner-import-from-project`, `opendesigner-compositions`）。 |
| `read_skill` | 读取指定技能的 Markdown 说明文档，指导 Agent 按照系统最佳实践进行布局与代码生成。 |

---

## 4. 并发控制与锁生命周期状态机 (The Claim-Lock State Machine)

Lunagraph 在高频人机协同中采用了严格的状态机机制：

```
                 ┌─────────────────────────────┐
                 │         未锁定状态           │
                 └──────────────┬──────────────┘
                                │
                  调用 canvas_read(elementId)
                  获取 covering_hash
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │       已读取，准备申请锁      │
                 └──────────────┬──────────────┘
                                │
                  调用 canvas_claim(elementId, hash)
                                │
               ┌────────────────┴────────────────┐
        [Hash 校验失败]                   [Hash 校验成功]
               │                                 │
        抛出 STALE_READ 错误              下发 claim_id
                                          启动 300s TTL 定时器
                                          渲染层高亮显示锁定边框与操作者
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │      持有排他锁 (Claimed)    │
                                  └──────────────┬──────────────┘
                                                 │
                                    调用 canvas_edit / update
                                    标记 mutated = true
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │    已修改，锁定中 (Mutated)   │
                                  └──────────────┬──────────────┘
                                                 │
                                      直接调用 canvas_release?
                                                 │
                                 ┌───────────────┴───────────────┐
                          【拒绝释放】                     【允许释放】
                   若 verified == false            必须先调用 take_screenshot()
                   报错: 需要视觉自省验收           将 verified 标记为 true
                                                           │
                                                           ▼
                                            ┌─────────────────────────────┐
                                            │     释放锁，广播更新事件      │
                                            └─────────────────────────────┘
```

---

## 5. 破坏性操作安全防御（Approval Gate）

在 `mcpServer.ts` 中，对可能造成磁盘损失的工具设置了拦截清单：
```typescript
const DESTRUCTIVE_TOOLS = new Set([
  "project_write", "project_write_batch", "project_edit",
  "project_delete", "project_copy_asset", "local_write",
  "local_edit", "set_icon_library"
]);
```
- **外部客户端调用行为**：外部 Agent 调用此类工具时，服务端不会立即执行，而是生成 `approvalId`，向渲染层发送 IPC 通知，并在 macOS 系统发出提醒。
- **超时机制**：若用户未在 120 秒内点击“允许”，调用自动中止并返回超时错误。
- **社区版优化建议**：在 `dsh-opendesigner` 中，应提供白名单目录配置或会话级免确认（`auto-approve`）开关，避免外部自动化工作流因等待弹窗而挂死。
