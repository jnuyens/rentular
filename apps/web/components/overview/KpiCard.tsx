"use client";

import { ChevronDown } from "lucide-react";

export type KpiKind = "expected" | "received" | "toCome" | "overdue";

const STYLE: Record<KpiKind, { bg: string; icon: string }> = {
  expected: { bg: "bg-tint-blue", icon: "text-icon-blue" },
  received: { bg: "bg-tint-green", icon: "text-icon-green" },
  toCome: { bg: "bg-tint-peach", icon: "text-icon-orange" },
  overdue: { bg: "bg-tint-lavender", icon: "text-icon-purple" },
};

/**
 * Pastel KPI tile: icon, title, big amount and a subline. An optional `aside`
 * (progress ring or status badge) sits on the right. Clickable tiles toggle a
 * breakdown and show a chevron next to the subline.
 */
export default function KpiCard({
  kind,
  icon: Icon,
  title,
  value,
  valueClass = "",
  subline,
  aside,
  onClick,
  expanded,
}: {
  kind: KpiKind;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  valueClass?: string;
  subline?: string;
  aside?: React.ReactNode;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const s = STYLE[kind];
  const body = (
    <div
      className={`flex h-full items-start justify-between gap-3 rounded-2xl border border-white/70 p-5 shadow-soft transition-shadow ${s.bg} ${
        onClick ? "hover:shadow-lg" : ""
      } ${expanded ? "ring-2 ring-royal" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className={`h-6 w-6 shrink-0 ${s.icon}`} />
          <p className="truncate text-sm font-semibold text-navy">{title}</p>
        </div>
        <p className={`mt-3 text-2xl font-bold tracking-tight text-navy xl:text-[1.75rem] ${valueClass}`}>{value}</p>
        {subline && (
          <p className="mt-1 flex items-center gap-1 text-xs text-navy/70">
            {subline}
            {onClick && (
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            )}
          </p>
        )}
      </div>
      {aside}
    </div>
  );

  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} className="block h-full w-full text-left">
      {body}
    </button>
  );
}
