> **Status.** Historical notes. Not the shipped product spec. Do not use this file as an implementation checklist. Do not extend reverse-engineered protocol detail from it. See [README](../README.md) and [SHIPPED.md](./SHIPPED.md).

# 07. 浏览器端 Next.js 离线沙箱与 next-shims 垫片解析

---

## 1. 核心困境：现代 React 项目与离线纯前端沙箱

现实世界中的前端项目绝非简单的静态 HTML，大部分基于 Next.js、Remix 等全栈框架开发，充斥着大量的框架专属导入与服务端特性：
- `import Image from "next/image"`
- `import Link from "next/link"`
- `import { useRouter, usePathname } from "next/navigation"`
- `import { Inter } from "next/font/google"`
- `import dynamic from "next/dynamic"`

如果直接在浏览器纯客户端环境（如 Vite / iframe 画布）中尝试渲染这些组件，会立即触发一系列模块未定义（`Module not found`）与运行时未注入错误。

---

## 2. 核心架构：next-shims 离线模拟器

Lunagraph 在渲染进程包中内置了一套完备轻量的 **`next-shims` 运行时垫片库**（位于 `out/renderer/next-shims/`）：

```
[用户真实 Next.js 组件]
         │
         ├── import Image from 'next/image'       ───► [next-shims/image.js]
         ├── import Link from 'next/link'         ───► [next-shims/link.js]
         ├── import { useRouter } from '...'      ───► [next-shims/navigation.js]
         ├── import { Inter } from 'next/font'    ───► [next-shims/font-google.js]
         └── import dynamic from 'next/dynamic'   ───► [next-shims/dynamic.js]
```

### 关键垫片实现原理

#### (1) `next/image` 垫片
Next.js 的原生 Image 组件依赖 Node.js 端图像优化服务（`_next/image`）。垫片将其安全降维映射为标准 HTML `<img>` 标签：
```javascript
export default function Image({ src, alt, width, height, fill, style, className, ...props }) {
  const finalStyle = fill
    ? { position: "absolute", height: "100%", width: "100%", inset: 0, objectFit: "cover", ...style }
    : { width, height, ...style };
  return <img src={typeof src === "object" ? src.src : src} alt={alt} style={finalStyle} className={className} {...props} />;
}
```

#### (2) `next/navigation` 导航状态模拟
在设计器画布中，点击链接绝不能导致整个编辑器页面跳转：
- `useRouter()` 返回包含 `push()`, `replace()`, `back()` 的虚拟存根，调用时仅触发编辑器内部的模拟事件通知。
- `usePathname()` 与 `useSearchParams()` 返回由当前画布打开的页面虚拟路径与参数。

#### (3) `next/font/google` 字体垫片
在编译期截获字体函数调用，返回包含 CSS 变量名与通用系统回退字体的伪配置：
```javascript
export function createGoogleFontStub(fontName, defaultVariable) {
  return () => ({
    className: `font-${fontName.toLowerCase()}`,
    variable: defaultVariable,
    style: { fontFamily: `${fontName}, sans-serif` }
  });
}
```

---

## 3. 动态依赖解析真相：打破“云端 R2 编译”假象

在先前的调研中，曾有人猜测复杂第三方依赖需要依赖云端私有集群编译分发。

### 源码证据彻底揭穿
深入分析 `packages/compiler/src/runtime/runtime.ts` 与 `useProjectIconSettings.ts` 后发现：
**根本不存在任何私有云编译集群！**
系统完全是基于浏览器标准的 **ESM Import Map** 与公共 ESM CDN：
```typescript
const importUrl = `https://esm.sh/${importPath}?external=react,react-dom`;
```
- 所有未在本地打包的外部 npm 库，在运行时直接通过 `https://esm.sh` 动态加载 ESM 产物。
- 通过 `external=react,react-dom` 强制让所有第三方库复用沙箱内已加载的 React 19 单例实例，消除 React 多实例冲突。

---

## 4. 社区版实施指导

在 `dsh-opendesigner` 中，我们可以做到更加极致的纯本地化：
1. **完全离线优先**：本地组件与项目依赖优先利用宿主已有 `node_modules` 进行动态解析与本地服务托管。
2. **渐进式回退**：缺失的在线包采用标准 CDN 加载；对于复杂的服务端组件（如直接数据库查询、本地文件读写），沙箱外层采用 React 19 `ErrorBoundary` 进行拦截，并触发第四部分所述的 `type: "capture"` 冻结快照降级，确保画布绝不黑屏崩溃。
