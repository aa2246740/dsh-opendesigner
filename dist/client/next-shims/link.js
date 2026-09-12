/**
 * next/link 离线安全垫片
 * 阻止直接页面刷新，通过自定义事件通知画布模拟导航
 */
export function Link(props) {
    const { href, children, className, onClick, ...rest } = props;
    const handleClick = (e) => {
        if (e && typeof e.preventDefault === "function") {
            e.preventDefault();
        }
        if (onClick)
            onClick(e);
        if (typeof globalThis !== "undefined" && typeof globalThis.dispatchEvent === "function") {
            try {
                globalThis.dispatchEvent(new CustomEvent("designer:navigate", { detail: { href } }));
            }
            catch {
                // ignore in non-dom environment
            }
        }
    };
    return {
        type: "a",
        props: {
            href,
            className,
            onClick: handleClick,
            children,
            ...rest
        }
    };
}
export default Link;
//# sourceMappingURL=link.js.map