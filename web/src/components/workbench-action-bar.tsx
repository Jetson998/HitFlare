import type { ReactNode } from "react";
import { Button } from "antd";

type WorkbenchActionBarProps = {
    controls: ReactNode;
    action: {
        label: string;
        icon: ReactNode;
        onClick: () => void;
        disabled?: boolean;
        loading?: boolean;
        danger?: boolean;
    };
};

export function WorkbenchActionBar({ controls, action, ink = false }: WorkbenchActionBarProps & { ink?: boolean }) {
    return (
        <div className="mt-auto space-y-3 pt-6">
            {controls}
            <Button
                type={action.danger || ink ? "default" : "primary"}
                danger={action.danger}
                size="large"
                block
                className={ink && !action.danger ? "!h-10 !rounded-full !border-[#111827] !bg-[#111827] !text-white hover:!border-[#111827] hover:!bg-[#111827] hover:!text-white disabled:!cursor-not-allowed disabled:!border-[#E5E7EB] disabled:!bg-[#E5E7EB] disabled:!text-[#9CA3AF] disabled:hover:!border-[#E5E7EB] disabled:hover:!bg-[#E5E7EB] disabled:hover:!text-[#9CA3AF]" : undefined}
                icon={action.icon}
                loading={action.loading}
                disabled={action.disabled}
                onClick={action.onClick}
            >
                {action.label}
            </Button>
        </div>
    );
}
