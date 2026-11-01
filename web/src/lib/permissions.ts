import i18n from "@/i18n";
import { AuthApiError } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export function useIsAdmin() {
    return useUserStore((state) => state.user?.permissions?.includes("account:manage") === true);
}

export function isCurrentUserAdmin() {
    return useUserStore.getState().user?.permissions?.includes("account:manage") === true;
}

export function requireAdminAction() {
    if (!isCurrentUserAdmin()) throw new AuthApiError(i18n.t("auth.adminOnlyAction"), 403);
}
