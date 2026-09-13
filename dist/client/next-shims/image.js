/**
 * next/image 离线安全垫片
 * 将 Next.js 服务端图像优化组件降维映射为标准 <img> 渲染
 */
export function Image(props) {
    const { src, alt, width, height, fill, className, style = {}, ...rest } = props;
    const actualSrc = typeof src === "object" && src !== null ? src.src : src;
    const finalStyle = fill
        ? {
            position: "absolute",
            height: "100%",
            width: "100%",
            inset: 0,
            objectFit: "cover",
            ...style
        }
        : {
            width,
            height,
            ...style
        };
    return {
        type: "img",
        props: {
            src: actualSrc,
            alt,
            style: finalStyle,
            className,
            ...rest
        }
    };
}
export default Image;
//# sourceMappingURL=image.js.map