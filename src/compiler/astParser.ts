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
  extra?: { raw: string };
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

export class ASTParser {
  private code: string;
  private length: number;
  private pos: number = 0;
  private lineStarts: number[];

  constructor(code: string) {
    this.code = code;
    this.length = code.length;
    this.lineStarts = this.computeLineStarts(code);
  }

  private computeLineStarts(code: string): number[] {
    const starts = [0];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === "\n") {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  private getLoc(pos: number): SourceLoc {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= pos) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    return {
      line: lineIndex + 1,
      column: pos - this.lineStarts[lineIndex]
    };
  }

  private createLoc(start: number, end: number): NodeLoc {
    return {
      start: this.getLoc(start),
      end: this.getLoc(end)
    };
  }

  private raiseError(msg: string, pos: number = this.pos): never {
    const loc = this.getLoc(pos);
    const err = new SyntaxError(`${msg} (${loc.line}:${loc.column})`);
    (err as any).loc = loc;
    (err as any).pos = pos;
    throw err;
  }

  private peek(offset: number = 0): string {
    return this.pos + offset < this.length ? this.code[this.pos + offset] : "";
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.length) {
      const ch = this.code[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
        continue;
      }
      if (ch === "/" && this.peek(1) === "/") {
        // 单行注释
        this.pos += 2;
        while (this.pos < this.length && this.code[this.pos] !== "\n") {
          this.pos++;
        }
        continue;
      }
      if (ch === "/" && this.peek(1) === "*") {
        // 多行注释
        const startComment = this.pos;
        this.pos += 2;
        while (this.pos < this.length && !(this.code[this.pos] === "*" && this.peek(1) === "/")) {
          this.pos++;
        }
        if (this.pos >= this.length) {
          this.raiseError("Unterminated multi-line comment", startComment);
        }
        this.pos += 2;
        continue;
      }
      break;
    }
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === "-";
  }

  public parse(): FileNode {
    const fileStart = 0;
    const body: BaseNode[] = [];
    const parenStack: string[] = [];

    while (this.pos < this.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.length) break;

      const ch = this.code[this.pos];

      // 括号配对校验
      if (ch === "(" || ch === "{" || ch === "[") {
        parenStack.push(ch);
        this.pos++;
        continue;
      }
      if (ch === ")" || ch === "}" || ch === "]") {
        const expected = ch === ")" ? "(" : ch === "}" ? "{" : "[";
        const top = parenStack.pop();
        if (top !== expected) {
          this.raiseError(`Unexpected closing token '${ch}'`, this.pos);
        }
        this.pos++;
        continue;
      }

      // 字符串字面量扫描（跳过）
      if (ch === '"' || ch === "'") {
        this.scanStringLiteral();
        continue;
      }
      if (ch === "`") {
        this.scanTemplateLiteral();
        continue;
      }

      // 尝试匹配 JSX
      if (ch === "<") {
        const nextChar = this.peek(1);
        if (this.isIdentStart(nextChar) || nextChar === ">") {
          const jsxNode = this.parseJSXElement();
          body.push(jsxNode);
          continue;
        }
      }

      this.pos++;
    }

    if (parenStack.length > 0) {
      this.raiseError(`Unclosed '${parenStack[parenStack.length - 1]}'`, this.pos);
    }

    const fileEnd = this.length;
    const programNode: ProgramNode = {
      type: "Program",
      sourceType: "module",
      body,
      start: fileStart,
      end: fileEnd,
      loc: this.createLoc(fileStart, fileEnd)
    };

    return {
      type: "File",
      program: programNode,
      start: fileStart,
      end: fileEnd,
      loc: this.createLoc(fileStart, fileEnd)
    };
  }

  private scanStringLiteral(): StringLiteralNode {
    const start = this.pos;
    const quote = this.code[this.pos++];
    let escaped = false;
    let strVal = "";

    while (this.pos < this.length) {
      const ch = this.code[this.pos++];
      if (escaped) {
        strVal += ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        const end = this.pos;
        return {
          type: "StringLiteral",
          value: strVal,
          extra: { raw: this.code.slice(start, end) },
          start,
          end,
          loc: this.createLoc(start, end)
        };
      } else {
        strVal += ch;
      }
    }

    this.raiseError(`Unterminated string constant`, start);
  }

  private scanTemplateLiteral(): void {
    const start = this.pos++;
    let escaped = false;

    while (this.pos < this.length) {
      const ch = this.code[this.pos++];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "`") {
        return;
      } else if (ch === "$" && this.peek(0) === "{") {
        this.pos++; // skip '{'
        let depth = 1;
        while (this.pos < this.length && depth > 0) {
          const innerCh = this.code[this.pos];
          if (innerCh === "{") depth++;
          else if (innerCh === "}") depth--;
          else if (innerCh === '"' || innerCh === "'") {
            this.scanStringLiteral();
            continue;
          }
          this.pos++;
        }
      }
    }

    this.raiseError("Unterminated template literal", start);
  }

  private parseJSXIdentifier(): JSXIdentifierNode {
    const start = this.pos;
    while (this.pos < this.length && this.isIdentPart(this.code[this.pos])) {
      this.pos++;
    }
    const name = this.code.slice(start, this.pos);
    if (!name) {
      this.raiseError("Expected JSX identifier", start);
    }
    const end = this.pos;
    return {
      type: "JSXIdentifier",
      name,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }

  private parseJSXMemberOrIdentifier(): BaseNode {
    let expr: BaseNode = this.parseJSXIdentifier();
    while (this.peek(0) === ".") {
      const dotStart = expr.start;
      this.pos++; // skip '.'
      const prop = this.parseJSXIdentifier();
      const end = prop.end;
      expr = {
        type: "JSXMemberExpression",
        object: expr,
        property: prop,
        start: dotStart,
        end,
        loc: this.createLoc(dotStart, end)
      };
    }
    return expr;
  }

  private parseJSXAttribute(): JSXAttributeNode | BaseNode {
    const start = this.pos;
    if (this.code[this.pos] === "{" && this.code.slice(this.pos, this.pos + 4) === "{...") {
      // JSXSpreadAttribute
      this.pos += 4;
      let depth = 1;
      while (this.pos < this.length && depth > 0) {
        if (this.code[this.pos] === "{") depth++;
        else if (this.code[this.pos] === "}") depth--;
        this.pos++;
      }
      const end = this.pos;
      return {
        type: "JSXSpreadAttribute",
        argument: { type: "Identifier", name: "props" },
        start,
        end,
        loc: this.createLoc(start, end)
      };
    }

    const name = this.parseJSXIdentifier();
    this.skipWhitespaceAndComments();

    let value: BaseNode | null = null;
    if (this.peek(0) === "=") {
      this.pos++; // skip '='
      this.skipWhitespaceAndComments();
      const nextCh = this.peek(0);

      if (nextCh === '"' || nextCh === "'") {
        value = this.scanStringLiteral();
      } else if (nextCh === "{") {
        const exprStart = this.pos++;
        let depth = 1;
        let innerStart = this.pos;
        let innerParsed: BaseNode | null = null;

        // 如果是内联对象 {{ key: value }}
        this.skipWhitespaceAndComments();
        if (this.peek(0) === "{") {
          innerParsed = this.parseObjectExpression();
          this.skipWhitespaceAndComments();
          if (this.peek(0) === "}") {
            this.pos++; // skip outer '}'
            depth = 0;
          }
        } else {
          while (this.pos < this.length && depth > 0) {
            const c = this.code[this.pos];
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === '"' || c === "'") {
              this.scanStringLiteral();
              continue;
            }
            if (depth > 0) this.pos++;
          }
          if (depth === 0) this.pos++; // skip outer '}'
        }

        if (depth > 0) {
          this.raiseError("Unclosed JSX expression container", exprStart);
        }

        const exprEnd = this.pos;
        value = {
          type: "JSXExpressionContainer",
          expression: innerParsed || {
            type: "Identifier",
            name: this.code.slice(innerStart, exprEnd - 1).trim(),
            start: innerStart,
            end: exprEnd - 1,
            loc: this.createLoc(innerStart, exprEnd - 1)
          },
          start: exprStart,
          end: exprEnd,
          loc: this.createLoc(exprStart, exprEnd)
        };
      } else {
        this.raiseError(`Unexpected character '${nextCh}' after '=' in JSX attribute`, this.pos);
      }
    }

    const end = value ? value.end : name.end;
    return {
      type: "JSXAttribute",
      name,
      value,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }

  private parseObjectExpression(): BaseNode {
    const start = this.pos++; // skip '{'
    const properties: BaseNode[] = [];

    while (this.pos < this.length) {
      this.skipWhitespaceAndComments();
      if (this.peek(0) === "}") {
        this.pos++;
        break;
      }

      const propStart = this.pos;
      let keyNode: BaseNode;
      if (this.peek(0) === '"' || this.peek(0) === "'") {
        keyNode = this.scanStringLiteral();
      } else {
        keyNode = this.parseJSXIdentifier();
      }

      this.skipWhitespaceAndComments();
      if (this.peek(0) === ":") {
        this.pos++; // skip ':'
        this.skipWhitespaceAndComments();
        let valNode: BaseNode;
        const valStart = this.pos;

        if (this.peek(0) === '"' || this.peek(0) === "'") {
          valNode = this.scanStringLiteral();
        } else {
          // 扫描数字或简单标识符
          while (this.pos < this.length && !/[,}\s]/.test(this.code[this.pos])) {
            this.pos++;
          }
          const rawVal = this.code.slice(valStart, this.pos);
          const num = Number(rawVal);
          valNode = {
            type: !isNaN(num) ? "NumericLiteral" : "Identifier",
            value: !isNaN(num) ? num : rawVal,
            name: rawVal,
            start: valStart,
            end: this.pos,
            loc: this.createLoc(valStart, this.pos)
          };
        }

        properties.push({
          type: "ObjectProperty",
          key: keyNode,
          value: valNode,
          start: propStart,
          end: valNode.end,
          loc: this.createLoc(propStart, valNode.end)
        });
      }

      this.skipWhitespaceAndComments();
      if (this.peek(0) === ",") {
        this.pos++;
      }
    }

    const end = this.pos;
    return {
      type: "ObjectExpression",
      properties,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }

  private parseJSXOpeningElement(): JSXOpeningElementNode {
    const start = this.pos++; // skip '<'
    this.skipWhitespaceAndComments();

    let nameNode: BaseNode;
    if (this.peek(0) === ">") {
      nameNode = {
        type: "JSXIdentifier",
        name: "",
        start: this.pos,
        end: this.pos,
        loc: this.createLoc(this.pos, this.pos)
      };
    } else {
      nameNode = this.parseJSXMemberOrIdentifier();
    }

    const attributes: BaseNode[] = [];
    let selfClosing = false;

    while (this.pos < this.length) {
      this.skipWhitespaceAndComments();
      if (this.peek(0) === "/" && this.peek(1) === ">") {
        selfClosing = true;
        this.pos += 2;
        break;
      }
      if (this.peek(0) === ">") {
        this.pos++;
        break;
      }
      if (this.pos >= this.length) {
        this.raiseError("Unclosed JSX opening tag", start);
      }

      const attr = this.parseJSXAttribute();
      attributes.push(attr);
    }

    const end = this.pos;
    return {
      type: "JSXOpeningElement",
      name: nameNode,
      attributes,
      selfClosing,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }

  private parseJSXClosingElement(): JSXClosingElementNode {
    const start = this.pos;
    this.pos += 2; // skip '</'
    this.skipWhitespaceAndComments();

    let nameNode: BaseNode;
    if (this.peek(0) === ">") {
      nameNode = {
        type: "JSXIdentifier",
        name: "",
        start: this.pos,
        end: this.pos,
        loc: this.createLoc(this.pos, this.pos)
      };
    } else {
      nameNode = this.parseJSXMemberOrIdentifier();
    }

    this.skipWhitespaceAndComments();
    if (this.peek(0) !== ">") {
      this.raiseError("Expected '>' to close JSX closing tag", this.pos);
    }
    this.pos++; // skip '>'

    const end = this.pos;
    return {
      type: "JSXClosingElement",
      name: nameNode,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }

  public parseJSXElement(): JSXElementNode {
    const start = this.pos;
    const openingElement = this.parseJSXOpeningElement();
    const children: BaseNode[] = [];
    let closingElement: JSXClosingElementNode | null = null;

    if (!openingElement.selfClosing) {
      while (this.pos < this.length) {
        // 检查闭合标签
        if (this.peek(0) === "<" && this.peek(1) === "/") {
          closingElement = this.parseJSXClosingElement();
          const openName = (openingElement.name as any).name;
          const closeName = (closingElement.name as any).name;
          if (openName !== closeName) {
            this.raiseError(
              `Mismatched JSX tags: expected </${openName}>, found </${closeName}>`,
              closingElement.start
            );
          }
          break;
        }

        // 嵌套 JSX 元素
        if (this.peek(0) === "<" && (this.isIdentStart(this.peek(1)) || this.peek(1) === ">")) {
          const childElem = this.parseJSXElement();
          children.push(childElem);
          continue;
        }

        // 嵌入表达式
        if (this.peek(0) === "{") {
          const exprStart = this.pos++;
          let depth = 1;
          while (this.pos < this.length && depth > 0) {
            const ch = this.code[this.pos];
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            else if (ch === '"' || ch === "'") {
              this.scanStringLiteral();
              continue;
            }
            if (depth > 0) this.pos++;
          }
          if (depth > 0) {
            this.raiseError("Unclosed JSX expression in children", exprStart);
          }
          this.pos++; // skip '}'
          const exprEnd = this.pos;
          children.push({
            type: "JSXExpressionContainer",
            start: exprStart,
            end: exprEnd,
            loc: this.createLoc(exprStart, exprEnd)
          });
          continue;
        }

        // 纯文本子项
        const textStart = this.pos;
        while (this.pos < this.length && this.peek(0) !== "<" && this.peek(0) !== "{") {
          this.pos++;
        }
        if (this.pos > textStart) {
          const raw = this.code.slice(textStart, this.pos);
          children.push({
            type: "JSXText",
            value: raw,
            raw,
            start: textStart,
            end: this.pos,
            loc: this.createLoc(textStart, this.pos)
          });
        }
      }

      if (!closingElement) {
        this.raiseError(`Unclosed JSX element <${(openingElement.name as any).name}>`, start);
      }
    }

    const end = closingElement ? closingElement.end : openingElement.end;
    return {
      type: "JSXElement",
      openingElement,
      children,
      closingElement,
      start,
      end,
      loc: this.createLoc(start, end)
    };
  }
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
  [key: string]: VisitorFunction | undefined;
}

export function traverseAST(ast: BaseNode, visitor: Visitor, parent: BaseNode | null = null): void {
  const path: NodePath = { node: ast, parent };

  if (visitor.enter) {
    visitor.enter(path);
  }

  const handler = visitor[ast.type];
  if (typeof handler === "function") {
    handler(path);
  }

  for (const key of Object.keys(ast)) {
    if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
    const value = ast[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item && typeof item === "object" && typeof item.type === "string") {
          traverseAST(item, visitor, ast);
        }
      }
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      traverseAST(value, visitor, ast);
    }
  }
}

/**
 * 导出兼容 @babel/parser 的 parse 函数
 */
export function parse(code: string, options?: any): FileNode {
  const parser = new ASTParser(code);
  return parser.parse();
}

/**
 * 导出兼容 @babel/traverse 的 traverse 函数
 */
export function traverse(ast: BaseNode, visitor: Visitor): void {
  traverseAST(ast, visitor);
}

traverse.default = traverse;
