const colors = ["#22C55E", "#FF3B30", "#F97316", "#8B5CF6", "#3B82F6", "#EC4899", "#14B8A6", "#F5A524", "#111827"];

function hash(seed: string) {
    return [...seed].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 7);
}

export function botFace(seed = "agent") {
    return colors[hash(seed) % colors.length];
}

export function AgentBotMark({ seed = "agent", motion = "idle", className = "size-9" }: { seed?: string; motion?: "idle" | "pop" | "live"; className?: string }) {
    const n = hash(seed);
    const motionClass = motion === "pop" ? "agent-icon-pop" : motion === "live" ? "agent-icon-live" : "";
    return <svg viewBox="0 0 36 36" width="36" height="36" preserveAspectRatio="xMidYMid meet" className={`${className} aspect-square shrink-0 origin-center ${motionClass}`} aria-hidden="true">
        <BotShape id={n % 4} fill={colors[n % colors.length]} />
    </svg>;
}

function BotShape({ id, fill }: { id: number; fill: string }) {
    const eyes = <BotEyes />;
    if (id === 0) return <><rect x="3" y="9" width="30" height="18" rx="9" fill={fill} />{eyes}</>;
    if (id === 1) return <><circle cx="18" cy="18" r="14" fill={fill} />{eyes}</>;
    if (id === 2) return <><polygon points="18,4 30,11 30,25 18,32 6,25 6,11" fill={fill} stroke={fill} strokeWidth="3" strokeLinejoin="round" />{eyes}</>;
    return <><rect x="5" y="5" width="26" height="26" rx="9" fill={fill} />{eyes}</>;
}

function BotEyes() {
    return <><circle cx="13.4" cy="17.2" r="2.35" fill="#fff" /><circle cx="22.6" cy="17.2" r="2.35" fill="#fff" /></>;
}

export function WaitMarquee({ text, seed, className = "" }: { text: string; seed: string; className?: string }) {
    const step = 0.22;
    return <p className={`flex items-center gap-2 text-sm leading-6 ${className}`} role="status"><AgentBotMark seed={seed} motion="live" className="size-5" /><span aria-hidden="true">{[...text].map((char, index) => <span key={index} className="agent-char" style={{ animationDelay: `${index * step}s`, animationDuration: `${text.length * step}s` }}>{char}</span>)}</span><span className="sr-only">{text}</span></p>;
}

export function AgentIconStyle() {
    return <style>{`@keyframes agent-icon-pop{0%{transform:scale(1)}45%{transform:scale(1.06)}100%{transform:scale(1)}}@keyframes agent-icon-live{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}@keyframes agent-char{0%,8%{color:#9CA3AF}14%,100%{color:#111827}}.agent-char{color:#111827;animation-name:agent-char;animation-timing-function:linear;animation-iteration-count:infinite}.agent-icon-pop{animation:agent-icon-pop .42s ease-out;transform-origin:center}.agent-icon-live{animation:agent-icon-live 1.1s ease-in-out infinite;transform-origin:center}`}</style>;
}
