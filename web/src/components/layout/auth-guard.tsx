import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGuard() {
    const location = useLocation();
    const status = useUserStore((state) => state.status);
    const initialize = useUserStore((state) => state.initialize);

    useEffect(() => {
        void initialize();
    }, [initialize]);

    if (status === "idle" || status === "loading") {
        return <div className="flex h-dvh items-center justify-center bg-background"><Spin /></div>;
    }
    if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <Outlet />;
}

export function AdminGuard() {
    const user = useUserStore((state) => state.user);
    return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
