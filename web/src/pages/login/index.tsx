import { LockKeyhole, LogIn, Mail } from "lucide-react";
import { App, Button, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

type LoginValues = { email: string; password: string };

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const status = useUserStore((state) => state.status);
    const initialize = useUserStore((state) => state.initialize);
    const login = useUserStore((state) => state.login);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        void initialize();
    }, [initialize]);

    if (status === "authenticated") return <Navigate to={safeReturnPath(location.state)} replace />;

    const submit = async (values: LoginValues) => {
        setSubmitting(true);
        try {
            await login(values);
            navigate(safeReturnPath(location.state), { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败，请稍后重试");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative min-h-dvh overflow-y-auto bg-[#171412]">
            <img
                src="/brand/hitflare-login-background-clean.png"
                alt=""
                aria-hidden="true"
                className="fixed inset-0 size-full object-cover object-[32%_center] sm:object-[38%_center] lg:object-center"
            />
            <div
                aria-hidden="true"
                className="fixed inset-0 bg-[linear-gradient(180deg,rgba(12,10,9,.08)_0%,rgba(12,10,9,.18)_44%,rgba(12,10,9,.78)_100%)] lg:bg-[linear-gradient(90deg,rgba(12,10,9,.04)_0%,rgba(12,10,9,.04)_48%,rgba(12,10,9,.3)_76%,rgba(12,10,9,.5)_100%)]"
            />

            <img
                src="/brand/hitflare-logo-horizontal-en-transparent.png"
                alt="HitFlare"
                className="fixed left-6 top-6 z-20 w-[142px] select-none drop-shadow-[0_2px_12px_rgba(0,0,0,.26)] sm:left-8 sm:top-8 sm:w-[160px] lg:left-12 lg:top-10 lg:w-[180px]"
            />

            <div className="relative z-10 flex min-h-dvh items-end justify-center px-5 pb-6 pt-28 sm:items-center sm:px-8 sm:py-10 lg:justify-end lg:px-[clamp(48px,7vw,120px)]">
                <section className="w-full max-w-[380px] rounded-lg border border-white/15 bg-[rgba(22,20,19,.86)] px-6 py-8 text-white shadow-[0_24px_64px_-24px_rgba(0,0,0,.55)] backdrop-blur-xl sm:px-8">
                    <h1 className="text-2xl font-semibold leading-8 text-white">Sign in</h1>

                    <Form<LoginValues>
                        className="mt-7 [&_.ant-form-item-label>label]:!text-white/80"
                        layout="vertical"
                        requiredMark={false}
                        onFinish={(values) => void submit(values)}
                    >
                        <Form.Item name="email" label="邮箱" style={{ marginBottom: 20 }} rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}>
                            <Input
                                size="large"
                                type="email"
                                autoComplete="username"
                                prefix={<Mail className="size-4 text-stone-500" />}
                                placeholder="输入邮箱"
                                autoFocus
                                className="!bg-white/95 [&_.ant-input]:!bg-transparent [&_.ant-input]:!text-stone-950 [&_.ant-input]:placeholder:!text-stone-400"
                            />
                        </Form.Item>
                        <Form.Item name="password" label="密码" style={{ marginBottom: 24 }} rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password
                                size="large"
                                autoComplete="current-password"
                                prefix={<LockKeyhole className="size-4 text-stone-500" />}
                                placeholder="输入密码"
                                className="!bg-white/95 [&_.ant-input]:!bg-transparent [&_.ant-input]:!text-stone-950 [&_.ant-input]:placeholder:!text-stone-400 [&_.ant-input-password-icon]:!text-stone-500"
                            />
                        </Form.Item>
                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            block
                            loading={submitting}
                            icon={<LogIn className="size-4" />}
                            className="!h-11 !border-[#ff6b35] !bg-[#ff6b35] hover:!border-[#f45b28] hover:!bg-[#f45b28]"
                        >
                            登录
                        </Button>
                    </Form>
                </section>
            </div>
        </main>
    );
}

function safeReturnPath(state: unknown) {
    const from = (state as { from?: unknown } | null)?.from;
    return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}
