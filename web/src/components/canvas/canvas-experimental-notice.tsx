import { useState } from "react";
import { Modal } from "antd";
import { useTranslation } from "react-i18next";

let shown = false;

export function CanvasExperimentalNotice() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(() => {
        if (shown) return false;
        shown = true;
        return true;
    });
    const close = () => setOpen(false);
    return (
        <Modal title={t("canvas.experimentalTitle")} open={open} centered onCancel={close} onOk={close} okText={t("canvas.experimentalConfirm")} footer={(_, { OkBtn }) => <OkBtn />}>
            {t("canvas.experimentalNotice")}
        </Modal>
    );
}
