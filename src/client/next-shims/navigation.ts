/**
 * next/navigation 状态存根
 * 模拟 useRouter, usePathname, useSearchParams, useParams
 */

let currentVirtualPath = "/";
let currentVirtualSearch = "";

export function setVirtualLocation(pathname: string, search: string = ""): void {
  currentVirtualPath = pathname;
  currentVirtualSearch = search;
}

export function useRouter() {
  return {
    push(url: string) {
      const parts = url.split("?");
      setVirtualLocation(parts[0], parts[1] || "");
    },
    replace(url: string) {
      const parts = url.split("?");
      setVirtualLocation(parts[0], parts[1] || "");
    },
    back() {},
    forward() {},
    refresh() {},
    prefetch() {}
  };
}

export function usePathname(): string {
  return currentVirtualPath;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(currentVirtualSearch);
}

export function useParams(): Record<string, string> {
  return {};
}
