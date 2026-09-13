import { House, Sparkles, Images, Lightbulb, UsersRound } from "lucide-react";

export const navigationTools = [
    { slug: "home", path: "/", icon: House },
    { slug: "image", path: "/image", icon: Sparkles },
    { slug: "assets", path: "/assets", icon: Images },
    { slug: "prompts", path: "/prompts", icon: Lightbulb },
] as const;

export const adminNavigationTool = { slug: "users", path: "/admin/users", icon: UsersRound } as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | typeof adminNavigationTool.slug;
