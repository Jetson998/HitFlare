const KEY = "hitflare-click-timer";

function readAll(): Record<string, number> {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

export function readClick(id?: string) {
    if (!id) return 0;
    const saved = Number(readAll()[id]);
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
}

export function rememberClick(id: string, startedAt: number) {
    const existing = readClick(id);
    if (!id || existing) return existing;
    const all = readAll();
    all[id] = startedAt;
    const entries = Object.entries(all).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 40);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
    return startedAt;
}
