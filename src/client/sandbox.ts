import type { CanvasRect, FlatStore } from "../store/flatStore.ts";
import * as NextShims from "./next-shims/index.ts";

export interface SandboxRenderOptions {
  activePath?: string;
  theme?: "light" | "dark";
  customStyles?: string;
  onError?: (err: Error) => void;
}

export interface RenderedNode {
  tag: string;
  props: Record<string, unknown>;
  children: (RenderedNode | string)[];
}

export const SANDBOX_CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'";

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

function isAllowedAttr(name: string): boolean {
  if (name.startsWith("on")) return false;
  if (name.startsWith("data-")) return true;
  if (name.startsWith("aria-")) return true;
  return ALLOWED_ATTRS.has(name);
}

function isAllowedUrl(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:")) return false;
  if (lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("data:text/html")) return false;
  if (lower.startsWith("data:image/")) return true;
  if (lower.startsWith("https:")) return true;
  if (lower.startsWith("http:")) return true;
  if (lower.startsWith("mailto:")) return true;
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith(".")) return true;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return true;
  return false;
}

export function wrapSandboxSrcdoc(inner: string): string {
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head><body style="margin:0;background:transparent;">${inner}</body></html>`;
}

export function sandboxIframeMarkup(inner: string): string {
  const srcdoc = wrapSandboxSrcdoc(inner)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  return `<iframe class="od-sandbox-frame" data-testid="component-sandbox" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${srcdoc}" style="border:0;width:100%;height:100%;pointer-events:none;background:transparent;position:absolute;inset:0;"></iframe>`;
}

export class ComponentSandbox {
  private activePath: string;
  public nextShims: typeof NextShims;

  constructor(options: SandboxRenderOptions = {}) {
    this.activePath = options.activePath || "/";
    this.nextShims = NextShims;
    this.nextShims.setVirtualLocation(this.activePath);
  }

  public setPath(path: string): void {
    this.activePath = path;
    this.nextShims.setVirtualLocation(path);
  }

  public getShims(): typeof NextShims {
    return this.nextShims;
  }

  public renderElement(store: FlatStore, elementId: string, parentRect?: CanvasRect): RenderedNode | string {
    const el = store.getElement(elementId);
    if (!el) return "";

    if (el.type === "text") {
      return el.textContent || "";
    }

    const children = store.getChildren(elementId);
    const renderedChildren: (RenderedNode | string)[] = [];

    if (el.textContent) {
      renderedChildren.push(el.textContent);
    }

    for (const child of children) {
      renderedChildren.push(this.renderElement(store, child.id, el.canvasRect));
    }

    let finalTag = el.tag;
    const finalProps: Record<string, unknown> = { ...(el.props || {}) };

    if (el.tag === "Image" || el.tag === "next/image") {
      const shim = this.nextShims.Image({
        src: (finalProps.src as string | { src: string }) || "/placeholder.svg",
        alt: String(finalProps.alt || ""),
        width: finalProps.width as number | string | undefined,
        height: finalProps.height as number | string | undefined,
        fill: Boolean(finalProps.fill),
        className: finalProps.className as string | undefined
      });
      finalTag = shim.type;
      Object.assign(finalProps, shim.props, { "data-next-image": "true" });
    } else if (el.tag === "Link" || el.tag === "next/link") {
      const shim = this.nextShims.Link({
        href: String(finalProps.href || "#"),
        className: finalProps.className as string | undefined
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

  private applyCanvasRectStyle(
    props: Record<string, unknown>,
    rect: CanvasRect,
    parentRect?: CanvasRect
  ): void {
    const left = parentRect ? rect.left - parentRect.left : rect.left;
    const top = parentRect ? rect.top - parentRect.top : rect.top;
    const layout: Record<string, string> = {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      boxSizing: "border-box"
    };

    if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
      props.style = { ...layout, ...(props.style as Record<string, unknown>) };
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

  public renderToHtml(store: FlatStore, rootId: string): string {
    try {
      const node = this.renderElement(store, rootId);
      return this.nodeToHtmlString(node);
    } catch (err: unknown) {
      return this.renderErrorFallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private nodeToHtmlString(node: RenderedNode | string): string {
    if (typeof node === "string") {
      return this.escapeHtml(node);
    }

    const { tag, props, children } = node;
    const rawTag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) ? tag : "div";
    const safeTag = ALLOWED_TAGS.has(rawTag.toLowerCase()) ? rawTag : "div";
    const attrs = Object.entries(props)
      .map(([k, v]) => {
        if (typeof v === "function") return "";
        if (k === "children") return "";
        if (!isAllowedAttr(k)) return "";
        const attrName = k === "className" ? "class" : k;
        if (k === "style" && typeof v === "object" && v !== null) {
          const css = Object.entries(v as Record<string, unknown>)
            .map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`)
            .join(";");
          return `style="${this.escapeHtml(css)}"`;
        }
        if (typeof v === "boolean") return v ? attrName : "";
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

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private renderErrorFallback(error: Error): string {
    return `
      <div style="padding: 16px; border: 1px solid #ef4444; background: #fef2f2; color: #991b1b; border-radius: 8px; font-family: sans-serif;">
        <div style="font-weight: bold; margin-bottom: 4px;">Sandbox render isolation</div>
        <div style="font-size: 13px;">${this.escapeHtml(error.message || String(error))}</div>
      </div>
    `.trim();
  }
}
