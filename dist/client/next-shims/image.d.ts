/**
 * next/image 离线安全垫片
 * 将 Next.js 服务端图像优化组件降维映射为标准 <img> 渲染
 */
export interface ImageProps {
    src: string | {
        src: string;
    };
    alt: string;
    width?: number | string;
    height?: number | string;
    fill?: boolean;
    className?: string;
    style?: Record<string, any>;
    priority?: boolean;
    quality?: number;
    [key: string]: any;
}
export declare function Image(props: ImageProps): {
    type: string;
    props: {
        priority?: boolean;
        quality?: number;
        src: string;
        alt: string;
        style: Record<string, any>;
        className: string | undefined;
    };
};
export default Image;
//# sourceMappingURL=image.d.ts.map