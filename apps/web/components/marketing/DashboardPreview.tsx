"use client";

import type { JSX } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Calculator,
  CreditCard,
  FileText,
  Home,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

type PreviewStatus = "ready" | "letterSent" | "applied";

interface PreviewRow {
  street: string;
  city: string;
  baseRent: number;
  baseIndex: number;
  newIndex: number;
  anniversary: string;
  status: PreviewStatus;
}

// Invented sample contracts for the marketing homepage, not read from the
// database. Each lease is one year old, so the current rent is still the base
// rent. Index values are Belgian health index figures (base 2013 = 100) for
// the month before signing and the month before the anniversary.
const PREVIEW_ROWS: PreviewRow[] = [
  {
    street: "Kerkstraat 12",
    city: "Gent",
    baseRent: 1150,
    baseIndex: 133.18,
    newIndex: 136.37,
    anniversary: "15/09/2026",
    status: "ready",
  },
  {
    street: "Bondgenotenlaan 3",
    city: "Leuven",
    baseRent: 785,
    baseIndex: 133.41,
    newIndex: 136.58,
    anniversary: "01/10/2026",
    status: "ready",
  },
  {
    street: "Rue de la Loi 45",
    city: "Bruxelles",
    baseRent: 1480,
    baseIndex: 133.18,
    newIndex: 136.37,
    anniversary: "01/09/2026",
    status: "letterSent",
  },
  {
    street: "Meir 88",
    city: "Antwerpen",
    baseRent: 920,
    baseIndex: 132.95,
    newIndex: 136.1,
    anniversary: "01/08/2026",
    status: "applied",
  },
];

const CURRENT_HEALTH_INDEX = 136.58;

/** Belgian rent indexation: base rent * new index / base index, rounded to cents. */
function indexedRent(row: PreviewRow): number {
  return (
    Math.round(((row.baseRent * row.newIndex) / row.baseIndex) * 100) / 100
  );
}

const euroFormat = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatEuro(value: number): string {
  return `€ ${euroFormat.format(value)}`;
}

function formatIndex(value: number): string {
  return euroFormat.format(value);
}

const STATUS_LABEL_KEY: Record<
  PreviewStatus,
  "statusReady" | "statusLetterSent" | "statusApplied"
> = {
  ready: "statusReady",
  letterSent: "statusLetterSent",
  applied: "statusApplied",
};

const STATUS_CLASSES: Record<PreviewStatus, string> = {
  ready: "bg-amber-100 text-amber-700",
  letterSent: "bg-blue-100 text-blue-700",
  applied: "bg-green-100 text-green-700",
};

type SidebarKey =
  | "sidebarProperties"
  | "sidebarContracts"
  | "sidebarPayments"
  | "sidebarIndexation";

const SIDEBAR_ITEMS: { key: SidebarKey; icon: LucideIcon; active?: boolean }[] =
  [
    { key: "sidebarProperties", icon: Building2 },
    { key: "sidebarContracts", icon: FileText },
    { key: "sidebarPayments", icon: CreditCard },
    { key: "sidebarIndexation", icon: TrendingUp, active: true },
  ];

/**
 * Static, decorative mock of the rent indexation page shown in the marketing
 * hero. Hidden from assistive technology because it carries no real content.
 */
export function DashboardPreview(): JSX.Element {
  const t = useTranslations("marketing.preview");
  const readyCount = PREVIEW_ROWS.filter((r) => r.status === "ready").length;

  return (
    <div aria-hidden="true" className="flex bg-background text-left text-sm">
      <aside className="hidden w-40 shrink-0 border-r bg-muted/40 p-3 sm:block">
        <div className="mb-4 flex items-center gap-2 font-semibold">
          <Home className="h-4 w-4 text-primary" />
          <span>{t("appName")}</span>
        </div>
        <ul className="space-y-1">
          {SIDEBAR_ITEMS.map(({ key, icon: Icon, active }) => (
            <li
              key={key}
              className={
                active
                  ? "flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary"
                  : "flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(key)}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{t("title")}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground md:inline-flex">
            <Calculator className="h-3.5 w-3.5" />
            {t("calculate")}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-lg border bg-card p-3">
            <p className="truncate text-xs text-muted-foreground">
              {t("currentIndex")}
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {formatIndex(CURRENT_HEALTH_INDEX)}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("sourceStatbel")}
            </p>
          </div>
          <div className="min-w-0 rounded-lg border bg-card p-3">
            <p className="truncate text-xs text-muted-foreground">
              {t("readyToApply")}
            </p>
            <p className="mt-1 text-lg font-semibold text-amber-600">
              {readyCount}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("leasesReady")}
            </p>
          </div>
          <div className="hidden min-w-0 rounded-lg border bg-card p-3 sm:block">
            <p className="truncate text-xs text-muted-foreground">
              {t("nextIndexation")}
            </p>
            <p className="mt-1 text-lg font-semibold">3</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("leasesUpcoming")}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium">
                  {t("colProperty")}
                </th>
                <th className="w-[38%] px-2 py-2 text-right font-medium sm:w-44 lg:w-28">
                  {t("colRent")}
                </th>
                <th className="hidden w-16 px-2 py-2 text-right font-medium lg:table-cell">
                  {t("colBaseIndex")}
                </th>
                <th className="hidden w-16 px-2 py-2 text-right font-medium lg:table-cell">
                  {t("colNewIndex")}
                </th>
                <th className="hidden w-20 px-2 py-2 text-left font-medium md:table-cell">
                  {t("colAnniversary")}
                </th>
                <th className="w-[26%] px-2 py-2 text-left font-medium sm:w-28 lg:w-24">
                  {t("colStatus")}
                </th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW_ROWS.map((row) => (
                <tr key={row.street} className="border-t">
                  <td className="px-2 py-2">
                    <p className="truncate font-medium">{row.street}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.city}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <span className="whitespace-nowrap text-muted-foreground">
                      {formatEuro(row.baseRent)} →
                    </span>{" "}
                    <span className="whitespace-nowrap font-medium text-green-700">
                      {formatEuro(indexedRent(row))}
                    </span>
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums lg:table-cell">
                    {formatIndex(row.baseIndex)}
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums lg:table-cell">
                    {formatIndex(row.newIndex)}
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-2 tabular-nums md:table-cell">
                    {row.anniversary}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-block max-w-full rounded-md px-2 py-0.5 text-[11px] font-medium leading-tight ${STATUS_CLASSES[row.status]}`}
                    >
                      {t(STATUS_LABEL_KEY[row.status])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
