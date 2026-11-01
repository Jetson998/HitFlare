import { AgentNavIcon, AssetsNavIcon, CanvasNavIcon, ImageNavIcon, LogsNavIcon, PromptsNavIcon, SearchNavIcon, StorageNavIcon, UsersNavIcon, VideoNavIcon } from "@/components/layout/nav-icons";

export const navigationTools = [
    { slug: "home", path: "/", icon: ImageNavIcon },
    { slug: "image", path: "/image", icon: ImageNavIcon },
    { slug: "agent", path: "/agent", icon: AgentNavIcon },
    { slug: "reversePrompt", path: "/reverse-prompt", icon: SearchNavIcon },
    { slug: "canvas", path: "/canvas", icon: CanvasNavIcon },
    { slug: "video", path: "/video", icon: VideoNavIcon },
    { slug: "assets", path: "/assets", icon: AssetsNavIcon },
    { slug: "prompts", path: "/prompts", icon: PromptsNavIcon },
] as const;

export const adminNavigationTools = [
    { slug: "users", path: "/admin/users", icon: UsersNavIcon },
    { slug: "logs", path: "/admin/logs", icon: LogsNavIcon },
    { slug: "storage", path: "/admin/storage", icon: StorageNavIcon },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | (typeof adminNavigationTools)[number]["slug"];

const temporarilyAdminOnly = new Set<NavigationToolSlug>(["canvas"]);

export function visibleNavigationTools(isAdmin: boolean) {
    const tools = isAdmin ? [...navigationTools, ...adminNavigationTools] : navigationTools;
    return isAdmin ? tools : tools.filter((tool) => !temporarilyAdminOnly.has(tool.slug));
}
