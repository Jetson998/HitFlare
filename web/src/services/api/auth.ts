export type HitFlareUser = {
    id: string;
    email: string;
    username: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    createdAt: string;
    lastLoginAt: string | null;
};

export class AuthApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        credentials: "same-origin",
        headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new AuthApiError(data.error || "请求失败", response.status);
    return data;
}

export const fetchCurrentUser = () => request<{ user: HitFlareUser }>("/api/auth/me");

export const login = (values: { email: string; password: string }) =>
    request<{ user: HitFlareUser }>("/api/auth/login", { method: "POST", body: JSON.stringify(values) });

export const logout = () => request<{ success: true }>("/api/auth/logout", { method: "POST", body: "{}" });

export const changePassword = (values: { currentPassword: string; password: string }) =>
    request<{ success: true }>("/api/auth/password", { method: "POST", body: JSON.stringify(values) });

export const fetchUsers = () => request<{ users: HitFlareUser[] }>("/api/admin/users");

export const createUser = (values: { email: string; username: string; password: string; role: HitFlareUser["role"] }) =>
    request<{ user: HitFlareUser }>("/api/admin/users", { method: "POST", body: JSON.stringify(values) });

export const updateUser = (id: string, values: { email: string; username: string; role: HitFlareUser["role"] }) =>
    request<{ user: HitFlareUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) });

export const updateUserStatus = (id: string, status: HitFlareUser["status"]) =>
    request<{ user: HitFlareUser }>(`/api/admin/users/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });

export const resetUserPassword = (id: string, password: string) =>
    request<{ success: true }>(`/api/admin/users/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ password }) });
