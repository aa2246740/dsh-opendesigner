/**
 * 完整对齐官方 38 个 MCP 工具的目录与 Schema 定义
 */

export interface MCPToolDefinition {
  name: string;
  description: string;
  category: "project" | "local" | "canvas" | "design" | "skills";
  destructive?: boolean;
}

export const OPEN_DESIGNER_TOOLS: MCPToolDefinition[] = [
  // 类别 1: Project Tools (10)
  { name: "project_list", description: "列出当前打开的工程列表", category: "project" },
  { name: "project_pick", description: "绑定当前 MCP 会话到指定工程", category: "project" },
  { name: "project_read", description: "读取工程源码文件，支持行号与切片", category: "project" },
  { name: "project_glob", description: "根据 Glob 模式匹配工程内文件", category: "project" },
  { name: "project_grep", description: "在工程源码中执行正则搜索", category: "project" },
  { name: "project_write", description: "创建或覆盖工程文件", category: "project", destructive: true },
  { name: "project_write_batch", description: "批量创建工程代码文件", category: "project", destructive: true },
  { name: "project_edit", description: "针对工程代码文件进行字符串替换", category: "project", destructive: true },
  { name: "project_delete", description: "删除工程文件", category: "project", destructive: true },
  { name: "project_copy_asset", description: "复制二进制静态图片资源", category: "project", destructive: true },

  // 类别 2: Local Filesystem Tools (7)
  { name: "local_read", description: "读取宿主本地磁盘文件", category: "local" },
  { name: "local_read_batch", description: "批量读取宿主本地文件", category: "local" },
  { name: "local_write", description: "写入宿主本地代码文件", category: "local", destructive: true },
  { name: "local_edit", description: "修改宿主本地文件内容", category: "local", destructive: true },
  { name: "local_glob", description: "在宿主本地匹配文件路径", category: "local" },
  { name: "local_grep", description: "在宿主本地搜索正则内容", category: "local" },
  { name: "scan_project", description: "扫描本地 React 仓库并提取组件元信息", category: "local" },

  // 类别 3: Canvas Direct Tools (13)
  { name: "canvas_list", description: "列出工程中所有的画布页面", category: "canvas" },
  { name: "canvas_create_page", description: "创建空白画布页面", category: "canvas" },
  { name: "canvas_read", description: "以结构化 JSX 形式读取画布节点并计算 covering_hash", category: "canvas" },
  { name: "canvas_claim", description: "并发排他锁：锁定目标元素，下发 claim_id (TTL 300s)", category: "canvas" },
  { name: "canvas_release", description: "释放排他锁，校验视觉验收是否达成", category: "canvas" },
  { name: "canvas_add", description: "向当前画布插入新 JSX 元素", category: "canvas" },
  { name: "canvas_update", description: "整体替换被锁定的元素 JSX", category: "canvas" },
  { name: "canvas_edit", description: "对画布元素 JSX 进行精细字符串替换", category: "canvas" },
  { name: "canvas_insert", description: "插入兄弟节点或子节点", category: "canvas" },
  { name: "canvas_delete", description: "删除指定的画布元素", category: "canvas" },
  { name: "canvas_grep", description: "在画布 JSX 内容中正则搜索", category: "canvas" },
  { name: "canvas_query", description: "使用 CSS 选择器语法查询画布节点", category: "canvas" },
  { name: "canvas_create_import_scaffold", description: "生成设计系统导入参考页脚手架", category: "canvas" },

  // 类别 4: Design & Theme Tools (6)
  { name: "get_theme", description: "提取 Tailwind 变量与设计系统 Token", category: "design" },
  { name: "get_design_context", description: "一键打包获取主题、组件目录与画布摘要", category: "design" },
  { name: "search_components", description: "按名称与 Props 搜索工程组件", category: "design" },
  { name: "search_icons", description: "检索项目可用图标名称", category: "design" },
  { name: "set_icon_library", description: "配置项目图标库", category: "design", destructive: true },
  { name: "take_screenshot", description: "对目标画布元素离屏截图并返回 base64 PNG", category: "design" },

  // 类别 5: Skills Tools (2)
  { name: "list_skills", description: "列出当前可用的工作流设计技能", category: "skills" },
  { name: "read_skill", description: "读取设计规范技能规约正文", category: "skills" }
];
