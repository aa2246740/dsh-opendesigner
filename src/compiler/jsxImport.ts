import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { FEElement, SourceLocation } from "../store/flatStore.ts";

export interface ImportedJsx {
  elements: FEElement[];
  attachments: Array<{ parentId: string; childId: string }>;
  rootIds: string[];
}

function tagName(node: { name?: { type?: string; name?: string; property?: { name?: string } } }): string {
  const name = node.name;
  if (!name) return "div";
  if (name.type === "JSXIdentifier") return name.name || "div";
  if (name.type === "JSXMemberExpression") return name.property?.name || "div";
  return "div";
}

function literalClassName(opening: {
  attributes?: Array<{ type?: string; name?: { name?: string }; value?: { type?: string; value?: string } }>;
} | null | undefined): string {
  if (!opening) return "";
  const attr = (opening.attributes || []).find(
    (item) => item.type === "JSXAttribute" && item.name?.name === "className"
  );
  if (!attr?.value) return "";
  if (attr.value.type === "StringLiteral") return attr.value.value || "";
  return "";
}

function textOf(children: Array<{ type?: string; value?: string; children?: unknown[] }> | undefined): string | undefined {
  if (!children) return undefined;
  const texts = children
    .filter((child) => child.type === "JSXText")
    .map((child) => (child.value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return texts.length > 0 ? texts.join(" ") : undefined;
}

export function jsxElementId(filePath: string, line: number, column: number, tag: string): string {
  return `jsx:${filePath}:${line}:${column}:${tag}`;
}

function unwrapJsx(node: { type?: string; expression?: unknown } | undefined): unknown | null {
  if (!node) return null;
  if (node.type === "ParenthesizedExpression") return unwrapJsx(node.expression as { type?: string; expression?: unknown });
  if (node.type === "JSXElement" || node.type === "JSXFragment") return node;
  return null;
}

function returnedJsx(body: { type?: string; body?: unknown[]; expression?: unknown } | undefined): unknown | null {
  const direct = unwrapJsx(body);
  if (direct) return direct;
  if (!body || body.type !== "BlockStatement" || !Array.isArray(body.body)) return null;
  for (let i = body.body.length - 1; i >= 0; i -= 1) {
    const stmt = body.body[i] as { type?: string; argument?: { type?: string } };
    if (stmt?.type === "ReturnStatement") return unwrapJsx(stmt.argument);
  }
  return null;
}

function functionName(path: {
  node: { id?: { name?: string }; key?: { name?: string } };
  parent?: { type?: string; id?: { name?: string }; key?: { name?: string } };
}): string | null {
  if (path.node.id?.name) return path.node.id.name;
  const parent = path.parent;
  if (parent?.type === "VariableDeclarator" && parent.id?.name) return parent.id.name;
  if (parent?.type === "ObjectProperty" && parent.key?.name) return parent.key.name;
  return null;
}

function jsxChildren(node: {
  type?: string;
  children?: unknown[];
  openingElement?: unknown;
}): unknown[] {
  if (!node) return [];
  if (node.type === "JSXFragment") return node.children || [];
  if (node.type === "JSXElement") return node.children || [];
  return [];
}

function asJsxElement(node: { type?: string }): { type: string; openingElement?: unknown; children?: unknown[] } | null {
  if (!node) return null;
  if (node.type === "JSXElement") return node as { type: string; openingElement?: unknown; children?: unknown[] };
  if (node.type === "JSXFragment") return node as { type: string; children?: unknown[] };
  if ((node as { type?: string }).type === "ParenthesizedExpression") {
    return asJsxElement((node as { expression?: { type?: string } }).expression as { type?: string });
  }
  return null;
}

export function importJsxToElements(source: string, filePath: string): ImportedJsx {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"]
  });
  const trav = (traverse as any).default || traverse;
  const components = new Map<string, unknown>();
  let defaultRoot: unknown | null = null;

  trav(ast, {
    FunctionDeclaration(path: any) {
      const name = functionName(path);
      const jsx = returnedJsx(path.node.body);
      if (name && jsx) components.set(name, jsx);
      if (path.parent?.type === "ExportDefaultDeclaration" && jsx) defaultRoot = jsx;
    },
    FunctionExpression(path: any) {
      const name = functionName(path);
      const jsx = returnedJsx(path.node.body);
      if (name && jsx) components.set(name, jsx);
    },
    ArrowFunctionExpression(path: any) {
      const name = functionName(path);
      const jsx = returnedJsx(path.node.body);
      if (name && jsx) components.set(name, jsx);
      if (path.parent?.type === "ExportDefaultDeclaration" && jsx) defaultRoot = jsx;
    },
    ExportDefaultDeclaration(path: any) {
      const decl = path.node.declaration;
      if (decl?.type === "Identifier" && components.has(decl.name)) {
        defaultRoot = components.get(decl.name) || defaultRoot;
      } else if (decl?.type === "FunctionDeclaration" || decl?.type === "FunctionExpression" || decl?.type === "ArrowFunctionExpression") {
        defaultRoot = returnedJsx(decl.body) || defaultRoot;
      }
    }
  });

  const elements: FEElement[] = [];
  const attachments: Array<{ parentId: string; childId: string }> = [];
  const rootIds: string[] = [];
  const seen = new Set<string>();
  let y = 32;

  const walk = (raw: unknown, parentId: string | null, expanding: Set<string>): void => {
    const node = asJsxElement(raw as { type?: string });
    if (!node) return;
    if (node.type === "JSXFragment") {
      for (const child of jsxChildren(node)) walk(child, parentId, expanding);
      return;
    }
    const opening = node.openingElement as {
      name?: { type?: string; name?: string };
      loc?: { start?: { line: number; column: number } };
      attributes?: Array<{ type?: string; name?: { name?: string }; value?: { type?: string; value?: string } }>;
    };
    const loc = opening?.loc?.start;
    if (!loc) return;
    const tag = tagName(opening);
    if (/^[A-Z]/.test(tag) && components.has(tag) && !expanding.has(tag)) {
      const next = new Set(expanding);
      next.add(tag);
      walk(components.get(tag), parentId, next);
      return;
    }
    const id = jsxElementId(filePath, loc.line, loc.column, tag);
    if (seen.has(id)) return;
    seen.add(id);
    const className = literalClassName(opening);
    const sourceLocation: SourceLocation = { filePath, line: loc.line, column: loc.column };
    const depth = parentId ? 1 : 0;
    const height = tag === "p" || tag === "h1" || tag === "h2" ? 36 : 44;
    const el: FEElement = {
      id,
      type: "element",
      tag,
      props: {
        ...(className ? { className } : {}),
        "data-testid": `node-${id}`
      },
      textContent: textOf(node.children as Array<{ type?: string; value?: string }>),
      canvasRect: {
        left: 48 + depth * 28,
        top: y,
        width: Math.max(220, 420 - depth * 28),
        height
      },
      sourceLocation
    };
    y += height + 12;
    elements.push(el);
    if (parentId) attachments.push({ parentId, childId: id });
    else rootIds.push(id);
    for (const child of jsxChildren(node)) walk(child, id, expanding);
  };

  if (defaultRoot) {
    walk(defaultRoot, null, new Set());
  } else {
    trav(ast, {
      JSXElement: {
        enter(path: any) {
          const opening = path.node.openingElement;
          const loc = opening.loc?.start;
          if (!loc) return;
          const tag = tagName(opening);
          const id = jsxElementId(filePath, loc.line, loc.column, tag);
          if (seen.has(id)) return;
          seen.add(id);
          const className = literalClassName(opening);
          const sourceLocation: SourceLocation = { filePath, line: loc.line, column: loc.column };
          const parentPath = path.parentPath;
          const parentOpening = parentPath?.node?.openingElement;
          const parentLoc = parentOpening?.loc?.start;
          const parentTag = parentOpening ? tagName(parentOpening) : "";
          const parentId =
            parentPath?.node?.type === "JSXElement" && parentLoc
              ? jsxElementId(filePath, parentLoc.line, parentLoc.column, parentTag)
              : null;
          const depth = parentId ? 1 : 0;
          const height = tag === "p" || tag === "h1" || tag === "h2" ? 36 : 44;
          elements.push({
            id,
            type: "element",
            tag,
            props: {
              ...(className ? { className } : {}),
              "data-testid": `node-${id}`
            },
            textContent: textOf(path.node.children),
            canvasRect: {
              left: 48 + depth * 28,
              top: y,
              width: Math.max(220, 420 - depth * 28),
              height
            },
            sourceLocation
          });
          y += height + 12;
          if (parentId && seen.has(parentId)) attachments.push({ parentId, childId: id });
          else if (!parentId) rootIds.push(id);
        }
      }
    });
  }

  return { elements, attachments, rootIds };
}
