/**
 * next/navigation 状态存根
 * 模拟 useRouter, usePathname, useSearchParams, useParams
 */
let currentVirtualPath = "/";
let currentVirtualSearch = "";
export function setVirtualLocation(pathname, search = "") {
    currentVirtualPath = pathname;
    currentVirtualSearch = search;
}
export function useRouter() {
    return {
        push(url) {
            const parts = url.split("?");
            setVirtualLocation(parts[0], parts[1] || "");
        },
        replace(url) {
            const parts = url.split("?");
            setVirtualLocation(parts[0], parts[1] || "");
        },
        back() { },
        forward() { },
        refresh() { },
        prefetch() { }
    };
}
export function usePathname() {
    return currentVirtualPath;
}
export function useSearchParams() {
    return new URLSearchParams(currentVirtualSearch);
}
export function useParams() {
    return {};
}
//# sourceMappingURL=navigation.js.map