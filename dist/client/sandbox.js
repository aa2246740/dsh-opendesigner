import * as NextShims from "./next-shims/index.js";
export const SANDBOX_CSP = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src 'self' data: https:; script-src 'none'; connect-src 'none'; object-src 'none'";
export const CANVAS_TRUSTED_CSS = `
html,body{font-family:ui-sans-serif,system-ui,sans-serif;}
.min-h-screen{min-height:100vh;}
.bg-slate-950{background-color:rgb(2,6,23);}
.bg-slate-900{background-color:rgb(15,23,42);}
.bg-indigo-600{background-color:rgb(79,70,229);}
.bg-emerald-600{background-color:rgb(5,150,105);}
.bg-rose-600{background-color:rgb(225,29,72);}
.bg-amber-400{background-color:rgb(251,191,36);}
.text-slate-100{color:rgb(241,245,249);}
.text-slate-400{color:rgb(148,163,184);}
.text-white{color:rgb(255,255,255);}
.text-emerald-400{color:rgb(52,211,153);}
.text-slate-900{color:rgb(15,23,42);}
.text-2xl{font-size:1.5rem;line-height:2rem;}
.text-xl{font-size:1.25rem;line-height:1.75rem;}
.text-sm{font-size:0.875rem;line-height:1.25rem;}
.text-xs{font-size:0.75rem;line-height:1rem;}
.font-bold{font-weight:700;}
.font-semibold{font-weight:600;}
.tracking-tight{letter-spacing:-0.025em;}
.leading-relaxed{line-height:1.625;}
.p-8{padding:2rem;}
.p-6{padding:1.5rem;}
.px-4{padding-left:1rem;padding-right:1rem;}
.py-2{padding-top:0.5rem;padding-bottom:0.5rem;}
.mt-2{margin-top:0.5rem;}
.mt-4{margin-top:1rem;}
.mt-6{margin-top:1.5rem;}
.rounded-lg{border-radius:0.5rem;}
.rounded-xl{border-radius:0.75rem;}
.rounded-2xl{border-radius:1rem;}
.rounded-full{border-radius:9999px;}
.shadow-md{box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1),0 2px 4px -2px rgb(0 0 0 / 0.1);}
.shadow-lg{box-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1),0 4px 6px -4px rgb(0 0 0 / 0.1);}
.shadow-xl{box-shadow:0 20px 25px -5px rgb(0 0 0 / 0.1),0 8px 10px -6px rgb(0 0 0 / 0.1);}
.border-2{border-width:2px;border-style:solid;}
.border{border-width:1px;border-style:solid;}
.border-indigo-500{border-color:rgb(99,102,241);}
.w-\\[380px\\]{width:380px;}
.inline-flex{display:inline-flex;}
`.trim();
export function collectTrustedCanvasCss(doc) {
    const chunks = [CANVAS_TRUSTED_CSS];
    const target = doc ?? (typeof document !== "undefined" ? document : undefined);
    if (!target)
        return chunks.join("\n");
    for (const sheet of Array.from(target.styleSheets)) {
        try {
            chunks.push(...Array.from(sheet.cssRules).map((rule) => rule.cssText));
        }
        catch {
            // Cross-origin stylesheets stay out of the iframe.
        }
    }
    return chunks.join("\n");
}
function sanitizeCss(css) {
    return css.replace(/<\/style/gi, "<\\/style");
}
const ALLOWED_TAGS = new Set([
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "button",
    "caption",
    "code",
    "div",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "i",
    "img",
    "input",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    "svg",
    "path",
    "circle",
    "rect",
    "g",
    "line",
    "polyline",
    "polygon"
]);
const ALLOWED_ATTRS = new Set([
    "alt",
    "class",
    "className",
    "colspan",
    "disabled",
    "fill",
    "for",
    "height",
    "href",
    "id",
    "name",
    "placeholder",
    "rel",
    "role",
    "rowspan",
    "src",
    "stroke",
    "stroke-width",
    "style",
    "target",
    "title",
    "type",
    "value",
    "viewBox",
    "width",
    "xmlns",
    "d",
    "cx",
    "cy",
    "r",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2"
]);
function isAllowedAttr(name) {
    if (name.startsWith("on"))
        return false;
    if (name.startsWith("data-"))
        return true;
    if (name.startsWith("aria-"))
        return true;
    return ALLOWED_ATTRS.has(name);
}
function isAllowedUrl(value) {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:"))
        return false;
    if (lower.startsWith("vbscript:"))
        return false;
    if (lower.startsWith("data:text/html"))
        return false;
    if (lower.startsWith("data:image/"))
        return true;
    if (lower.startsWith("https:"))
        return true;
    if (lower.startsWith("http:"))
        return true;
    if (lower.startsWith("mailto:"))
        return true;
    if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("."))
        return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed))
        return true;
    return false;
}
export function wrapSandboxSrcdoc(inner, options = {}) {
    const css = sanitizeCss(options.css ?? CANVAS_TRUSTED_CSS);
    return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><style>${css}</style></head><body style="margin:0;background:transparent;">${inner}</body></html>`;
}
export function sandboxIframeMarkup(inner, options = {}) {
    const srcdoc = wrapSandboxSrcdoc(inner, options)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");
    return `<iframe class="od-sandbox-frame" data-testid="component-sandbox" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${srcdoc}" style="border:0;width:100%;height:100%;pointer-events:none;background:transparent;position:absolute;inset:0;"></iframe>`;
}
export class ComponentSandbox {
    activePath;
    nextShims;
    constructor(options = {}) {
        this.activePath = options.activePath || "/";
        this.nextShims = NextShims;
        this.nextShims.setVirtualLocation(this.activePath);
    }
    setPath(path) {
        this.activePath = path;
        this.nextShims.setVirtualLocation(path);
    }
    getShims() {
        return this.nextShims;
    }
    renderElement(store, elementId, parentRect) {
        const el = store.getElement(elementId);
        if (!el)
            return "";
        if (el.type === "text") {
            return el.textContent || "";
        }
        const children = store.getChildren(elementId);
        const renderedChildren = [];
        if (el.textContent) {
            renderedChildren.push(el.textContent);
        }
        for (const child of children) {
            renderedChildren.push(this.renderElement(store, child.id, el.canvasRect));
        }
        let finalTag = el.tag;
        const finalProps = { ...(el.props || {}) };
        if (el.tag === "Image" || el.tag === "next/image") {
            const shim = this.nextShims.Image({
                src: finalProps.src || "/placeholder.svg",
                alt: String(finalProps.alt || ""),
                width: finalProps.width,
                height: finalProps.height,
                fill: Boolean(finalProps.fill),
                className: finalProps.className
            });
            finalTag = shim.type;
            Object.assign(finalProps, shim.props, { "data-next-image": "true" });
        }
        else if (el.tag === "Link" || el.tag === "next/link") {
            const shim = this.nextShims.Link({
                href: String(finalProps.href || "#"),
                className: finalProps.className
            });
            finalTag = shim.type;
            Object.assign(finalProps, shim.props, { "data-next-link": "true" });
        }
        if (!finalProps["data-element-id"]) {
            finalProps["data-element-id"] = el.id;
        }
        if (!finalProps["data-testid"]) {
            finalProps["data-testid"] = `node-${el.id}`;
        }
        if (el.canvasRect) {
            this.applyCanvasRectStyle(finalProps, el.canvasRect, parentRect);
        }
        return {
            tag: finalTag,
            props: finalProps,
            children: renderedChildren
        };
    }
    applyCanvasRectStyle(props, rect, parentRect) {
        const left = parentRect ? rect.left - parentRect.left : rect.left;
        const top = parentRect ? rect.top - parentRect.top : rect.top;
        const layout = {
            position: "absolute",
            left: `${left}px`,
            top: `${top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            boxSizing: "border-box"
        };
        if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
            props.style = { ...layout, ...props.style };
            return;
        }
        if (typeof props.style === "string" && props.style.trim()) {
            const css = Object.entries(layout)
                .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
                .join(";");
            props.style = `${css};${props.style}`;
            return;
        }
        props.style = layout;
    }
    renderToHtml(store, rootId) {
        try {
            const node = this.renderElement(store, rootId);
            return this.nodeToHtmlString(node);
        }
        catch (err) {
            return this.renderErrorFallback(err instanceof Error ? err : new Error(String(err)));
        }
    }
    nodeToHtmlString(node) {
        if (typeof node === "string") {
            return this.escapeHtml(node);
        }
        const { tag, props, children } = node;
        const rawTag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) ? tag : "div";
        const safeTag = ALLOWED_TAGS.has(rawTag.toLowerCase()) ? rawTag : "div";
        const attrs = Object.entries(props)
            .map(([k, v]) => {
            if (typeof v === "function")
                return "";
            if (k === "children")
                return "";
            if (!isAllowedAttr(k))
                return "";
            const attrName = k === "className" ? "class" : k;
            if (k === "style" && typeof v === "object" && v !== null) {
                const css = Object.entries(v)
                    .map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`)
                    .join(";");
                return `style="${this.escapeHtml(css)}"`;
            }
            if (typeof v === "boolean")
                return v ? attrName : "";
            let text = typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v);
            if ((attrName === "href" || attrName === "src" || attrName === "xlink:href") && !isAllowedUrl(text)) {
                return "";
            }
            return `${attrName}="${this.escapeHtml(text)}"`;
        })
            .filter(Boolean)
            .join(" ");
        const attrStr = attrs ? ` ${attrs}` : "";
        const selfClosingTags = new Set(["img", "input", "br", "hr", "meta", "link"]);
        if (selfClosingTags.has(safeTag.toLowerCase()) && children.length === 0) {
            return `<${safeTag}${attrStr} />`;
        }
        const innerHtml = children.map((c) => this.nodeToHtmlString(c)).join("");
        return `<${safeTag}${attrStr}>${innerHtml}</${safeTag}>`;
    }
    escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    renderErrorFallback(error) {
        return `
      <div style="padding: 16px; border: 1px solid #ef4444; background: #fef2f2; color: #991b1b; border-radius: 8px; font-family: sans-serif;">
        <div style="font-weight: bold; margin-bottom: 4px;">Sandbox render isolation</div>
        <div style="font-size: 13px;">${this.escapeHtml(error.message || String(error))}</div>
      </div>
    `.trim();
    }
}
//# sourceMappingURL=sandbox.js.map