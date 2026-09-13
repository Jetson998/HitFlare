import { Ban, Ellipsis, KeyRound, Pencil, Plus, UserCheck, UserRoundPlus } from "lucide-react";
import { useState } from "react";
import { App, Button, Dropdown, Form, Input, Modal, Select, Table, Tag, type TableProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { createUser, fetchUsers, resetUserPassword, updateUser, updateUserStatus, type HitFlareUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type CreateUserValues = { email: string; username: string; password: string; role: HitFlareUser["role"] };
type EditUserValues = { email: string; username: string; role: HitFlareUser["role"] };
type PasswordValues = { password: string; confirmPassword: string };

export default function AdminUsersPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const currentUser = useUserStore((state) => state.user);
    const [createForm] = Form.useForm<CreateUserValues>();
    const [editForm] = Form.useForm<EditUserValues>();
    const [passwordForm] = Form.useForm<PasswordValues>();
    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<HitFlareUser | null>(null);
    const [passwordTarget, setPasswordTarget] = useState<HitFlareUser | null>(null);
    const users = useQuery({ queryKey: ["admin-users"], queryFn: fetchUsers });
    const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    const reportError = (error: Error) => message.error(error.message);
    const create = useMutation({
        mutationFn: createUser,
        onSuccess: async () => {
            message.success("用户已创建");
            setCreateOpen(false);
            createForm.resetFields();
            await refreshUsers();
        },
        onError: reportError,
    });
    const edit = useMutation({
        mutationFn: ({ id, values }: { id: string; values: EditUserValues }) => updateUser(id, values),
        onSuccess: async ({ user }) => {
            message.success("用户信息已更新");
            setEditTarget(null);
            editForm.resetFields();
            if (user.id === currentUser?.id) useUserStore.setState({ user });
            await refreshUsers();
        },
        onError: reportError,
    });
    const changeStatus = useMutation({
        mutationFn: ({ id, status }: { id: string; status: HitFlareUser["status"] }) => updateUserStatus(id, status),
        onSuccess: async ({ user }) => {
            message.success(user.status === "active" ? "用户已启用" : "用户已禁用");
            await refreshUsers();
        },
        onError: reportError,
    });
    const resetPassword = useMutation({
        mutationFn: ({ id, password }: { id: string; password: string }) => resetUserPassword(id, password),
        onSuccess: async (_, variables) => {
            message.success("密码已重置");
            setPasswordTarget(null);
            passwordForm.resetFields();
            if (variables.id === currentUser?.id) {
                useUserStore.setState({ user: null, status: "anonymous" });
                navigate("/login", { replace: true });
                return;
            }
            await refreshUsers();
        },
        onError: reportError,
    });

    const openEdit = (user: HitFlareUser) => {
        setEditTarget(user);
        editForm.setFieldsValue({ email: user.email, username: user.username, role: user.role });
    };
    const openPassword = (user: HitFlareUser) => {
        setPasswordTarget(user);
        passwordForm.resetFields();
    };
    const confirmStatus = (user: HitFlareUser) => {
        const disabling = user.status === "active";
        modal.confirm({
            title: disabling ? `禁用 ${user.username}` : `启用 ${user.username}`,
            content: disabling ? "禁用后，该用户会立即退出所有已登录设备，并且无法再次登录。" : "启用后，该用户可以重新登录。",
            okText: disabling ? "禁用" : "启用",
            cancelText: "取消",
            okButtonProps: { danger: disabling },
            onOk: () => changeStatus.mutateAsync({ id: user.id, status: disabling ? "disabled" : "active" }),
        });
    };
    const columns: TableProps<HitFlareUser>["columns"] = [
        {
            title: "用户",
            key: "user",
            render: (_, user) => (
                <div className="min-w-48">
                    <div className="font-medium text-stone-950 dark:text-stone-100">{user.username}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{user.email}</div>
                </div>
            ),
        },
        { title: "角色", dataIndex: "role", width: 110, render: (role: HitFlareUser["role"]) => <Tag bordered={false}>{role === "admin" ? "管理员" : "普通用户"}</Tag> },
        { title: "状态", dataIndex: "status", width: 110, render: (status: HitFlareUser["status"]) => <Tag bordered={false} color={status === "active" ? "green" : "default"}>{status === "active" ? "正常" : "已禁用"}</Tag> },
        { title: "创建时间", dataIndex: "createdAt", width: 175, render: formatDate },
        { title: "最后登录", dataIndex: "lastLoginAt", width: 175, render: (value: string | null) => value ? formatDate(value) : <span className="text-stone-400">尚未登录</span> },
        {
            title: "操作",
            key: "actions",
            width: 72,
            fixed: "right",
            align: "center",
            render: (_, user) => (
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        items: [
                            { key: "edit", icon: <Pencil className="size-4" />, label: "编辑用户" },
                            { key: "password", icon: <KeyRound className="size-4" />, label: "重置密码" },
                            { type: "divider" },
                            user.status === "active"
                                ? { key: "status", icon: <Ban className="size-4" />, label: "禁用用户", danger: true, disabled: user.id === currentUser?.id }
                                : { key: "status", icon: <UserCheck className="size-4" />, label: "启用用户" },
                        ],
                        onClick: ({ key }) => {
                            if (key === "edit") openEdit(user);
                            if (key === "password") openPassword(user);
                            if (key === "status") confirmStatus(user);
                        },
                    }}
                >
                    <Button type="text" shape="circle" icon={<Ellipsis className="size-4" />} aria-label={`管理 ${user.username}`} />
                </Dropdown>
            ),
        },
    ];

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="workspace-page">
                <div className="workspace-heading">
                    <div className="workspace-heading-copy min-w-0">
                        <h1 className="workspace-title">用户管理</h1>
                        <p className="workspace-description">管理受邀用户、角色和登录状态</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>新建用户</Button>
                </div>

                <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <Table<HitFlareUser> rowKey="id" columns={columns} dataSource={users.data?.users || []} loading={users.isPending} pagination={false} scroll={{ x: 920 }} />
                </div>
                {users.isError ? <div className="mt-4 text-sm text-red-600">{users.error.message}</div> : null}
            </div>

            <Modal title={<span className="inline-flex items-center gap-2"><UserRoundPlus className="size-4" />新建用户</span>} open={createOpen} okText="创建" cancelText="取消" confirmLoading={create.isPending} onCancel={() => setCreateOpen(false)} onOk={() => void createForm.validateFields().then((values) => create.mutate(values))} destroyOnHidden>
                <Form<CreateUserValues> className="mt-5" form={createForm} layout="vertical" requiredMark={false} initialValues={{ role: "user" }}>
                    <Form.Item name="username" label="用户名（展示名称）" rules={[{ required: true, message: "请输入用户名" }]}><Input autoComplete="off" placeholder="用户在工作台中看到的名称" /></Form.Item>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input type="email" autoComplete="off" placeholder="用于登录，且不可与其他用户重复" /></Form.Item>
                    <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}><Select options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} /></Form.Item>
                    <Form.Item name="password" label="初始密码" rules={[{ required: true, message: "请输入初始密码" }]}><Input.Password autoComplete="new-password" placeholder="创建后线下发给用户" /></Form.Item>
                </Form>
            </Modal>

            <Modal title="编辑用户" open={Boolean(editTarget)} okText="保存" cancelText="取消" confirmLoading={edit.isPending} onCancel={() => setEditTarget(null)} onOk={() => editTarget && void editForm.validateFields().then((values) => edit.mutate({ id: editTarget.id, values }))} destroyOnHidden>
                <Form<EditUserValues> className="mt-5" form={editForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="username" label="用户名（展示名称）" rules={[{ required: true, message: "请输入用户名" }]}><Input /></Form.Item>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input type="email" /></Form.Item>
                    <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}><Select disabled={editTarget?.id === currentUser?.id} options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} /></Form.Item>
                </Form>
            </Modal>

            <Modal title={`重置密码${passwordTarget ? ` · ${passwordTarget.username}` : ""}`} open={Boolean(passwordTarget)} okText="确认重置" cancelText="取消" confirmLoading={resetPassword.isPending} onCancel={() => setPasswordTarget(null)} onOk={() => passwordTarget && void passwordForm.validateFields().then(({ password }) => resetPassword.mutate({ id: passwordTarget.id, password }))} destroyOnHidden>
                <Form<PasswordValues> className="mt-5" form={passwordForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Form.Item name="confirmPassword" label="确认新密码" dependencies={["password"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
                </Form>
            </Modal>
        </main>
    );
}

function formatDate(value: string) {
    return dayjs(value).format("YYYY-MM-DD HH:mm");
}
