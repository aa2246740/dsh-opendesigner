import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
function tagName(node) {
    const name = node.name;
    if (!name)
        return "div";
    if (name.type === "JSXIdentifier")
        return name.name || "div";
    if (name.type === "JSXMemberExpression")
        return name.property?.name || "div";
    return "div";
}
function literalClassName(opening) {
    if (!opening)
        return "";
    const attr = (opening.attributes || []).find((item) => item.type === "JSXAttribute" && item.name?.name === "className");
    if (!attr?.value)
        return "";
    if (attr.value.type === "StringLiteral")
        return attr.value.value || "";
    return "";
}
function textOf(children) {
    if (!children)
        return undefined;
    const texts = children
        .filter((child) => child.type === "JSXText")
        .map((child) => (child.value || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    return texts.length > 0 ? texts.join(" ") : undefined;
}
export function jsxElementId(filePath, line, column, tag) {
    return `jsx:${filePath}:${line}:${column}:${tag}`;
}
function unwrapJsx(node) {
    if (!node)
        return null;
    if (node.type === "ParenthesizedExpression")
        return unwrapJsx(node.expression);
    if (node.type === "JSXElement" || node.type === "JSXFragment")
        return node;
    return null;
}
function returnedJsx(body) {
    const direct = unwrapJsx(body);
    if (direct)
        return direct;
    if (!body || body.type !== "BlockStatement" || !Array.isArray(body.body))
        return null;
    for (let i = body.body.length - 1; i >= 0; i -= 1) {
        const stmt = body.body[i];
        if (stmt?.type === "ReturnStatement")
            return unwrapJsx(stmt.argument);
    }
    return null;
}
function functionName(path) {
    if (path.node.id?.name)
        return path.node.id.name;
    const parent = path.parent;
    if (parent?.type === "VariableDeclarator" && parent.id?.name)
        return parent.id.name;
    if (parent?.type === "ObjectProperty" && parent.key?.name)
        return parent.key.name;
    return null;
}
function jsxChildren(node) {
    if (!node)
        return [];
    if (node.type === "JSXFragment")
        return node.children || [];
    if (node.type === "JSXElement")
        return node.children || [];
    return [];
}
function asJsxElement(node) {
    if (!node)
        return null;
    if (node.type === "JSXElement")
        return node;
    if (node.type === "JSXFragment")
        return node;
    if (node.type === "ParenthesizedExpression") {
        return asJsxElement(node.expression);
    }
    return null;
}
export function importJsxToElements(source, filePath) {
    const ast = parse(source, {
        sourceType: "module",
        plugins: ["jsx", "typescript"]
    });
    const trav = traverse.default || traverse;
    const components = new Map();
    let defaultRoot = null;
    trav(ast, {
        FunctionDeclaration(path) {
            const name = functionName(path);
            const jsx = returnedJsx(path.node.body);
            if (name && jsx)
                components.set(name, jsx);
            if (path.parent?.type === "ExportDefaultDeclaration" && jsx)
                defaultRoot = jsx;
        },
        FunctionExpression(path) {
            const name = functionName(path);
            const jsx = returnedJsx(path.node.body);
            if (name && jsx)
                components.set(name, jsx);
        },
        ArrowFunctionExpression(path) {
            const name = functionName(path);
            const jsx = returnedJsx(path.node.body);
            if (name && jsx)
                components.set(name, jsx);
            if (path.parent?.type === "ExportDefaultDeclaration" && jsx)
                defaultRoot = jsx;
        },
        ExportDefaultDeclaration(path) {
            const decl = path.node.declaration;
            if (decl?.type === "Identifier" && components.has(decl.name)) {
                defaultRoot = components.get(decl.name) || defaultRoot;
            }
            else if (decl?.type === "FunctionDeclaration" || decl?.type === "FunctionExpression" || decl?.type === "ArrowFunctionExpression") {
                defaultRoot = returnedJsx(decl.body) || defaultRoot;
            }
        }
    });
    const elements = [];
    const attachments = [];
    const rootIds = [];
    const seen = new Set();
    let y = 32;
    const walk = (raw, parentId, expanding) => {
        const node = asJsxElement(raw);
        if (!node)
            return;
        if (node.type === "JSXFragment") {
            for (const child of jsxChildren(node))
                walk(child, parentId, expanding);
            return;
        }
        const opening = node.openingElement;
        const loc = opening?.loc?.start;
        if (!loc)
            return;
        const tag = tagName(opening);
        if (/^[A-Z]/.test(tag) && components.has(tag) && !expanding.has(tag)) {
            const next = new Set(expanding);
            next.add(tag);
            walk(components.get(tag), parentId, next);
            return;
        }
        const id = jsxElementId(filePath, loc.line, loc.column, tag);
        if (seen.has(id))
            return;
        seen.add(id);
        const className = literalClassName(opening);
        const sourceLocation = { filePath, line: loc.line, column: loc.column };
        const depth = parentId ? 1 : 0;
        const height = tag === "p" || tag === "h1" || tag === "h2" ? 36 : 44;
        const el = {
            id,
            type: "element",
            tag,
            props: {
                ...(className ? { className } : {}),
                "data-testid": `node-${id}`
            },
            textContent: textOf(node.children),
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
        if (parentId)
            attachments.push({ parentId, childId: id });
        else
            rootIds.push(id);
        for (const child of jsxChildren(node))
            walk(child, id, expanding);
    };
    if (defaultRoot) {
        walk(defaultRoot, null, new Set());
    }
    else {
        trav(ast, {
            JSXElement: {
                enter(path) {
                    const opening = path.node.openingElement;
                    const loc = opening.loc?.start;
                    if (!loc)
                        return;
                    const tag = tagName(opening);
                    const id = jsxElementId(filePath, loc.line, loc.column, tag);
                    if (seen.has(id))
                        return;
                    seen.add(id);
                    const className = literalClassName(opening);
                    const sourceLocation = { filePath, line: loc.line, column: loc.column };
                    const parentPath = path.parentPath;
                    const parentOpening = parentPath?.node?.openingElement;
                    const parentLoc = parentOpening?.loc?.start;
                    const parentTag = parentOpening ? tagName(parentOpening) : "";
                    const parentId = parentPath?.node?.type === "JSXElement" && parentLoc
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
                    if (parentId && seen.has(parentId))
                        attachments.push({ parentId, childId: id });
                    else if (!parentId)
                        rootIds.push(id);
                }
            }
        });
    }
    return { elements, attachments, rootIds };
}
//# sourceMappingURL=jsxImport.js.map