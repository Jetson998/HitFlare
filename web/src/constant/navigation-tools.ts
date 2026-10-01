import { House, Sparkles, Images, Lightbulb, ScanSearch, UsersRound, Video } from "lucide-react";

export const navigationTools = [
    { slug: "home", path: "/", icon: House },
    { slug: "image", path: "/image", icon: Sparkles },
    { slug: "video", path: "/video", icon: Video },
    { slug: "prompts", path: "/prompts", icon: Lightbulb },
    { slug: "reversePrompt", path: "/reverse-prompt", icon: ScanSearch },
    { slug: "assets", path: "/assets", icon: Images },
] as const;

export const adminNavigationTool = { slug: "users", path: "/admin/users", icon: UsersRound } as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | typeof adminNavigationTool.slug;
