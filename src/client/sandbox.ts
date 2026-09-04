/**
 * 组件沙箱渲染容器 (Component Sandbox Container)
 * 深度集成 next-shims 模拟 Next.js 与 React 19 运行时环境
 * 提供安全错误边界隔离与虚拟 DOM / 静态 HTML 预览生成
 */

import type { FEElement, FlatStore } from "../store/flatStore.ts";
import * as NextShims from "./next-shims/index.ts";

export interface SandboxRenderOptions {
  activePath?: string;
  theme?: "light" | "dark";
  customStyles?: string;
  onError?: (err: Error) => void;
}

export interface RenderedNode {
  tag: string;
  props: Record<string, any>;
  children: (RenderedNode | string)[];
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

  /**
   * 将 FlatStore 节点递归渲染为安全虚拟 DOM 结构
   */
  public renderElement(store: FlatStore, elementId: string): RenderedNode | string {
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
      renderedChildren.push(this.renderElement(store, child.id));
    }

    // 针对 Next.js 常见组件做 Shim 处理
    let finalTag = el.tag;
    const finalProps: Record<string, any> = { ...(el.props || {}) };

    if (el.tag === "Image" || el.tag === "next/image") {
      const shim = this.nextShims.Image({
        src: finalProps.src || "/placeholder.svg",
        alt: finalProps.alt || "",
        width: finalProps.width,
        height: finalProps.height,
        fill: finalProps.fill,
        className: finalProps.className
      });
      finalTag = shim.type;
      Object.assign(finalProps, shim.props, { "data-next-image": "true" });
    } else if (el.tag === "Link" || el.tag === "next/link") {
      const shim = this.nextShims.Link({
        href: finalProps.href || "#",
        className: finalProps.className
      });
      finalTag = shim.type;
      Object.assign(finalProps, shim.props, { "data-next-link": "true" });
    }

    return {
      tag: finalTag,
      props: finalProps,
      children: renderedChildren
    };
  }

  /**
   * 将虚拟渲染节点转换为 HTML 字符串（可直接注入 iframe 或 shadow DOM）
   */
  public renderToHtml(store: FlatStore, rootId: string): string {
    try {
      const node = this.renderElement(store, rootId);
      return this.nodeToHtmlString(node);
    } catch (err: any) {
      return this.renderErrorFallback(err);
    }
  }

  private nodeToHtmlString(node: RenderedNode | string): string {
    if (typeof node === "string") {
      return this.escapeHtml(node);
    }

    const { tag, props, children } = node;
    const attrs = Object.entries(props)
      .map(([k, v]) => {
        if (typeof v === "function") return "";
        if (k === "children") return "";
        const attrName = k === "className" ? "class" : k;
        if (k === "style" && typeof v === "object" && v !== null) {
          const css = Object.entries(v)
            .map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`)
            .join(";");
          return `style="${this.escapeHtml(css)}"`;
        }
        if (typeof v === "string") return `${attrName}="${this.escapeHtml(v)}"`;
        if (typeof v === "boolean") return v ? attrName : "";
        if (typeof v === "number") return `${attrName}="${v}"`;
        return `${attrName}="${this.escapeHtml(JSON.stringify(v))}"`;
      })
      .filter(Boolean)
      .join(" ");

    const attrStr = attrs ? ` ${attrs}` : "";

    const selfClosingTags = new Set(["img", "input", "br", "hr", "meta", "link"]);
    if (selfClosingTags.has(tag.toLowerCase()) && children.length === 0) {
      return `<${tag}${attrStr} />`;
    }

    const innerHtml = children.map((c) => this.nodeToHtmlString(c)).join("");
    return `<${tag}${attrStr}>${innerHtml}</${tag}>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 优雅错误边界回退渲染
   */
  private renderErrorFallback(error: Error): string {
    return `
      <div style="padding: 16px; border: 1px solid #ef4444; background: #fef2f2; color: #991b1b; border-radius: 8px; font-family: sans-serif;">
        <div style="font-weight: bold; margin-bottom: 4px;">⚠️ 沙箱渲染隔离保护</div>
        <div style="font-size: 13px;">${this.escapeHtml(error.message || String(error))}</div>
      </div>
    `.trim();
  }
}
