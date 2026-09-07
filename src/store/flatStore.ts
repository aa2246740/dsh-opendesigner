/**
 * Flattened element store keyed by id.
 */

function createId(): string {
  return crypto.randomUUID();
}

export class GraphError extends Error {
  readonly code = "GRAPH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
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
  captureDataUrl?: string;
}

export interface PageMeta {
  id: string;
  name: string;
  isLoaded: boolean;
  rootElementId: string;
}

export interface FlatStoreJson {
  byId: Record<string, FEElement>;
  childrenByParent: Record<string, string[]>;
  parentByChild: Record<string, string>;
  pages: PageMeta[];
  activePageId: string;
  projectId?: string;
  version?: number;
  savedAt?: string;
}

export interface FlatStoreState {
  byId: Map<string, FEElement>;
  childrenByParent: Map<string, string[]>;
  parentByChild: Map<string, string>;
  pages: PageMeta[];
  activePageId: string;
}

function emptyState(): FlatStoreState {
  return {
    byId: new Map(),
    childrenByParent: new Map(),
    parentByChild: new Map(),
    pages: [],
    activePageId: ""
  };
}

export function assertValidGraph(data: FlatStoreJson): void {
  const byId = data.byId || {};
  const childrenByParent = data.childrenByParent || {};
  const parentByChild = data.parentByChild || {};
  const pages = data.pages || [];

  for (const [parentId, children] of Object.entries(childrenByParent)) {
    if (!byId[parentId]) {
      throw new GraphError(`Missing parent node ${parentId}`);
    }
    if (!Array.isArray(children)) {
      throw new GraphError(`childrenByParent.${parentId} must be an array`);
    }
    for (const childId of children) {
      if (!byId[childId]) {
        throw new GraphError(`Missing child node ${childId} under ${parentId}`);
      }
    }
  }

  for (const [childId, parentId] of Object.entries(parentByChild)) {
    if (!byId[childId]) {
      throw new GraphError(`parentByChild references missing child ${childId}`);
    }
    if (!byId[parentId]) {
      throw new GraphError(`parentByChild references missing parent ${parentId}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new GraphError(`Cycle detected at ${id}`);
    }
    visiting.add(id);
    for (const childId of childrenByParent[id] || []) {
      visit(childId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(byId)) {
    visit(id);
  }

  for (const page of pages) {
    if (!page || typeof page.rootElementId !== "string" || !byId[page.rootElementId]) {
      throw new GraphError(`Dangling page root ${page?.rootElementId ?? "(missing)"}`);
    }
  }
}

export class FlatStore {
  private state: FlatStoreState;

  constructor() {
    this.state = emptyState();
  }

  public setElement(el: FEElement): void {
    this.state.byId.set(el.id, el);
  }

  public getElement(id: string): FEElement | undefined {
    return this.state.byId.get(id);
  }

  public getParent(id: string): FEElement | undefined {
    const parentId = this.state.parentByChild.get(id);
    return parentId ? this.state.byId.get(parentId) : undefined;
  }

  public getChildren(id: string): FEElement[] {
    const childIds = this.state.childrenByParent.get(id) ?? [];
    return childIds.map((cid) => this.state.byId.get(cid)).filter(Boolean) as FEElement[];
  }

  public attachChild(parentId: string, childId: string, index?: number): void {
    if (!this.state.byId.has(parentId)) {
      throw new GraphError(`Parent not found: ${parentId}`);
    }
    if (!this.state.byId.has(childId)) {
      throw new GraphError(`Child not found: ${childId}`);
    }
    if (parentId === childId) {
      throw new Error(`Cannot attach element to itself: ${parentId}`);
    }

    if (this.isDescendant(childId, parentId)) {
      throw new Error(`Cycle detected: cannot attach ancestor ${childId} as child of descendant ${parentId}`);
    }

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

  public cloneSubtree(
    rootId: string,
    idGenerator: (oldId: string) => string = () => createId()
  ): { rootId: string; clonedElements: FEElement[] } {
    const originalSubtree = this.getSubtree(rootId);
    if (originalSubtree.length === 0) {
      throw new Error(`Subtree root element not found: ${rootId}`);
    }

    const idMap = new Map<string, string>();
    for (const el of originalSubtree) {
      idMap.set(el.id, idGenerator(el.id));
    }

    const clonedElements: FEElement[] = [];

    for (const el of originalSubtree) {
      const newId = idMap.get(el.id)!;
      const cloned: FEElement = {
        ...el,
        id: newId,
        props: structuredClone(el.props),
        canvasRect: el.canvasRect ? { ...el.canvasRect } : undefined,
        sourceLocation: el.sourceLocation ? { ...el.sourceLocation } : undefined
      };
      this.state.byId.set(newId, cloned);
      clonedElements.push(cloned);
    }

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

    const children = [...(this.state.childrenByParent.get(id) ?? [])];
    for (const childId of children) {
      this.removeElement(childId);
    }
    this.state.childrenByParent.delete(id);
    this.state.byId.delete(id);
    this.dropPagesForMissingRoots();
  }

  private dropPagesForMissingRoots(): void {
    const remaining = this.state.pages.filter((page) => this.state.byId.has(page.rootElementId));
    this.state.pages = remaining;
    if (!remaining.some((page) => page.id === this.state.activePageId)) {
      this.state.activePageId = remaining[0]?.id ?? "";
    }
  }

  public getSubtree(rootId: string): FEElement[] {
    const result: FEElement[] = [];
    const queue = [rootId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        throw new GraphError(`Cycle detected at ${currentId}`);
      }
      visited.add(currentId);
      const el = this.state.byId.get(currentId);
      if (!el) continue;
      result.push(el);
      const children = this.state.childrenByParent.get(currentId) ?? [];
      queue.push(...children);
    }

    return result;
  }

  public getRootIds(): string[] {
    const rootIds: string[] = [];
    for (const id of this.state.byId.keys()) {
      if (!this.state.parentByChild.has(id)) {
        rootIds.push(id);
      }
    }
    return rootIds;
  }

  public addPage(page: PageMeta): void {
    if (!this.state.byId.has(page.rootElementId)) {
      throw new GraphError(`Dangling page root ${page.rootElementId}`);
    }
    this.state.pages.push({ ...page });
    if (!this.state.activePageId) {
      this.state.activePageId = page.id;
    }
  }

  public getPages(): PageMeta[] {
    return this.state.pages.map((page) => ({ ...page }));
  }

  public setActivePage(pageId: string): void {
    this.state.activePageId = pageId;
  }

  public getActivePageId(): string {
    return this.state.activePageId;
  }

  public toJSON(): FlatStoreJson {
    return structuredClone({
      byId: Object.fromEntries(this.state.byId),
      childrenByParent: Object.fromEntries(this.state.childrenByParent),
      parentByChild: Object.fromEntries(this.state.parentByChild),
      pages: this.state.pages,
      activePageId: this.state.activePageId
    });
  }

  public fromJSON(data: unknown): void {
    const cloned = structuredClone(data ?? {}) as FlatStoreJson;
    if (!cloned.byId) cloned.byId = {};
    if (!cloned.childrenByParent) cloned.childrenByParent = {};
    if (!cloned.parentByChild) cloned.parentByChild = {};
    if (!cloned.pages) cloned.pages = [];
    assertValidGraph(cloned);
    this.state.byId = new Map(Object.entries(cloned.byId));
    this.state.childrenByParent = new Map(Object.entries(cloned.childrenByParent));
    this.state.parentByChild = new Map(Object.entries(cloned.parentByChild));
    this.state.pages = cloned.pages;
    this.state.activePageId = cloned.activePageId || "";
  }
}
