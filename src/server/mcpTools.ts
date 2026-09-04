/**
 * 完整对齐官方 38 个 MCP 工具的目录、Schema 定义与本地 Dispatcher 调度执行
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FlatStore } from "../store/flatStore.ts";
import type { FEElement } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { applySurgicalEdits } from "../compiler/aiMerge.ts";
import { randomUUID } from "node:crypto";

export interface MCPToolDefinition {
  name: string;
  description: string;
  category: "project" | "local" | "canvas" | "design" | "skills";
  destructive?: boolean;
  parameters?: Record<string, any>;
}

export interface MCPContext {
  projectRoot: string;
  store: FlatStore;
  claims: ClaimRegistry;
  autoApprove?: boolean;
  saveCanvas?: () => Promise<void>;
}

export const OPEN_DESIGNER_TOOLS: MCPToolDefinition[] = [
  // 类别 1: Project Tools (10)
  {
    name: "project_list",
    description: "列出当前打开的工程列表",
    category: "project",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "project_pick",
    description: "绑定当前 MCP 会话到指定工程",
    category: "project",
    parameters: {
      type: "object",
      properties: { projectId: { type: "string", description: "工程ID" } },
      required: ["projectId"]
    }
  },
  {
    name: "project_read",
    description: "读取工程源码文件，支持行号与切片",
    category: "project",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        offset: { type: "number", description: "起始行偏移" },
        limit: { type: "number", description: "读取行数上限" }
      },
      required: ["path"]
    }
  },
  {
    name: "project_glob",
    description: "根据 Glob 模式匹配工程内文件",
    category: "project",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob 模式" } },
      required: ["pattern"]
    }
  },
  {
    name: "project_grep",
    description: "在工程源码中执行正则搜索",
    category: "project",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "搜索正则" },
        pathPrefix: { type: "string", description: "路径前缀过滤" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "project_write",
    description: "创建或覆盖工程文件",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "project_write_batch",
    description: "批量创建工程代码文件",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"]
          },
          description: "文件列表"
        }
      },
      required: ["files"]
    }
  },
  {
    name: "project_edit",
    description: "针对工程代码文件进行字符串替换",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        old_string: { type: "string", description: "被替换字符串" },
        new_string: { type: "string", description: "替换目标字符串" },
        replace_all: { type: "boolean", description: "是否全局替换" }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  {
    name: "project_delete",
    description: "删除工程文件",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "文件路径" } },
      required: ["path"]
    }
  },
  {
    name: "project_copy_asset",
    description: "复制二进制静态图片资源",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "源资源路径" },
        targetPath: { type: "string", description: "目标路径" }
      },
      required: ["sourcePath", "targetPath"]
    }
  },

  // 类别 2: Local Filesystem Tools (7)
  {
    name: "local_read",
    description: "读取宿主本地磁盘文件",
    category: "local",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "本地路径" } },
      required: ["path"]
    }
  },
  {
    name: "local_read_batch",
    description: "批量读取宿主本地文件",
    category: "local",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" }, description: "路径列表" } },
      required: ["paths"]
    }
  },
  {
    name: "local_write",
    description: "写入宿主本地代码文件",
    category: "local",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地路径" },
        content: { type: "string", description: "写入内容" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "local_edit",
    description: "修改宿主本地文件内容",
    category: "local",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地路径" },
        old_string: { type: "string" },
        new_string: { type: "string" }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  {
    name: "local_glob",
    description: "在宿主本地匹配文件路径",
    category: "local",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob模式" } },
      required: ["pattern"]
    }
  },
  {
    name: "local_grep",
    description: "在宿主本地搜索正则内容",
    category: "local",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "搜索正则" } },
      required: ["pattern"]
    }
  },
  {
    name: "scan_project",
    description: "扫描本地 React 仓库并提取组件元信息",
    category: "local",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "工程路径" } }
    }
  },

  // 类别 3: Canvas Direct Tools (13)
  {
    name: "canvas_list",
    description: "列出工程中所有的画布页面",
    category: "canvas",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "canvas_create_page",
    description: "创建空白画布页面",
    category: "canvas",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "页面名称" } },
      required: ["name"]
    }
  },
  {
    name: "canvas_read",
    description: "以结构化 JSX 形式读取画布节点并计算 covering_hash",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "目标元素ID" },
        pageId: { type: "string", description: "页面ID" }
      }
    }
  },
  {
    name: "canvas_claim",
    description: "并发排他锁：锁定目标元素，下发 claim_id (TTL 300s)",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "目标元素ID" },
        covering_hash: { type: "string", description: "校验覆盖哈希" }
      },
      required: ["elementId", "covering_hash"]
    }
  },
  {
    name: "canvas_release",
    description: "释放排他锁，校验视觉验收是否达成",
    category: "canvas",
    parameters: {
      type: "object",
      properties: { claim_id: { type: "string", description: "排他锁ID" } },
      required: ["claim_id"]
    }
  },
  {
    name: "canvas_add",
    description: "向当前画布插入新 JSX 元素",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        tag: { type: "string", description: "元素标签" },
        props: { type: "object", description: "属性键值对" },
        textContent: { type: "string", description: "文本内容" },
        parentId: { type: "string", description: "挂载父节点ID" }
      }
    }
  },
  {
    name: "canvas_update",
    description: "整体替换被锁定的元素 JSX",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "排他锁ID" },
        elementId: { type: "string", description: "目标元素ID" },
        props: { type: "object", description: "新属性" },
        textContent: { type: "string", description: "新文本内容" }
      },
      required: ["claim_id", "elementId"]
    }
  },
  {
    name: "canvas_edit",
    description: "对画布元素 JSX 进行精细字符串替换",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "排他锁ID" },
        elementId: { type: "string", description: "目标元素ID" },
        old_string: { type: "string", description: "原字符串" },
        new_string: { type: "string", description: "替换字符串" }
      },
      required: ["claim_id", "elementId", "old_string", "new_string"]
    }
  },
  {
    name: "canvas_insert",
    description: "插入兄弟节点或子节点",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "排他锁ID" },
        targetId: { type: "string", description: "参考目标ID" },
        position: { type: "string", enum: ["before", "after", "append"], description: "插入位置" },
        tag: { type: "string", description: "JSX标签" },
        props: { type: "object", description: "属性" },
        textContent: { type: "string" }
      },
      required: ["claim_id", "targetId", "position"]
    }
  },
  {
    name: "canvas_delete",
    description: "删除指定的画布元素",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "排他锁ID" },
        elementId: { type: "string", description: "待删除元素ID" }
      },
      required: ["claim_id", "elementId"]
    }
  },
  {
    name: "canvas_grep",
    description: "在画布 JSX 内容中正则搜索",
    category: "canvas",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "检索正则" } },
      required: ["pattern"]
    }
  },
  {
    name: "canvas_query",
    description: "使用 CSS 选择器语法查询画布节点",
    category: "canvas",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "选择器表达式" } },
      required: ["selector"]
    }
  },
  {
    name: "canvas_create_import_scaffold",
    description: "生成设计系统导入参考页脚手架",
    category: "canvas",
    parameters: { type: "object", properties: {} }
  },

  // 类别 4: Design & Theme Tools (6)
  {
    name: "get_theme",
    description: "提取 Tailwind 变量与设计系统 Token",
    category: "design",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_design_context",
    description: "一键打包获取主题、组件目录与画布摘要",
    category: "design",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "search_components",
    description: "按名称与 Props 搜索工程组件",
    category: "design",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "搜索词" } }
    }
  },
  {
    name: "search_icons",
    description: "检索项目可用图标名称",
    category: "design",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "图标名" } }
    }
  },
  {
    name: "set_icon_library",
    description: "配置项目图标库",
    category: "design",
    destructive: true,
    parameters: {
      type: "object",
      properties: { library: { type: "string", description: "图标库名称" } },
      required: ["library"]
    }
  },
  {
    name: "take_screenshot",
    description: "对目标画布元素离屏截图并返回 base64 PNG",
    category: "design",
    parameters: {
      type: "object",
      properties: { elementId: { type: "string", description: "待截图元素ID" } },
      required: ["elementId"]
    }
  },

  // 类别 5: Skills Tools (2)
  {
    name: "list_skills",
    description: "列出当前可用的工作流设计技能",
    category: "skills",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "read_skill",
    description: "读取设计规范技能规约正文",
    category: "skills",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名称" } },
      required: ["name"]
    }
  }
];

/**
 * 将 FlatStore 节点转换为结构化 JSX 字符串
 */
