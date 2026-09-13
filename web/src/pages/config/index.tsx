import { AppConfigPanel } from "@/components/layout/app-config-modal";

export default function ConfigPage() {
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="workspace-page">
                <AppConfigPanel />
            </div>
        </main>
    );
}
