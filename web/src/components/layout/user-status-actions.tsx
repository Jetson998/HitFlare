import type { CSSProperties } from "react";
import { useState } from "react";
import { App, Dropdown, Form, Input, Modal, Popover, Tooltip } from "antd";
import { BookOpen, KeyRound, Keyboard, LogOut, MoreHorizontal, Puzzle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { DOCS_URL } from "@/constant/env";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useIsAdmin } from "@/lib/permissions";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [passwordForm] = Form.useForm<{ currentPassword: string; password: string; confirmPassword: string }>();
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [passwordSubmitting, setPasswordSubmitting] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const user = useUserStore((state) => state.user);
    const isAdmin = useIsAdmin();
    const logout = useUserStore((state) => state.logout);
    const changePassword = useUserStore((state) => state.changePassword);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = cn(variant === "canvas" ? "size-7" : "workspace-touch-target size-8", "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4");
    const secondaryIconClass = cn(variant === "canvas" ? "size-7" : "workspace-touch-target size-7", "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-black/5 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-white/10 dark:hover:text-stone-300 [&_svg]:size-3.5");
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const gitHubClassName = variant === "canvas" ? "size-7 text-base" : "workspace-touch-target size-8 text-base";
    const gitHubStyle = iconStyle;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });
    const userDisplayName = user?.username?.trim() || user?.email?.trim() || "U";
    const submitPassword = async () => {
        const { currentPassword, password } = await passwordForm.validateFields();
        setPasswordSubmitting(true);
        try {
            await changePassword({ currentPassword, password });
            message.success("密码已修改，请重新登录");
            setPasswordOpen(false);
            passwordForm.resetFields();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码修改失败");
        } finally {
            setPasswordSubmitting(false);
        }
    };

    const utilityActions = (<>
            {onOpenPlugins && isAdmin ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {variant === "canvas" ? (
                <>
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.docs")} title={t("topNav.docs")}>
                        <BookOpen className="size-4" />
                    </a>
                </>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={`${secondaryIconClass} text-[10px] font-medium tracking-tight`} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={secondaryIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            {variant === "canvas" ? <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} /> : null}
    </>);

    return (
        <>
        <div className="inline-flex shrink-0 items-center gap-1">
            <div className={cn("flex items-center gap-1", variant === "default" && "hidden @min-[640px]/shell:flex")}>{utilityActions}</div>
            {variant === "default" ? (
                <div className="@min-[640px]/shell:hidden">
                    <Popover trigger="click" placement="bottomRight" content={<div className="flex flex-wrap items-center gap-1">{utilityActions}</div>}>
                        <button type="button" className={naturalIconClass} aria-label={t("topNav.more")} title={t("topNav.more")}><MoreHorizontal className="size-4" /></button>
                    </Popover>
                </div>
            ) : null}
            {user ? (
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        items: [
                            { key: "identity", label: <div><div className="font-medium">{userDisplayName}</div><div className="text-xs text-stone-500">{user.email || ""}</div></div>, disabled: true },
                            { type: "divider" },
                            { key: "password", icon: <KeyRound className="size-4" />, label: t("auth.changePassword") },
                            { key: "logout", icon: <LogOut className="size-4" />, label: t("auth.logout") },
                        ],
                        onClick: ({ key }) => {
                            if (key === "password") setPasswordOpen(true);
                            if (key === "logout") void logout();
                        },
                    }}
                >
                    <button type="button" className={`${naturalIconClass} ml-1 rounded-full bg-stone-100 text-xs font-semibold dark:bg-stone-800`} aria-label={t("auth.account")} title={userDisplayName}>
                        {userDisplayName.slice(0, 1).toUpperCase()}
                    </button>
                </Dropdown>
            ) : null}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
        <Modal title="修改密码" open={passwordOpen} okText="确认修改" cancelText="取消" confirmLoading={passwordSubmitting} onCancel={() => setPasswordOpen(false)} onOk={() => void submitPassword()} destroyOnHidden>
            <Form className="mt-5" form={passwordForm} layout="vertical" requiredMark={false}>
                <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}><Input.Password autoComplete="current-password" /></Form.Item>
                <Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                <Form.Item name="confirmPassword" label="确认新密码" dependencies={["password"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
            </Form>
        </Modal>
        </>
    );
}
