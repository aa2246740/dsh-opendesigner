/**
 * Flattened element store keyed by id.
 */

function createId(): string {
  return crypto.randomUUID();
}

export type ElementType = "element" | "text" | "component" | "capture";

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface FEElement {
  id: string;
  type: ElementType;
  tag: string;
  props: Record<string, unknown>;
  textContent?: string;
  canvasRect?: CanvasRect;
  sourceLocation?: SourceLocation;
  captureDataUrl?: string; // 渲染崩溃时的兜底快照
}

export interface PageMeta {
  id: string;
  name: string;
  isLoaded: boolean;
  rootElementId: string;
}

export interface FlatStoreState {
  byId: Map<string, FEElement>;
  childrenByParent: Map<string, string[]>;
  parentByChild: Map<string, string>;
  pages: PageMeta[];
  activePageId: string;
}

export class FlatStore {
  private state: FlatStoreState;

  constructor() {
    this.state = {
      byId: new Map(),
      childrenByParent: new Map(),
      parentByChild: new Map(),
      pages: [],
      activePageId: ""
    };
  }

  /**
   * 注册或更新元素
   */
  public setElement(el: FEElement): void {
    this.state.byId.set(el.id, el);
  }

  /**
   * 获取单个元素
   */
  public getElement(id: string): FEElement | undefined {
    return this.state.byId.get(id);
  }

  /**
   * 获取父级元素
   */
  public getParent(id: string): FEElement | undefined {
    const parentId = this.state.parentByChild.get(id);
    return parentId ? this.state.byId.get(parentId) : undefined;
  }

  /**
   * 获取直接子节点列表
   */
  public getChildren(id: string): FEElement[] {
    const childIds = this.state.childrenByParent.get(id) ?? [];
    return childIds.map((cid) => this.state.byId.get(cid)).filter(Boolean) as FEElement[];
  }

  /**
   * 建立父子关联
   */
  public attachChild(parentId: string, childId: string, index?: number): void {
    if (parentId === childId) {
      throw new Error(`Cannot attach element to itself: ${parentId}`);
    }

    if (this.isDescendant(childId, parentId)) {
      throw new Error(`Cycle detected: cannot attach ancestor ${childId} as child of descendant ${parentId}`);
    }

    // 先从原有父级脱离
    const currentParentId = this.state.parentByChild.get(childId);
    if (currentParentId) {
      const oldSiblings = this.state.childrenByParent.get(currentParentId) ?? [];
      this.state.childrenByParent.set(
        currentParentId,
        oldSiblings.filter((sId) => sId !== childId)
      );
    }

    const siblings = this.state.childrenByParent.get(parentId) ?? [];
    if (index !== undefined && index >= 0 && index <= siblings.length) {
      siblings.splice(index, 0, childId);
    } else {
      siblings.push(childId);
    }
    this.state.childrenByParent.set(parentId, siblings);
    this.state.parentByChild.set(childId, parentId);
  }

  /**
   * 检查 targetId 是否为 ancestorId 的后代节点（或自身）
   */
  public isDescendant(ancestorId: string, targetId: string): boolean {
    if (ancestorId === targetId) return true;

    let current: string | undefined = targetId;
    const visited = new Set<string>();

    while (current) {
      if (visited.has(current)) break;
      visited.add(current);

      const parentId: string | undefined = this.state.parentByChild.get(current);
      if (!parentId) break;
      if (parentId === ancestorId) return true;
      current = parentId;
    }

    return false;
  }

  /**
   * 移动节点层级并附带循环引用安全校验
   */
  public moveElement(elementId: string, newParentId: string, index?: number): boolean {
    if (!this.state.byId.has(elementId)) {
      throw new Error(`Element not found: ${elementId}`);
    }
    if (!this.state.byId.has(newParentId)) {
      throw new Error(`Target parent element not found: ${newParentId}`);
    }

    if (elementId === newParentId) {
      throw new Error(`Cycle detected: cannot move element ${elementId} into itself`);
    }

    if (this.isDescendant(elementId, newParentId)) {
      throw new Error(`Cycle detected: cannot move element ${elementId} into its own descendant ${newParentId}`);
    }

    this.attachChild(newParentId, elementId, index);
    return true;
  }

