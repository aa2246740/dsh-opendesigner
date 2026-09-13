/**
 * next/font/google 字体配置存根
 */
export function createGoogleFontStub(fontName, defaultVariable) {
    return () => ({
        className: `font-${fontName.toLowerCase()}`,
        variable: defaultVariable,
        style: { fontFamily: `${fontName}, sans-serif` }
    });
}
export const Inter = createGoogleFontStub("Inter", "--font-inter");
export const Roboto = createGoogleFontStub("Roboto", "--font-roboto");
export const Geist = createGoogleFontStub("Geist", "--font-geist-sans");
export const Geist_Mono = createGoogleFontStub("Geist_Mono", "--font-geist-mono");
//# sourceMappingURL=font.js.map