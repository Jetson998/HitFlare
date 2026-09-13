import { create } from "zustand";

import { AuthApiError, changePassword as changePasswordRequest, fetchCurrentUser, login as loginRequest, logout as logoutRequest, type HitFlareUser } from "@/services/api/auth";

type UserStore = {
    user: HitFlareUser | null;
    status: "idle" | "loading" | "authenticated" | "anonymous";
    initialize: () => Promise<void>;
    login: (values: { email: string; password: string }) => Promise<void>;
    logout: () => Promise<void>;
    changePassword: (values: { currentPassword: string; password: string }) => Promise<void>;
};

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    status: "idle",
    initialize: async () => {
        if (useUserStore.getState().status !== "idle") return;
        set({ status: "loading" });
        try {
            const { user } = await fetchCurrentUser();
            set({ user, status: "authenticated" });
        } catch (error) {
            if (error instanceof AuthApiError && error.status === 401) set({ user: null, status: "anonymous" });
            else set({ user: null, status: "anonymous" });
        }
    },
    login: async (values) => {
        const { user } = await loginRequest(values);
        set({ user, status: "authenticated" });
    },
    logout: async () => {
        try {
            await logoutRequest();
        } finally {
            set({ user: null, status: "anonymous" });
        }
    },
    changePassword: async (values) => {
        await changePasswordRequest(values);
        set({ user: null, status: "anonymous" });
    },
}));
