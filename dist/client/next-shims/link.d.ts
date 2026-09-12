/**
 * next/link 离线安全垫片
 * 阻止直接页面刷新，通过自定义事件通知画布模拟导航
 */
export interface LinkProps {
    href: string;
    children?: any;
    className?: string;
    replace?: boolean;
    scroll?: boolean;
    prefetch?: boolean;
    onClick?: (e: any) => void;
    [key: string]: any;
}
export declare function Link(props: LinkProps): {
    type: string;
    props: {
        replace?: boolean;
        scroll?: boolean;
        prefetch?: boolean;
        href: string;
        className: string | undefined;
        onClick: (e: any) => void;
        children: any;
    };
};
export default Link;
//# sourceMappingURL=link.d.ts.map