"use client";

import type { JSX } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  Clock,
  CreditCard,
  FileText,
  Home,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

type PreviewStatus = "paid" | "pending" | "late";

interface PreviewRow {
  property: string;
  tenant: string;
  amount: string;
  date: string;
  status: PreviewStatus;
}

// Invented sample data for the marketing homepage, not read from the database.
const PREVIEW_ROWS: PreviewRow[] = [
  {
    property: "Kerkstraat 12, Gent",
    tenant: "An Peeters",
    amount: "€ 1.150,00",
    date: "01/10/2026",
    status: "paid",
  },
  {
    property: "Rue de la Loi 45, Bruxelles",
    tenant: "Lucas Dubois",
    amount: "€ 1.480,00",
    date: "01/10/2026",
    status: "paid",
  },
  {
    property: "Meir 88, Antwerpen",
    tenant: "Sarah Janssens",
    amount: "€ 920,00",
    date: "05/10/2026",
    status: "pending",
  },
  {
    property: "Bondgenotenlaan 3, Leuven",
    tenant: "Thomas Maes",
    amount: "€ 785,00",
    date: "28/09/2026",
    status: "late",
  },
];

const STATUS_LABEL_KEY: Record<
  PreviewStatus,
  "statusPaid" | "statusPending" | "statusLate"
> = {
  paid: "statusPaid",
  pending: "statusPending",
  late: "statusLate",
};

const STATUS_CLASSES: Record<PreviewStatus, string> = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  late: "bg-red-100 text-red-700",
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
    { key: "sidebarPayments", icon: CreditCard, active: true },
    { key: "sidebarIndexation", icon: TrendingUp },
  ];

type StatKey = "statCollected" | "statPending" | "statLate" | "statContracts";

const STATS: {
  key: StatKey;
  value: string;
  icon: LucideIcon;
  iconClass: string;
}[] = [
  {
    key: "statCollected",
    value: "€ 8.420,00",
    icon: Wallet,
    iconClass: "text-primary",
  },
  { key: "statPending", value: "3", icon: Clock, iconClass: "text-amber-600" },
  {
    key: "statLate",
    value: "1",
    icon: AlertTriangle,
    iconClass: "text-red-600",
  },
  {
    key: "statContracts",
    value: "12",
    icon: FileText,
    iconClass: "text-primary",
  },
];

/**
 * Static, decorative mock of the dashboard shown in the marketing hero.
 * Hidden from assistive technology because it carries no real content.
 */
export function DashboardPreview(): JSX.Element {
  const t = useTranslations("marketing.preview");

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
        <h3 className="text-base font-semibold">{t("overview")}</h3>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATS.map(({ key, value, icon: Icon, iconClass }) => (
            <div key={key} className="min-w-0 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  {t(key)}
                </p>
                <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
              </div>
              <p className="mt-1 whitespace-nowrap text-lg font-semibold">
                {value}
              </p>
            </div>
          ))}
        </div>

        <h4 className="mb-2 mt-5 text-sm font-medium">{t("recentPayments")}</h4>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="w-[40%] px-3 py-2 text-left font-medium md:w-[32%]">
                  {t("colProperty")}
                </th>
                <th className="hidden px-3 py-2 text-left font-medium md:table-cell">
                  {t("colTenant")}
                </th>
                <th className="w-24 px-3 py-2 text-right font-medium">
                  {t("colAmount")}
                </th>
                <th className="hidden w-24 px-3 py-2 text-left font-medium sm:table-cell">
                  {t("colDate")}
                </th>
                <th className="w-24 px-3 py-2 text-left font-medium">
                  {t("colStatus")}
                </th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW_ROWS.map((row) => (
                <tr key={row.property} className="border-t">
                  <td className="truncate px-3 py-2">{row.property}</td>
                  <td className="hidden truncate px-3 py-2 md:table-cell">
                    {row.tenant}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {row.amount}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums sm:table-cell">
                    {row.date}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[row.status]}`}
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
