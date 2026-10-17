import { cn } from "@/lib/utils";

const FACETS = [
  // main silhouette (leaping dolphin, head up-right)
  "88,20 78,12 62,14 56,2 50,16 38,30 26,52 20,70 8,62 18,74 12,84 28,82 44,56 56,40 68,32 80,22",
];

/** Zakai.io poly-dolphin mark (reference logo recreation). */
export function DolphinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Zakai.io" className={className}>
      <defs>
        <linearGradient id="zk-wave" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0E4C66" />
          <stop offset="1" stopColor="#17A5BF" />
        </linearGradient>
      </defs>

      {/* base body */}
      <polygon points={FACETS[0]} fill="url(#zk-wave)" />

      {/* faceted overlays */}
      <polygon points="78,12 62,14 56,2 50,16" fill="#4FC2D8" opacity="0.9" />
      <polygon points="88,20 78,12 68,32 80,22" fill="#4FC2D8" opacity="0.85" />
      <polygon points="62,14 50,16 38,30 44,50" fill="#17A5BF" opacity="0.55" />
      <polygon points="38,30 26,52 20,70 18,74" fill="#0A4B66" opacity="0.8" />
      <polygon points="20,70 8,62 18,74" fill="#0E4C66" />
      <polygon points="12,84 18,74 28,82 23,90" fill="#0E4C66" />
      <polygon points="50,16 38,30 44,56 56,40" fill="#3FB8CF" opacity="0.85" />
      <polygon points="56,40 68,32 80,22 74,30" fill="#2FA3BF" opacity="0.9" />
      {/* belly */}
      <path d="M28,82 Q42,72 50,58 Q60,44 72,31 L80,22 Q64,34 56,44 Q46,58 38,68 Q33,74 28,82 Z" fill="#7FD4E5" opacity="0.7" />
      {/* dorsal fin glint + eye */}
      <polygon points="56,2 50,16 44,12" fill="#0E4C66" opacity="0.65" />
      <circle cx="81" cy="21.5" r="1.6" fill="#0A3350" />

      {/* circuit wave below */}
      <path d="M34,88 Q46,88 54,80 Q62,72 76,74 Q86,76 90,84" fill="none" stroke="url(#zk-wave)" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M34,88 Q46,84 52,76" fill="none" stroke="#0E4C66" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
      <g stroke="#17A5BF" strokeWidth="1.6" fill="none" opacity="0.9">
        <path d="M46,89.5 L52,89.5 L56,85.5" />
        <path d="M60,90 L64,86 L71,86" />
        <path d="M70,78 L74,74 L80,74" />
      </g>
      <g fill="#8FE3F5">
        <circle cx="56" cy="85.5" r="1.7" />
        <circle cx="71" cy="86" r="1.7" />
        <circle cx="80" cy="74" r="1.7" />
        <circle cx="90" cy="84" r="2.1" />
      </g>
    </svg>
  );
}

/** Sidebar/login logo: poly-dolphin + Zakai.io wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <DolphinMark className="size-8 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-sm font-bold tracking-tight text-fg">
          Zakai<span className="text-accent">.io</span>
        </span>
        <span className="mt-0.5 hidden text-[8px] font-semibold uppercase tracking-[0.18em] text-muted md:block">
          Intelligent Systems
        </span>
      </span>
    </span>
  );
}
