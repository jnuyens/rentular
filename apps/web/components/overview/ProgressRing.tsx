"use client";

/** Small circular progress indicator with the percentage in the middle. */
export default function ProgressRing({
  pct,
  color,
  size = 64,
  stroke = 7,
}: {
  pct: number;
  /** Stroke colour of the filled part (any CSS colour). */
  color: string;
  size?: number;
  stroke?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="white" stroke="hsl(214 32% 90%)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-navy">
        {clamped}%
      </span>
    </div>
  );
}