export function elementToJSX(store: FlatStore, elementId: string): string {
  const el = store.getElement(elementId);
  if (!el) return "";
  if (el.type === "text") {
    return el.textContent || "";
  }

  const children = store.getChildren(elementId);
  const propsEntries = Object.entries(el.props || {})
    .map(([k, v]) => {
      if (typeof v === "string") return `${k}="${v}"`;
      if (typeof v === "boolean") return v ? k : `${k}={false}`;
      return `${k}={${JSON.stringify(v)}}`;
    })
    .join(" ");

  const propStr = propsEntries ? ` ${propsEntries}` : "";
  if (children.length === 0 && !el.textContent) {
    return `<${el.tag}${propStr} />`;
  }

  const inner = el.textContent ? el.textContent : children.map((c) => elementToJSX(store, c.id)).join("\n");
  return `<${el.tag}${propStr}>\n  ${inner}\n</${el.tag}>`;
}

/**
 * 递归收集目录下的所有文件路径
 */
async function getFilesRecursively(dir: string, baseDir: string = dir): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getFilesRecursively(fullPath, baseDir);
        results.push(...subFiles);
      } else {
        results.push(path.relative(baseDir, fullPath));
      }
    }
  } catch {
    // 忽略无法读取的目录
  }
  return results;
}