  /**
   * 深度克隆以 rootId 为根的整棵子树，自动重新生成 UUID
   */
  public cloneSubtree(
    rootId: string,
    idGenerator: (oldId: string) => string = () => createId()
  ): { rootId: string; clonedElements: FEElement[] } {
    const originalSubtree = this.getSubtree(rootId);
    if (originalSubtree.length === 0) {
      throw new Error(`Subtree root element not found: ${rootId}`);
    }

    // 建立 ID 映射表
    const idMap = new Map<string, string>();
    for (const el of originalSubtree) {
      idMap.set(el.id, idGenerator(el.id));
    }

    const clonedElements: FEElement[] = [];

    // 克隆元素节点本体
    for (const el of originalSubtree) {
      const newId = idMap.get(el.id)!;
      const cloned: FEElement = {
        ...el,
        id: newId,
        props: JSON.parse(JSON.stringify(el.props)),
        canvasRect: el.canvasRect ? { ...el.canvasRect } : undefined,
        sourceLocation: el.sourceLocation ? { ...el.sourceLocation } : undefined
      };
      this.state.byId.set(newId, cloned);
      clonedElements.push(cloned);
    }

    // 建立克隆后的层级关系
    for (const el of originalSubtree) {
      const newId = idMap.get(el.id)!;
      const originalChildren = this.state.childrenByParent.get(el.id) ?? [];
      const newChildren: string[] = [];

      for (const childId of originalChildren) {
        const newChildId = idMap.get(childId);
        if (newChildId) {
          newChildren.push(newChildId);
          this.state.parentByChild.set(newChildId, newId);
        }
      }

      this.state.childrenByParent.set(newId, newChildren);
    }

    return {
      rootId: idMap.get(rootId)!,
      clonedElements
    };
  }

  /**
   * 移除元素及其在关系表中的关联
   */
  public removeElement(id: string): void {
    const parentId = this.state.parentByChild.get(id);
    if (parentId) {
      const siblings = this.state.childrenByParent.get(parentId);
      if (siblings) {
        this.state.childrenByParent.set(
          parentId,
          siblings.filter((sId) => sId !== id)
        );
      }
      this.state.parentByChild.delete(id);
    }

    // 递归移除子项
    const children = this.state.childrenByParent.get(id) ?? [];
    for (const childId of children) {
      this.removeElement(childId);
    }
    this.state.childrenByParent.delete(id);
    this.state.byId.delete(id);
  }

  /**
   * 广度优先提取以 rootId 为根的整棵子树
   */
  public getSubtree(rootId: string): FEElement[] {
    const result: FEElement[] = [];
    const queue = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const el = this.state.byId.get(currentId);
      if (!el) continue;
      result.push(el);
      const children = this.state.childrenByParent.get(currentId) ?? [];
      queue.push(...children);
    }

    return result;
  }

  /**
   * 获取所有无父级的顶层根节点 ID
   */
  public getRootIds(): string[] {
    const rootIds: string[] = [];
    for (const id of this.state.byId.keys()) {
      if (!this.state.parentByChild.has(id)) {
        rootIds.push(id);
      }
    }
    return rootIds;
  }

  /**
   * 画布页面管理
   */
  public addPage(page: PageMeta): void {
    this.state.pages.push(page);
    if (!this.state.activePageId) {
      this.state.activePageId = page.id;
    }
  }

  public getPages(): PageMeta[] {
    return this.state.pages;
  }

  public setActivePage(pageId: string): void {
    this.state.activePageId = pageId;
  }

  public getActivePageId(): string {
    return this.state.activePageId;
  }

  /**
   * 导出为 JSON 序列化对象（用于本地 .designer/canvas.json 存储）
   */
  public toJSON() {
    return {
      byId: Object.fromEntries(this.state.byId),
      childrenByParent: Object.fromEntries(this.state.childrenByParent),
      parentByChild: Object.fromEntries(this.state.parentByChild),
      pages: this.state.pages,
      activePageId: this.state.activePageId
    };
  }

  /**
   * 从 JSON 反序列化恢复 Store
   */
  public fromJSON(data: any) {
    this.state.byId = new Map(Object.entries(data.byId || {}));
    this.state.childrenByParent = new Map(Object.entries(data.childrenByParent || {}));
    this.state.parentByChild = new Map(Object.entries(data.parentByChild || {}));
    this.state.pages = data.pages || [];
    this.state.activePageId = data.activePageId || "";
  }
}
