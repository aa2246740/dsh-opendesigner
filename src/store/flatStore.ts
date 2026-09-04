/**
 * 扁平化关系型组件存储库 (Flat Relational AST Store)
 * 借鉴 Lunagraph 核心设计，拒绝深层嵌套 JSON，以数据库范式建立索引
 */

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
   * 建立父子关联
   */
  public attachChild(parentId: string, childId: string, index?: number): void {
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
