/**
 * 自包含轻量 Babel 兼容 AST 解析器与遍历器
 * 支持 JSX / TSX 语法树解析、行列号映射与语法错误校验
 */
export interface SourceLoc {
    line: number;
    column: number;
}
export interface NodeLoc {
    start: SourceLoc;
    end: SourceLoc;
}
export interface BaseNode {
    type: string;
    start: number;
    end: number;
    loc: NodeLoc;
    [key: string]: any;
}
export interface JSXIdentifierNode extends BaseNode {
    type: "JSXIdentifier";
    name: string;
}
export interface StringLiteralNode extends BaseNode {
    type: "StringLiteral";
    value: string;
    extra?: {
        raw: string;
    };
}
export interface JSXAttributeNode extends BaseNode {
    type: "JSXAttribute";
    name: JSXIdentifierNode;
    value: StringLiteralNode | BaseNode | null;
}
export interface JSXOpeningElementNode extends BaseNode {
    type: "JSXOpeningElement";
    name: JSXIdentifierNode | BaseNode;
    attributes: (JSXAttributeNode | BaseNode)[];
    selfClosing: boolean;
}
export interface JSXClosingElementNode extends BaseNode {
    type: "JSXClosingElement";
    name: JSXIdentifierNode | BaseNode;
}
export interface JSXElementNode extends BaseNode {
    type: "JSXElement";
    openingElement: JSXOpeningElementNode;
    children: BaseNode[];
    closingElement: JSXClosingElementNode | null;
}
export interface ProgramNode extends BaseNode {
    type: "Program";
    sourceType: "module" | "script";
    body: BaseNode[];
}
export interface FileNode extends BaseNode {
    type: "File";
    program: ProgramNode;
}
export declare class ASTParser {
    private code;
    private length;
    private pos;
    private lineStarts;
    constructor(code: string);
    private computeLineStarts;
    private getLoc;
    private createLoc;
    private raiseError;
    private peek;
    private skipWhitespaceAndComments;
    private isIdentStart;
    private isIdentPart;
    parse(): FileNode;
    private scanStringLiteral;
    private scanTemplateLiteral;
    private parseJSXIdentifier;
    private parseJSXMemberOrIdentifier;
    private scanBalancedBraces;
    private parseJSXAttribute;
    private parseObjectExpression;
    private parseJSXOpeningElement;
    private parseJSXClosingElement;
    parseJSXElement(): JSXElementNode;
}
/**
 * 遍历 AST 树
 */
export interface NodePath<T = BaseNode> {
    node: T;
    parent: BaseNode | null;
    key?: string;
    index?: number;
}
export type VisitorFunction = (path: NodePath) => void;
export interface Visitor {
    JSXElement?: (path: NodePath<JSXElementNode>) => void;
    JSXOpeningElement?: (path: NodePath<JSXOpeningElementNode>) => void;
    JSXAttribute?: (path: NodePath<JSXAttributeNode>) => void;
    JSXClosingElement?: (path: NodePath<JSXClosingElementNode>) => void;
    Program?: (path: NodePath<ProgramNode>) => void;
    enter?: (path: NodePath) => void;
}
export declare function traverseAST(ast: BaseNode, visitor: Visitor, parent?: BaseNode | null): void;
/**
 * 导出兼容 @babel/parser 的 parse 函数
 */
export declare function parse(code: string, options?: any): FileNode;
/**
 * 导出兼容 @babel/traverse 的 traverse 函数
 */
export declare function traverse(ast: BaseNode, visitor: Visitor): void;
export declare namespace traverse {
    var _a: typeof traverse;
    export { _a as default };
}
//# sourceMappingURL=astParser.d.ts.map