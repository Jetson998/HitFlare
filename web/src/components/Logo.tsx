interface LogoProps {
    size?: number;
    variant?: "mark" | "wordmark" | "horizontal-en" | "sidebar";
    className?: string;
}

export function Logo({ size = 44, variant = "wordmark", className = "" }: LogoProps) {
    const source = variant === "mark" ? "/brand/hitflare-icon-v3-transparent.png" : variant === "horizontal-en" ? "/brand/hitflare-logo-horizontal-en-v3.png" : variant === "sidebar" ? "/brand/hitflare-logo-sidebar-light.png" : "/brand/hitflare-logo-full-v3.png";
    const width = size * (variant === "mark" ? 1 : variant === "horizontal-en" ? 900 / 370 : 1160 / 370);
    if (variant === "sidebar") {
        return (
            <span className={`inline-flex shrink-0 items-center ${className}`}>
                <img src="/brand/hitflare-logo-sidebar-light.png" alt="HitFlare 光引" width={width} height={size} className="block bg-transparent object-contain dark:hidden" />
                <img src="/brand/hitflare-logo-sidebar-dark.png" alt="" width={width} height={size} className="hidden bg-transparent object-contain dark:block" />
            </span>
        );
    }
    return (
        <span className={`inline-flex shrink-0 items-center ${className}`}>
            <img src={source} alt="HitFlare 光引" width={width} height={size} className={`block bg-transparent object-contain ${className}`} />
        </span>
    );
}
