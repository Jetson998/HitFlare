import { useEffect, useState } from "react";
import { Dropdown, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, KeyRound, LogOut, Settings2 } from "lucide-react";
import { SidebarNavIcon } from "@/components/layout/nav-icons";
import { useTranslation } from "react-i18next";

import { Logo } from "@/components/Logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { visibleNavigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { useIsAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const groups = [
    { id: "create", label: "groupCreate", slugs: ["image", "agent", "reversePrompt"], pinBottom: false },
    { id: "library", label: "", slugs: ["assets", "prompts"], pinBottom: false },
    { id: "admin", label: "groupAdmin", slugs: ["users", "logs", "storage"], pinBottom: false },
    { id: "experimental", label: "groupExperimental", slugs: ["canvas", "video"], pinBottom: true },
] as const;
const storageKey = "hitflare.sidebar.collapsed";

export function AppSideNav() {
    const { t, i18n } = useTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const isAdmin = useIsAdmin();
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === "1");
    const [passwordToken, setPasswordToken] = useState(0);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const logout = useUserStore((state) => state.logout);
    const tools = visibleNavigationTools(isAdmin);
    const active = tools.find((tool) => tool.path === pathname)?.slug as NavigationToolSlug | undefined;
    const current = tools.find((tool) => tool.slug === active);
    const menuItems = groups.flatMap((group, index) => {
        const items = group.slugs.flatMap((slug) => tools.filter((tool) => tool.slug === slug)).map((tool) => {
            const Icon = tool.icon;
            return { key: tool.slug, icon: <Icon className="size-[18px]" />, label: t(`navigation.${tool.slug}`) };
        });
        return items.length && index ? [{ type: "divider" as const }, ...items] : items;
    });
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const narrowItems = [
        ...menuItems,
        { type: "divider" as const },
        { key: "config", icon: <Settings2 className="size-4" />, label: t("navigation.config") },
        { key: "language", label: t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") }) },
        { key: "theme", label: t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme") },
        { key: "password", icon: <KeyRound className="size-4" />, label: t("auth.changePassword") },
        { key: "logout", icon: <LogOut className="size-4" />, label: t("auth.logout") },
    ];
    useEffect(() => { localStorage.setItem(storageKey, collapsed ? "1" : "0"); }, [collapsed]);

    return (
        <aside className={cn("relative flex min-h-14 w-full shrink-0 flex-row items-center gap-3 overflow-x-hidden border-b border-[#E7E9EE] bg-[#F7F8FA] px-[clamp(24px,2cqi,48px)] text-[#374151] dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 @min-[960px]/app:h-dvh @min-[960px]/app:flex-col @min-[960px]/app:items-stretch @min-[960px]/app:gap-0 @min-[960px]/app:overflow-hidden @min-[960px]/app:border-b-0 @min-[960px]/app:border-r @min-[960px]/app:px-0", collapsed ? "@min-[960px]/app:w-16" : "@min-[960px]/app:w-[180px]")}>
            <div className={cn("hidden shrink-0 items-center justify-between py-2 @min-[960px]/app:flex @min-[960px]/app:w-full @min-[960px]/app:items-start @min-[960px]/app:px-2 @min-[960px]/app:pb-3 @min-[960px]/app:pt-4", collapsed && "@min-[960px]/app:flex-col @min-[960px]/app:items-center @min-[960px]/app:justify-center @min-[960px]/app:gap-1 @min-[960px]/app:px-0 @min-[960px]/app:pb-1")}>
                <Link to="/" aria-label="首页" className="flex min-w-0 items-center bg-transparent">
                    {collapsed ? <span className="inline-flex"><Logo variant="mark" size={32} className="bg-transparent" /></span> : <span className="-translate-y-1.5 inline-flex"><Logo variant="sidebar" size={40} /></span>}
                </Link>
                <Tooltip title={collapsed ? "展开菜单" : "收起菜单"} placement="right" mouseEnterDelay={0}>
                    <button type="button" className="hidden size-9 shrink-0 place-items-center rounded-md text-[#6B7280] hover:bg-[#EEF1F4] @min-[960px]/app:grid dark:text-stone-400 dark:hover:bg-white/10" aria-expanded={!collapsed} aria-label={collapsed ? "展开菜单" : "收起菜单"} onClick={() => setCollapsed((value) => !value)}>
                        <SidebarNavIcon className="size-4" />
                    </button>
                </Tooltip>
            </div>
            <Link to="/" aria-label="首页" className="relative z-10 -translate-y-0.5 grid shrink-0 place-items-center bg-transparent @min-[960px]/app:hidden"><Logo variant="horizontal-en" size={28} className="bg-transparent" /></Link>
            <div className="flex min-w-0 flex-1 items-center justify-center @min-[960px]/app:hidden">
                <Dropdown trigger={["click"]} placement="bottom" classNames={{ root: "[&_.ant-dropdown-menu]:rounded-2xl [&_.ant-dropdown-menu]:p-1.5 [&_.ant-dropdown-menu]:shadow-[0_16px_40px_rgba(15,23,42,.12)]" }} menu={{ items: narrowItems.map((item) => item.type === "divider" ? item : { ...item, className: "!my-0.5 !rounded-xl" }), selectedKeys: active ? [active] : [], onClick: ({ key }) => { if (key === "config") { openConfigDialog(false); return; } if (key === "language") { void changeAppLocale(nextLocale); return; } if (key === "theme") { setTheme(theme === "dark" ? "light" : "dark"); return; } if (key === "password") { setPasswordToken((value) => value + 1); return; } if (key === "logout") { void logout(); return; } const tool = tools.find((item) => item.slug === key); if (tool) navigate(tool.path); } }}>
                    <button type="button" className="inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-full bg-white/80 px-3 text-[13px] leading-none text-[#374151] shadow-[0_1px_2px_rgba(16,24,40,.06)] dark:bg-stone-900/80 dark:text-stone-200" aria-label="打开菜单" aria-haspopup="menu">
                        <span className="truncate">{current ? t(`navigation.${current.slug}`) : "菜单"}</span>
                        <ChevronDown className="size-4 shrink-0" />
                    </button>
                </Dropdown>
            </div>
            <nav aria-label={t("navigation.groupCreate")} className="hidden min-w-0 flex-1 @min-[960px]/app:flex @min-[960px]/app:flex-col @min-[960px]/app:items-stretch @min-[960px]/app:gap-0 @min-[960px]/app:overflow-y-auto @min-[960px]/app:px-2 @min-[960px]/app:pb-3">
                {groups.map((group, index) => {
                    const items = group.slugs.flatMap((slug) => tools.filter((tool) => tool.slug === slug));
                    if (!items.length) return null;
                    return (
                        <div key={group.id} className={cn("flex items-center gap-1 @min-[960px]/app:flex-col @min-[960px]/app:items-stretch", index > 0 && "ml-1 border-l border-[#E7E9EE] pl-1 @min-[960px]/app:ml-0 @min-[960px]/app:border-l-0 @min-[960px]/app:border-t @min-[960px]/app:pl-0 @min-[960px]/app:pt-2 dark:border-stone-800", group.pinBottom ? "@min-[960px]/app:mt-auto" : index > 0 && "@min-[960px]/app:mt-2")}>
                            {group.label ? <div className={cn("hidden px-3 pb-1 pt-3 text-xs font-medium text-[#98A2B3] dark:text-stone-500", !collapsed && "@min-[960px]/app:block")}>{t(`navigation.${group.label}`)}</div> : null}
                            {items.map((tool) => {
                                const current = tool.slug === active;
                                const label = t(`navigation.${tool.slug}`);
                                const Icon = tool.icon;
                                const link = (
                                    <Link
                                        key={tool.slug}
                                        to={tool.path}
                                        aria-current={current ? "page" : undefined}
                                        aria-label={label}
                                        className={cn(
                                            "relative flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-[#374151] hover:bg-[#EEF1F4] dark:text-stone-300 dark:hover:bg-white/10",
                                            current && "bg-[#ECEFF3] font-medium text-[#111827] dark:bg-stone-800 dark:text-stone-100",
                                            "@min-[960px]/app:w-full",
                                            collapsed && "@min-[960px]/app:justify-center @min-[960px]/app:px-0",
                                        )}
                                    >
                                        {current ? <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-[#1D4ED8] @min-[960px]/app:bottom-2 @min-[960px]/app:left-0 @min-[960px]/app:right-auto @min-[960px]/app:h-4 @min-[960px]/app:w-[3px]" /> : null}
                                        <Icon className="size-[18px] shrink-0" />
                                        <span className={cn("truncate", collapsed && "@min-[960px]/app:sr-only")}>{label}</span>
                                    </Link>
                                );
                                return collapsed ? <Tooltip key={tool.slug} title={label} placement="right" mouseEnterDelay={0}>{link}</Tooltip> : link;
                            })}
                        </div>
                    );
                })}
            </nav>
            <div className={cn("ml-auto hidden shrink-0 items-center @min-[960px]/app:ml-0 @min-[960px]/app:flex @min-[960px]/app:mt-auto @min-[960px]/app:w-full @min-[960px]/app:border-t @min-[960px]/app:border-[#E7E9EE] @min-[960px]/app:py-3 dark:border-stone-800", collapsed ? "@min-[960px]/app:justify-center @min-[960px]/app:px-1" : "@min-[960px]/app:px-3")}>
                <UserStatusActions variant="sidebar" collapsed={collapsed} openPasswordToken={passwordToken} />
            </div>
        </aside>
    );
}