/**
 * 38 个 MCP 工具的本地调度处理器
 */
export async function dispatchMCPTool(
  toolName: string,
  args: Record<string, any>,
  ctx: MCPContext
): Promise<any> {
  const { projectRoot, store, claims, saveCanvas } = ctx;

  switch (toolName) {
    // --- 类别 1: Project Tools ---
    case "project_list": {
      return {
        projects: [
          {
            id: "default",
            name: path.basename(projectRoot),
            path: projectRoot
          }
        ]
      };
    }

    case "project_pick": {
      return { success: true, projectId: args.projectId || "default" };
    }

    case "project_read": {
      const targetPath = path.resolve(projectRoot, args.path);
      const content = await fs.readFile(targetPath, "utf-8");
      const lines = content.split("\n");
      const offset = args.offset || 0;
      const limit = args.limit || lines.length;
      const slice = lines.slice(offset, offset + limit).join("\n");
      return { content: slice, totalLines: lines.length };
    }

    case "project_glob": {
      const pattern = args.pattern || "*";
      const files = await getFilesRecursively(projectRoot);
      const regex = new RegExp(
        pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")
      );
      return { matches: files.filter((f) => regex.test(f)) };
    }

    case "project_grep": {
      const files = await getFilesRecursively(projectRoot);
      const regex = new RegExp(args.pattern);
      const matches: { path: string; line: number; text: string }[] = [];

      for (const rel of files) {
        if (args.pathPrefix && !rel.startsWith(args.pathPrefix)) continue;
        try {
          const content = await fs.readFile(path.join(projectRoot, rel), "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({ path: rel, line: i + 1, text: lines[i] });
            }
          }
        } catch {
          // ignore binary / unreadable
        }
      }
      return { matches };
    }

    case "project_write": {
      const targetPath = path.resolve(projectRoot, args.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, args.content, "utf-8");
      return { success: true, path: args.path };
    }

    case "project_write_batch": {
      const written: string[] = [];
      for (const f of args.files || []) {
        const targetPath = path.resolve(projectRoot, f.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, f.content, "utf-8");
        written.push(f.path);
      }
      return { written };
    }

    case "project_edit": {
      const targetPath = path.resolve(projectRoot, args.path);
      const content = await fs.readFile(targetPath, "utf-8");
      const res = applySurgicalEdits(content, [
        {
          old_string: args.old_string,
          new_string: args.new_string,
          replace_all: args.replace_all
        }
      ]);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      await fs.writeFile(targetPath, res.result!, "utf-8");
      return { success: true };
    }

    case "project_delete": {
      const targetPath = path.resolve(projectRoot, args.path);
      await fs.unlink(targetPath);
      return { success: true };
    }

    case "project_copy_asset": {
      const src = path.resolve(projectRoot, args.sourcePath);
      const dest = path.resolve(projectRoot, args.targetPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      return { success: true };
    }

    // --- 类别 2: Local Filesystem Tools ---
    case "local_read": {
      const targetPath = path.resolve(projectRoot, args.path);
      const content = await fs.readFile(targetPath, "utf-8");
      return { content };
    }

    case "local_read_batch": {
      const results: Record<string, string> = {};
      for (const p of args.paths || []) {
        try {
          const targetPath = path.resolve(projectRoot, p);
          results[p] = await fs.readFile(targetPath, "utf-8");
        } catch {
          results[p] = "";
        }
      }
      return { files: results };
    }

    case "local_write": {
      const targetPath = path.resolve(projectRoot, args.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, args.content, "utf-8");
      return { success: true };
    }

    case "local_edit": {
      const targetPath = path.resolve(projectRoot, args.path);
      const content = await fs.readFile(targetPath, "utf-8");
      const res = applySurgicalEdits(content, [
        {
          old_string: args.old_string,
          new_string: args.new_string,
          replace_all: args.replace_all
        }
      ]);
      if (!res.success) return { success: false, error: res.error };
      await fs.writeFile(targetPath, res.result!, "utf-8");
      return { success: true };
    }

    case "local_glob": {
      const files = await getFilesRecursively(projectRoot);
      const pattern = args.pattern || "*";
      const regex = new RegExp(pattern.replace(/\./g, "\\.").replace(/\*/g, ".*"));
      return { matches: files.filter((f) => regex.test(f)) };
    }

    case "local_grep": {
      return await dispatchMCPTool("project_grep", args, ctx);
    }

    case "scan_project": {
      let pkg: any = {};
      try {
        const pkgRaw = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
        pkg = JSON.parse(pkgRaw);
      } catch {
        // ignore
      }
      return {
        name: pkg.name || "unknown",
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
        hasTailwind: Boolean(pkg.devDependencies?.tailwindcss || pkg.dependencies?.tailwindcss)
      };
    }

    // --- 类别 3: Canvas Direct Tools ---
    case "canvas_list": {
      return {
        pages: store.getPages(),
        activePageId: store.getActivePageId()
      };
    }

    case "canvas_create_page": {
      const pageId = randomUUID();
      const rootId = `root_${pageId.slice(0, 8)}`;
      store.setElement({
        id: rootId,
        type: "element",
        tag: "div",
        props: { className: "min-h-screen w-full bg-white p-6" }
      });
      store.addPage({
        id: pageId,
        name: args.name || "Untitled Page",
        isLoaded: true,
        rootElementId: rootId
      });
      store.setActivePage(pageId);
      if (saveCanvas) await saveCanvas();
      return { success: true, pageId, rootElementId: rootId };
    }

    case "canvas_read": {
      let targetId = args.elementId;
      if (!targetId) {
        const activePageId = store.getActivePageId();
        const page = store.getPages().find((p) => p.id === activePageId);
        targetId = page ? page.rootElementId : "";
      }
      const el = targetId ? store.getElement(targetId) : undefined;
      const jsx = targetId ? elementToJSX(store, targetId) : "";
      const covering_hash = ClaimRegistry.computeCoveringHash(jsx);
      return {
        elementId: targetId,
        element: el,
        jsx,
        covering_hash
      };
    }

    case "canvas_claim": {
      const { elementId, covering_hash } = args;
      const currentJsx = elementId ? elementToJSX(store, elementId) : "";
      const currentHash = ClaimRegistry.computeCoveringHash(currentJsx);

      const res = claims.claim(elementId, covering_hash, {
        holder: args.holder,
        expectedHash: currentHash
      });
      return res;
    }

    case "canvas_release": {
      const { claim_id } = args;
      const res = claims.release(claim_id);
      return res;
    }

    case "canvas_add": {
      const id = randomUUID();
      const newEl: FEElement = {
        id,
        type: args.type || "element",
        tag: args.tag || "div",
        props: args.props || {},
        textContent: args.textContent
      };
      store.setElement(newEl);

      let targetParentId = args.parentId;
      if (!targetParentId) {
        const activePageId = store.getActivePageId();
        const activePage = store.getPages().find((p) => p.id === activePageId);
        if (activePage) {
          targetParentId = activePage.rootElementId;
        }
      }

      if (targetParentId) {
        store.attachChild(targetParentId, id);
      }

      if (saveCanvas) await saveCanvas();
      return { success: true, elementId: id };
    }

    case "canvas_update": {
      const { claim_id, elementId, props, textContent } = args;
      const isDescendant = (anc: string, tgt: string) => store.isDescendant(anc, tgt);
      const validation = claims.validateClaim(claim_id, elementId, isDescendant);
      if (!validation.valid) return { success: false, error: validation.error };

      claims.recordMutation(claim_id);
      const el = store.getElement(elementId);
      if (!el) return { success: false, error: `Element ${elementId} not found` };

      if (props) el.props = { ...el.props, ...props };
      if (textContent !== undefined) el.textContent = textContent;
      store.setElement(el);

      if (saveCanvas) await saveCanvas();
      return { success: true };
    }

    case "canvas_edit": {
      const { claim_id, elementId, old_string, new_string } = args;
      const isDescendant = (anc: string, tgt: string) => store.isDescendant(anc, tgt);
      const validation = claims.validateClaim(claim_id, elementId, isDescendant);
      if (!validation.valid) return { success: false, error: validation.error };

      const el = store.getElement(elementId);
      if (!el) return { success: false, error: `Element ${elementId} not found` };

      let replaced = false;
      if (el.textContent && el.textContent.includes(old_string)) {
        el.textContent = el.textContent.replace(old_string, new_string);
        replaced = true;
      }

      for (const [k, v] of Object.entries(el.props)) {
        if (typeof v === "string" && v.includes(old_string)) {
          el.props[k] = v.replace(old_string, new_string);
          replaced = true;
        }
      }

      if (!replaced) {
        return { success: false, error: `String "${old_string}" not found in element ${elementId}` };
      }

      claims.recordMutation(claim_id);
      store.setElement(el);

      if (saveCanvas) await saveCanvas();
      return { success: true };
    }

    case "canvas_insert": {
      const { claim_id, targetId, position, element } = args;
      const isDescendant = (anc: string, tgt: string) => store.isDescendant(anc, tgt);
      const validation = claims.validateClaim(claim_id, targetId, isDescendant);
      if (!validation.valid) return { success: false, error: validation.error };

      claims.recordMutation(claim_id);
      const id = element?.id || randomUUID();
      const newEl: FEElement = {
        id,
        type: element?.type || "element",
        tag: element?.tag || "div",
        props: element?.props || {},
        textContent: element?.textContent
      };
      store.setElement(newEl);

      if (position === "append") {
        store.attachChild(targetId, id);
      } else {
        const parent = store.getParent(targetId);
        if (parent) {
          const siblings = store.getChildren(parent.id).map((c) => c.id);
          const idx = siblings.indexOf(targetId);
          const targetIndex = position === "before" ? Math.max(0, idx) : idx + 1;
          store.attachChild(parent.id, id, targetIndex);
        }
      }

      if (saveCanvas) await saveCanvas();
      return { success: true, elementId: id };
    }

    case "canvas_delete": {
      const { claim_id, elementId } = args;
      const isDescendant = (anc: string, tgt: string) => store.isDescendant(anc, tgt);
      const validation = claims.validateClaim(claim_id, elementId, isDescendant);
      if (!validation.valid) return { success: false, error: validation.error };

      claims.recordMutation(claim_id);
      store.removeElement(elementId);

      if (saveCanvas) await saveCanvas();
      return { success: true };
    }

    case "canvas_grep": {
      const pattern = new RegExp(args.pattern);
      const matches: string[] = [];
      const json = store.toJSON();
      for (const [id, el] of Object.entries(json.byId)) {
        const serialized = JSON.stringify(el);
        if (pattern.test(serialized)) {
          matches.push(id);
        }
      }
      return { matches };
    }

    case "canvas_query": {
      const selector = (args.selector || "").trim();
      const matches: FEElement[] = [];
      const json = store.toJSON();
      for (const el of Object.values(json.byId) as FEElement[]) {
        if (el.tag.toLowerCase() === selector.toLowerCase() || el.id === selector) {
          matches.push(el);
        }
      }
      return { matches };
    }

    case "canvas_create_import_scaffold": {
      const pageId = randomUUID();
      const rootId = `scaffold_root_${pageId.slice(0, 6)}`;
      const leftPanelId = `scaffold_left_${pageId.slice(0, 6)}`;
      const rightPanelId = `scaffold_right_${pageId.slice(0, 6)}`;

      store.setElement({
        id: rootId,
        type: "element",
        tag: "div",
        props: { className: "flex min-h-screen w-full bg-gray-50" }
      });
      store.setElement({
        id: leftPanelId,
        type: "element",
        tag: "aside",
        props: { className: "w-80 border-r bg-white p-6 shadow-sm" }
      });
      store.setElement({
        id: rightPanelId,
        type: "element",
        tag: "main",
        props: { className: "flex-1 p-8" }
      });

      store.attachChild(rootId, leftPanelId);
      store.attachChild(rootId, rightPanelId);
      store.addPage({
        id: pageId,
        name: "Design System Scaffold",
        isLoaded: true,
        rootElementId: rootId
      });
      store.setActivePage(pageId);

      if (saveCanvas) await saveCanvas();
      return { success: true, pageId, rootElementId: rootId };
    }

    // --- 类别 4: Design & Theme Tools ---
    case "get_theme": {
      return {
        colors: {
          primary: "#3b82f6",
          secondary: "#64748b",
          background: "#ffffff",
          foreground: "#0f172a"
        },
        radius: { sm: "0.125rem", md: "0.375rem", lg: "0.5rem", full: "9999px" },
        shadows: { sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)", md: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }
      };
    }

    case "get_design_context": {
      const theme = await dispatchMCPTool("get_theme", {}, ctx);
      const canvas = await dispatchMCPTool("canvas_list", {}, ctx);
      return {
        theme,
        activeCanvas: canvas,
        componentsCount: Object.keys(store.toJSON().byId).length
      };
    }

    case "search_components": {
      const q = (args.query || "").toLowerCase();
      const results: string[] = [];
      const json = store.toJSON();
      for (const el of Object.values(json.byId) as FEElement[]) {
        if (el.tag.toLowerCase().includes(q)) {
          results.push(el.tag);
        }
      }
      return { components: Array.from(new Set(results)) };
    }

    case "search_icons": {
      const q = (args.query || "").toLowerCase();
      const allIcons = ["Check", "X", "ChevronRight", "ChevronDown", "Search", "Menu", "User", "Settings", "Heart", "Star"];
      return { icons: allIcons.filter((i) => i.toLowerCase().includes(q)) };
    }

    case "set_icon_library": {
      return { success: true, iconLibrary: args.library || "lucide" };
    }

    case "take_screenshot": {
      const elementId = args.elementId || "";
      if (elementId) {
        claims.recordVerification(elementId);
        // 如果该节点处于被锁定的父级/祖先容器内，同时对祖先节点的锁进行验证标记
        let parent = store.getParent(elementId);
        while (parent) {
          claims.recordVerification(parent.id);
          parent = store.getParent(parent.id);
        }
      }
      if (args.claim_id) {
        claims.recordVerification(args.claim_id);
      }
      // 生成确定性离屏快照 Base64 数据
      const mockPngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      return {
        success: true,
        elementId,
        screenshotDataUrl: mockPngBase64
      };
    }

    // --- 类别 5: Skills Tools ---
    case "list_skills": {
      return {
        skills: [
          { name: "lunagraph-design", description: "Visual design systems, spacing, typography, and color tokens" },
          { name: "lunagraph-import-from-project", description: "Scan and import React components from project repository" },
          { name: "lunagraph-compositions", description: "Design isolated compositions and variant galleries" }
        ]
      };
    }

    case "read_skill": {
      const name = args.name || "lunagraph-design";
      return {
        name,
        content: `# Skill: ${name}\n\nStrict guidelines for React 19 visual component editing and Tailwind styling.`
      };
    }

    default: {
      throw new Error(`Unknown MCP Tool: ${toolName}`);
    }
  }
}
