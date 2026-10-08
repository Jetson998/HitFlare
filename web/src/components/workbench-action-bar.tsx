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

export function WorkbenchActionBar({ controls, action }: WorkbenchActionBarProps) {
    return (
        <div className="mt-auto space-y-3 pt-6">
            {controls}
            <Button
                type={action.danger ? "default" : "primary"}
                danger={action.danger}
                size="large"
                block
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
