function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function snapshotJsxAsSvgDataUrl(elementId: string, jsx: string): string {
  const source = jsx || "(missing element)";
  const lines = source.split("\n").slice(0, 8);
  const textNodes = [
    `<text x="12" y="28" font-size="14" font-family="monospace" fill="#e2e8f0">${escapeXml(elementId)}</text>`,
    ...lines.map(
      (line, i) =>
        `<text x="12" y="${52 + i * 16}" font-size="11" font-family="monospace" fill="#94a3b8">${escapeXml(line.slice(0, 90))}</text>`
    )
  ];
  const height = 64 + lines.length * 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${height}" viewBox="0 0 720 ${height}"><rect width="100%" height="100%" fill="#0f172a"/><text x="12" y="16" font-size="10" fill="#64748b">jsx snapshot (not a raster of the live canvas)</text>${textNodes.join("")}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
