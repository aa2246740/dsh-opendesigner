/**
 * Flattened element store keyed by id.
 */
function createId() {
    return crypto.randomUUID();
}
export class GraphError extends Error {
    code = "GRAPH_INVALID";
    constructor(message) {
        super(message);
        this.name = "GraphError";
    }
}
function emptyState() {
    return {
        byId: new Map(),
        childrenByParent: new Map(),
        parentByChild: new Map(),
        pages: [],
        activePageId: ""
    };
}
export function assertValidGraph(data) {
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
        const seen = new Set();
        for (const childId of children) {
            if (!byId[childId]) {
                throw new GraphError(`Missing child node ${childId} under ${parentId}`);
            }
            if (seen.has(childId)) {
                throw new GraphError(`Duplicate child ${childId} under ${parentId}`);
            }
            seen.add(childId);
            if (parentByChild[childId] !== parentId) {
                throw new GraphError(`parent/child maps disagree for ${childId}`);
            }
        }
    }
    const claimedParent = new Map();
    for (const [parentId, children] of Object.entries(childrenByParent)) {
        for (const childId of children) {
            const previous = claimedParent.get(childId);
            if (previous && previous !== parentId) {
                throw new GraphError(`child ${childId} has multiple parents`);
            }
            claimedParent.set(childId, parentId);
        }
    }
    for (const [childId, parentId] of Object.entries(parentByChild)) {
        if (!byId[childId]) {
            throw new GraphError(`parentByChild references missing child ${childId}`);
        }
        if (!byId[parentId]) {
            throw new GraphError(`parentByChild references missing parent ${parentId}`);
        }
        const siblings = childrenByParent[parentId];
        if (!Array.isArray(siblings) || !siblings.includes(childId)) {
            throw new GraphError(`parent/child maps disagree for ${childId}`);
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visited.has(id))
            return;
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
    if (data.activePageId) {
        if (!pages.some((page) => page.id === data.activePageId)) {
            throw new GraphError(`active page ${data.activePageId} is not in pages`);
        }
    }
}
export class FlatStore {
    state;
    constructor() {
        this.state = emptyState();
    }
    setElement(el) {
        this.state.byId.set(el.id, el);
    }
    getElement(id) {
        return this.state.byId.get(id);
    }
    getParent(id) {
        const parentId = this.state.parentByChild.get(id);
        return parentId ? this.state.byId.get(parentId) : undefined;
    }
    getChildren(id) {
        const childIds = this.state.childrenByParent.get(id) ?? [];
        return childIds.map((cid) => this.state.byId.get(cid)).filter(Boolean);
    }
    attachChild(parentId, childId, index) {
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
            this.state.childrenByParent.set(currentParentId, oldSiblings.filter((sId) => sId !== childId));
        }
        const siblings = this.state.childrenByParent.get(parentId) ?? [];
        if (index !== undefined && index >= 0 && index <= siblings.length) {
            siblings.splice(index, 0, childId);
        }
        else {
            siblings.push(childId);
        }
        this.state.childrenByParent.set(parentId, siblings);
        this.state.parentByChild.set(childId, parentId);
    }
    isDescendant(ancestorId, targetId) {
        if (ancestorId === targetId)
            return true;
        let current = targetId;
        const visited = new Set();
        while (current) {
            if (visited.has(current))
                break;
            visited.add(current);
            const parentId = this.state.parentByChild.get(current);
            if (!parentId)
                break;
            if (parentId === ancestorId)
                return true;
            current = parentId;
        }
        return false;
    }
    moveElement(elementId, newParentId, index) {
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
    cloneSubtree(rootId, idGenerator = () => createId()) {
        const originalSubtree = this.getSubtree(rootId);
        if (originalSubtree.length === 0) {
            throw new Error(`Subtree root element not found: ${rootId}`);
        }
        const idMap = new Map();
        for (const el of originalSubtree) {
            idMap.set(el.id, idGenerator(el.id));
        }
        const clonedElements = [];
        for (const el of originalSubtree) {
            const newId = idMap.get(el.id);
            const cloned = {
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
            const newId = idMap.get(el.id);
            const originalChildren = this.state.childrenByParent.get(el.id) ?? [];
            const newChildren = [];
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
            rootId: idMap.get(rootId),
            clonedElements
        };
    }
    removeElement(id) {
        const parentId = this.state.parentByChild.get(id);
        if (parentId) {
            const siblings = this.state.childrenByParent.get(parentId);
            if (siblings) {
                this.state.childrenByParent.set(parentId, siblings.filter((sId) => sId !== id));
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
    dropPagesForMissingRoots() {
        const remaining = this.state.pages.filter((page) => this.state.byId.has(page.rootElementId));
        this.state.pages = remaining;
        if (!remaining.some((page) => page.id === this.state.activePageId)) {
            this.state.activePageId = remaining[0]?.id ?? "";
        }
    }
    getSubtree(rootId) {
        const result = [];
        const queue = [rootId];
        const visited = new Set();
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (visited.has(currentId)) {
                throw new GraphError(`Cycle detected at ${currentId}`);
            }
            visited.add(currentId);
            const el = this.state.byId.get(currentId);
            if (!el)
                continue;
            result.push(el);
            const children = this.state.childrenByParent.get(currentId) ?? [];
            queue.push(...children);
        }
        return result;
    }
    getRootIds() {
        const rootIds = [];
        for (const id of this.state.byId.keys()) {
            if (!this.state.parentByChild.has(id)) {
                rootIds.push(id);
            }
        }
        return rootIds;
    }
    addPage(page) {
        if (!this.state.byId.has(page.rootElementId)) {
            throw new GraphError(`Dangling page root ${page.rootElementId}`);
        }
        this.state.pages.push({ ...page });
        if (!this.state.activePageId) {
            this.state.activePageId = page.id;
        }
    }
    getPages() {
        return this.state.pages.map((page) => ({ ...page }));
    }
    setActivePage(pageId) {
        if (!this.state.pages.some((page) => page.id === pageId)) {
            throw new GraphError(`active page ${pageId} is not in pages`);
        }
        this.state.activePageId = pageId;
    }
    getActivePageId() {
        return this.state.activePageId;
    }
    toJSON() {
        return structuredClone({
            byId: Object.fromEntries(this.state.byId),
            childrenByParent: Object.fromEntries(this.state.childrenByParent),
            parentByChild: Object.fromEntries(this.state.parentByChild),
            pages: this.state.pages,
            activePageId: this.state.activePageId
        });
    }
    fromJSON(data) {
        const cloned = structuredClone(data ?? {});
        if (!cloned.byId)
            cloned.byId = {};
        if (!cloned.childrenByParent)
            cloned.childrenByParent = {};
        if (!cloned.parentByChild)
            cloned.parentByChild = {};
        if (!cloned.pages)
            cloned.pages = [];
        assertValidGraph(cloned);
        this.state.byId = new Map(Object.entries(cloned.byId));
        this.state.childrenByParent = new Map(Object.entries(cloned.childrenByParent));
        this.state.parentByChild = new Map(Object.entries(cloned.parentByChild));
        this.state.pages = cloned.pages;
        this.state.activePageId = cloned.activePageId || "";
    }
}
//# sourceMappingURL=flatStore.js.map