"use client";

import { useTranslations } from "next-intl";
import { TrendingUp, Calculator, AlertTriangle } from "lucide-react";

export default function IndexationPage() {
  const t = useTranslations("indexation");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {t("subtitle")}
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90">
          <Calculator className="h-4 w-4" />
          {t("calculate")}
        </button>
      </div>

      {/* Health index card */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("currentIndex")}
          </p>
          <p className="mt-2 text-3xl font-bold">--</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("sourceStatbel")}
          </p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("nextIndexation")}
          </p>
          <p className="mt-2 text-3xl font-bold">--</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("leasesUpcoming")}
          </p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("epcRestrictions")}
          </p>
          <p className="mt-2 text-3xl font-bold">--</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("leasesRestricted")}
          </p>
        </div>
      </div>

      {/* EPC warning */}
      <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600" />
        <div>
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            {t("epcWarningTitle")}
          </p>
          <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
            {t("epcWarningDescription")}
          </p>
        </div>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
        <TrendingUp className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
        <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {t("emptyDescription")}
        </p>
      </div>
    </div>
  );
}
