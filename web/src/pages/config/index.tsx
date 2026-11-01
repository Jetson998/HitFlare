import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useConfigStore } from "@/stores/use-config-store";

export default function ConfigPage() {
    const navigate = useNavigate();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    useEffect(() => {
        openConfigDialog(false);
        navigate("/", { replace: true });
    }, [navigate, openConfigDialog]);
    return null;
}
