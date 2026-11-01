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

let authEpoch = 0;
let revocationEvents: EventSource | undefined;
let sessionChannel: BroadcastChannel | undefined;

function clearSessionWatch() {
    revocationEvents?.close();
    revocationEvents = undefined;
    sessionChannel?.close();
    sessionChannel = undefined;
}

function notifySessionChange() {
    if (sessionChannel) return sessionChannel.postMessage("changed");
    const channel = new BroadcastChannel("hitflare-auth");
    channel.postMessage("changed");
    channel.close();
}

function watchSession(user: HitFlareUser, setUser: (user: HitFlareUser | null, status: UserStore["status"]) => void) {
    clearSessionWatch();
    const events = new EventSource("/api/auth/events");
    revocationEvents = events;
    const revoke = () => {
        if (revocationEvents !== events) return;
        authEpoch++;
        clearSessionWatch();
        setUser(null, "anonymous");
    };
    events.addEventListener("revoked", revoke, { once: true });
    events.addEventListener("ready", (event) => {
        if (JSON.parse((event as MessageEvent<string>).data).sessionId !== user.sessionId) revoke();
    });
    let checking = false;
    events.onerror = async () => {
        if (checking || revocationEvents !== events) return;
        checking = true;
        try {
            const current = (await fetchCurrentUser()).user;
            if (current.sessionId !== user.sessionId) revoke();
        } catch (error) {
            if (error instanceof AuthApiError && error.status === 401) revoke();
        } finally { checking = false; }
    };
    sessionChannel = new BroadcastChannel("hitflare-auth");
    sessionChannel.onmessage = revoke;
}

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    status: "idle",
    initialize: async () => {
        if (useUserStore.getState().status !== "idle") return;
        const epoch = ++authEpoch;
        set({ status: "loading" });
        try {
            const { user } = await fetchCurrentUser();
            if (epoch !== authEpoch) return;
            set({ user, status: "authenticated" });
            watchSession(user, (currentUser, status) => set({ user: currentUser, status }));
        } catch (error) {
            if (epoch !== authEpoch) return;
            if (error instanceof AuthApiError && error.status === 401) set({ user: null, status: "anonymous" });
            else set({ user: null, status: "anonymous" });
        }
    },
    login: async (values) => {
        const epoch = ++authEpoch;
        const { user } = await loginRequest(values);
        if (epoch !== authEpoch) return;
        set({ user, status: "authenticated" });
        watchSession(user, (currentUser, status) => set({ user: currentUser, status }));
        notifySessionChange();
    },
    logout: async () => {
        const epoch = ++authEpoch;
        clearSessionWatch();
        set({ user: null, status: "anonymous" });
        notifySessionChange();
        try {
            await logoutRequest();
        } finally {
            if (epoch === authEpoch) set({ user: null, status: "anonymous" });
        }
    },
    changePassword: async (values) => {
        const epoch = authEpoch;
        await changePasswordRequest(values);
        if (epoch !== authEpoch) return;
        authEpoch++;
        clearSessionWatch();
        set({ user: null, status: "anonymous" });
        notifySessionChange();
    },
}));
