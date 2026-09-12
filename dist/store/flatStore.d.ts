/**
 * Flattened element store keyed by id.
 */
export declare class GraphError extends Error {
    readonly code = "GRAPH_INVALID";
    constructor(message: string);
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
export declare function assertValidGraph(data: FlatStoreJson): void;
export declare class FlatStore {
    private state;
    constructor();
    setElement(el: FEElement): void;
    getElement(id: string): FEElement | undefined;
    getParent(id: string): FEElement | undefined;
    getChildren(id: string): FEElement[];
    attachChild(parentId: string, childId: string, index?: number): void;
    isDescendant(ancestorId: string, targetId: string): boolean;
    moveElement(elementId: string, newParentId: string, index?: number): boolean;
    cloneSubtree(rootId: string, idGenerator?: (oldId: string) => string): {
        rootId: string;
        clonedElements: FEElement[];
    };
    removeElement(id: string): void;
    private dropPagesForMissingRoots;
    getSubtree(rootId: string): FEElement[];
    getRootIds(): string[];
    addPage(page: PageMeta): void;
    getPages(): PageMeta[];
    setActivePage(pageId: string): void;
    getActivePageId(): string;
    toJSON(): FlatStoreJson;
    fromJSON(data: unknown): void;
}
//# sourceMappingURL=flatStore.d.ts.map