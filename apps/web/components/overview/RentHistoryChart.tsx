"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { eur } from "./format";

export interface HistoryEntry {
  month: string; // YYYY-MM
  received: number;
}

/** A round step so that about four gridlines cover `max`. */
function niceStep(max: number): number {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return f * mag;
}

function monthDate(month: string): Date {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

/**
 * Change between the last two complete months before the current calendar
 * month. Null when there are not two complete months or the older one is 0,
 * so no percentage is ever made up.
 */
export function completeMonthChange(
  history: HistoryEntry[],
  currentMonth: string,
): { pct: number; older: HistoryEntry; newer: HistoryEntry } | null {
  const complete = history.filter((h) => h.month < currentMonth);
  if (complete.length < 2) return null;
  const newer = complete[complete.length - 1]!;
  const older = complete[complete.length - 2]!;
  if (!(older.received > 0)) return null;
  const pct = Math.round(((newer.received - older.received) / older.received) * 1000) / 10;
  return { pct, older, newer };
}

/** Twelve-month bar chart of rent received, computed by the API. Plain SVG. */
export default function RentHistoryChart({
  history,
  selectedMonth,
}: {
  history: HistoryEntry[];
  selectedMonth: string;
}) {
  const t = useTranslations("overview");
  const locale = useLocale();
  const gradId = useId().replace(/:/g, "");

  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short" });
  const longMonth = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const change = completeMonthChange(history, currentMonth);

  const max = Math.max(0, ...history.map((h) => h.received));
  const empty = max <= 0;
  const step = empty ? 1 : niceStep(max);
  const top = empty ? 1 : Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);

  // Chart geometry in viewBox units.
  const W = 360;
  const H = 190;
  const left = 38;
  const right = 4;
  const topPad = 8;
  const bottom = 22;
  const plotW = W - left - right;
  const plotH = H - topPad - bottom;
  const slot = plotW / Math.max(1, history.length);
  const barW = Math.min(22, slot * 0.62);
  const y = (v: number) => topPad + plotH - (v / top) * plotH;

  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="font-bold text-navy">
            {t("historyTitle")}{" "}
            <span className="text-xs font-normal text-muted-foreground">{t("historySubtitle")}</span>
          </h2>
          {change && (
            <span
              title={t("historyChange", {
                newer: longMonth.format(monthDate(change.newer.month)),
                older: longMonth.format(monthDate(change.older.month)),
              })}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                change.pct >= 0 ? "bg-tint-green text-green-dark" : "bg-amber-100 text-amber-800"
              }`}
            >
              {change.pct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {change.pct >= 0 ? "+" : ""}
              {change.pct.toLocaleString(locale, { maximumFractionDigits: 1 })}%
            </span>
          )}
        </div>

        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${gradId}-title`}>
            <title id={`${gradId}-title`}>{`${t("historyTitle")} ${t("historySubtitle")}`}</title>
            <defs>
              <linearGradient id={`${gradId}-blue`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3B82F6" />
                <stop offset="1" stopColor="#BFDBFE" />
              </linearGradient>
              <linearGradient id={`${gradId}-green`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7AC943" />
                <stop offset="1" stopColor="#3FAE2A" />
              </linearGradient>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="hsl(214 32% 90%)" strokeWidth={1} />
                <text x={left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="hsl(215 16% 45%)">
                  €{compact.format(v)}
                </text>
              </g>
            ))}
            {history.map((h, i) => {
              const x = left + i * slot + (slot - barW) / 2;
              const barH = Math.max(h.received > 0 ? 2 : 0, (h.received / top) * plotH);
              const selected = h.month === selectedMonth;
              return (
                <g key={h.month}>
                  <rect
                    x={x}
                    y={topPad + plotH - barH}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={`url(#${gradId}-${selected ? "green" : "blue"})`}
                  >
                    <title>{`${longMonth.format(monthDate(h.month))}: ${eur(h.received)}`}</title>
                  </rect>
                  <text
                    x={x + barW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={selected ? 700 : 400}
                    fill={selected ? "hsl(217 78% 20%)" : "hsl(215 16% 45%)"}
                  >
                    {shortMonth.format(monthDate(h.month)).replace(".", "")}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </CardContent>
    </Card>
  );
}
