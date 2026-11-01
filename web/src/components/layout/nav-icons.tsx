import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function NavIcon({ className, children, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
            {children}
        </svg>
    );
}

export function ImageNavIcon(props: IconProps) {
    return <NavIcon {...props}><path d="M12 4.2 13.15 9.1 18 10.25 13.15 11.4 12 16.3 10.85 11.4 6 10.25 10.85 9.1 12 4.2Z" /></NavIcon>;
}

export function AgentNavIcon(props: IconProps) {
    return <NavIcon {...props}><path d="M7 6.8h10a2.7 2.7 0 0 1 2.7 2.7v4.2A2.7 2.7 0 0 1 17 16.4h-6.2L7.2 18.6v-2.2H7A2.7 2.7 0 0 1 4.3 13.7V9.5A2.7 2.7 0 0 1 7 6.8Z" /></NavIcon>;
}

export function SearchNavIcon(props: IconProps) {
    return <NavIcon {...props}><circle cx="11" cy="11" r="5.25" /><path d="M15.1 15.1 19 19" /></NavIcon>;
}

export function CanvasNavIcon(props: IconProps) {
    return <NavIcon {...props}><path d="M8 5.2H6.6A2.4 2.4 0 0 0 4.2 7.6V9M16 5.2h1.4A2.4 2.4 0 0 1 19.8 7.6V9M8 18.8H6.6A2.4 2.4 0 0 1 4.2 16.4V15M16 18.8h1.4a2.4 2.4 0 0 0 2.4-2.4V15" /></NavIcon>;
}

export function VideoNavIcon(props: IconProps) {
    return <NavIcon {...props}><rect x="4" y="6.5" width="16" height="11" rx="3" /><path d="M10.8 9.7v4.6l3.8-2.3-3.8-2.3Z" fill="currentColor" stroke="none" /></NavIcon>;
}

export function AssetsNavIcon(props: IconProps) {
    return <NavIcon {...props}><rect x="7.5" y="8" width="11.5" height="10" rx="2.4" /><path d="M5 14.2V7.6A2.4 2.4 0 0 1 7.4 5.2H14" /></NavIcon>;
}

export function PromptsNavIcon(props: IconProps) {
    return <NavIcon {...props}><path d="M6 8h12M6 12h9M6 16h6" /></NavIcon>;
}

export function UsersNavIcon(props: IconProps) {
    return <NavIcon {...props}><circle cx="12" cy="9" r="2.7" /><path d="M6.8 18.2c.7-2.6 2.6-3.9 5.2-3.9s4.5 1.3 5.2 3.9" /></NavIcon>;
}

export function LogsNavIcon(props: IconProps) {
    return <NavIcon {...props}><path d="M7 8h11M7 12h11M7 16h7" /></NavIcon>;
}

export function StorageNavIcon(props: IconProps) {
    return <NavIcon {...props}><rect x="5" y="5" width="14" height="14" rx="3.5" /><path d="M5 10.5h14" /></NavIcon>;
}

export function SidebarNavIcon(props: IconProps) {
    return <NavIcon {...props}><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M10 5v14" /></NavIcon>;
}
