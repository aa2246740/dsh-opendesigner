import type { FEElement } from "../store/flatStore.ts";
export interface ImportedJsx {
    elements: FEElement[];
    attachments: Array<{
        parentId: string;
        childId: string;
    }>;
    rootIds: string[];
}
export declare function jsxElementId(filePath: string, line: number, column: number, tag: string): string;
export declare function importJsxToElements(source: string, filePath: string): ImportedJsx;
//# sourceMappingURL=jsxImport.d.ts.map