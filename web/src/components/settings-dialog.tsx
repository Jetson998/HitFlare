import type { ReactNode } from "react";
import { Modal } from "antd";

export function SettingsDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
    return (
        <Modal
            open={open}
            title={title}
            centered
            footer={null}
            destroyOnHidden
            width="min(440px, calc(100vw - 32px))"
            onCancel={onClose}
            styles={{ body: { maxHeight: "calc(100dvh - 148px)", overflowY: "auto", paddingTop: 8 } }}
        >
            {children}
        </Modal>
    );
}
