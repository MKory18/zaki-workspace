/**
 * A row of small bars drawn in SVG with the theme's accent: one bar per day, its height the day's count. No chart library.
 * A zero day is a thin flat bar (never nothing), so a zero reads as «zero», not as a gap.
 */
export function Sparkline({ values, label, large = false }: { values: readonly number[]; label: string; large?: boolean }) {
  const n = Math.max(values.length, 1);
  const max = Math.max(1, ...values);
  const H = 20;
  return (
    <svg
      viewBox={`0 0 ${n * 4} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={large ? "h-16 w-full text-accent" : "h-5 w-28 text-accent"}
      data-sparkline={values.length}
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * H);
        return <rect key={i} x={i * 4} y={H - h} width={3} height={h} rx={0.5} fill="currentColor" opacity={v === 0 ? 0.3 : 1} data-v={v} />;
      })}
    </svg>
  );
}
