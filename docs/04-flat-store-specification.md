> **Status.** Historical notes. Not the shipped product spec. Do not use this file as an implementation checklist. Do not extend reverse-engineered protocol detail from it. See [README](../README.md) and [SHIPPED.md](./SHIPPED.md).

# 04. 关系型扁平组件状态库 (Flat Store) 规范

---

## 1. 核心设计哲理：为什么拒绝深嵌套树？

传统的画布/DOM 编辑器普遍使用嵌套 JSON 树来表达视觉层级：

```json
{
  "id": "root",
  "children": [
    {
      "id": "card",
      "children": [
        { "id": "title", "children": [] },
        { "id": "body", "children": [ ... ] }
      ]
    }
  ]
}
```

这种方式的严重问题：
- **随机读取代价高**：找到 `body` 需要递归遍历整棵树，复杂度 O(n)。
- **并发修改困难**：两个 Agent 分别修改不同深度节点时，JSON 结构 diff 极易冲突。
- **序列化体积膨胀**：每次保存与传输都必须传递完整的嵌套结构。

Lunagraph 采用了**数据库范式的扁平化关系存储模型（Flat Relational AST Store）**，借鉴了关系型数据库的表设计思路。

---

## 2. 数据结构与索引设计 (`ensureV2.ts`)

### 核心字段

```typescript
/** 扁平元素表：ID → 元素对象 */
type FlatStore = {
  /** 主索引：所有元素以 UUID 为键扁平存储 */
  byId: Map<string, FEElement>;

  /** 正向亲子关系：父 ID → 有序子 ID 列表 */
  childrenByParent: Map<string, string[]>;

  /** 反向关系：子 ID → 父 ID */
  parentByChild: Map<string, string>;

  /** 画布页面元数据 */
  pages: PageMeta[];

  /** 当前活跃页面 ID */
  activePageId: string;
};
```

### FEElement 元素核心字段

```typescript
type FEElement = {
  /** 全局唯一标识符 (UUIDv4) */
  id: string;

  /** 元素类型："element" | "text" | "component" | "capture" */
  type: "element" | "text" | "component" | "capture";

  /** HTML 标签名或 React 组件名 */
  tag: string;

  /** JSX 属性映射 (className, style, onClick 等) */
  props: Record<string, unknown>;

  /** 内联文本内容（仅 type === "text" 时使用） */
  textContent?: string;

  /** 画布定位几何（绝对坐标，像素） */
  canvasRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  /** 来源文件与行号信息（用于 Round-trip 定位） */
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
  };

  /** 冻结快照标志：当组件渲染失败时，降级为静态图像 */
  captureDataUrl?: string;
};
```

---

## 3. 关键操作与算法

### (1) 子树提取（Subtree Extraction）

```typescript
function getSubtree(store: FlatStore, rootId: string): FEElement[] {
  const result: FEElement[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const el = store.byId.get(id);
    if (!el) continue;
    result.push(el);
    const children = store.childrenByParent.get(id) ?? [];
    queue.push(...children);
  }
  return result;
}
```

### (2) 安全节点插入

```typescript
function insertChild(
  store: FlatStore,
  parentId: string,
  element: FEElement,
  index?: number
): void {
  // 注册到主索引
  store.byId.set(element.id, element);

  // 维护正向关系
  const siblings = store.childrenByParent.get(parentId) ?? [];
  if (index !== undefined && index >= 0 && index <= siblings.length) {
    siblings.splice(index, 0, element.id);
  } else {
    siblings.push(element.id);
  }
  store.childrenByParent.set(parentId, siblings);

  // 维护反向指针
  store.parentByChild.set(element.id, parentId);
}
```

### (3) 冷冻快照降级（Capture Fallback）

当某组件缺少运行时上下文（如未安装的 npm 依赖、缺失的 Provider Context、或者服务端专属 API 调用）导致渲染引擎崩溃时，系统不会让整个画布瘫痪：

```
  尝试挂载组件 → 渲染失败 → 捕获异常 → 启用 type: "capture" 模式
  → 保留最后一次成功截图的 Base64 DataURL 作为静态占位图
  → 画布继续正常工作，该组件以图片形式临时呈现
  → 用户解决依赖问题后，自动恢复为活组件渲染
```

---

## 4. Store 持久化策略

### 官方策略（云端优先 — 社区版需替换）
Lunagraph 默认通过 `ElectronCloudBackend` 将 Store 序列化后上传至 `api.lunagraph.com` 云端数据库，本地仅保留缓存副本。

### dsh-opendesigner 替代策略（本地文件优先）
社区版将实现 `LocalDiskBackend`：

```
工程根目录/
├── .designer/
│   ├── canvas.json          ← 扁平 Store 主文件（全部 byId、页面关系、几何定位）
│   ├── canvas.lock          ← 本地并发锁文件（防止多编辑器同时操作）
│   └── snapshots/           ← 冷冻快照图片缓存目录
│       └── <elementId>.png
├── src/
│   └── components/          ← 实际 React 源码（Store 通过 sourceLocation 双向关联）
└── ...
```

所有画布变更直接写入 `.designer/canvas.json`，该文件随工程代码一起纳入 Git 版本管理，实现天然的历史追溯与多人协作。
