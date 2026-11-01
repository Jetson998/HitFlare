export function mediaPreviewSrc(url: string, edge: 96 | 640) {
    if (!url.startsWith("/api/workspace/media/") || !url.includes("/content")) return url;
    return `${url.split("?")[0]}?edge=${edge}`;
}
