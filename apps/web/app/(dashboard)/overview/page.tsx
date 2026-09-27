"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { TrendingUp, CheckCircle2, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Overview {
  month: string; // YYYY-MM
  expectedThisMonth: number;
  paidThisMonth: number;
  toComeThisMonth: number;
  overdueThisMonth: number;
  overdueTotal: number;
  totalWarranty: number;
  currency: string;
}

const eur = (n: number) =>
  `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OverviewPage() {
  const t = useTranslations("overview");
  const tc = useTranslations("dashboard");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/dashboard`, {
        credentials: "include",
      });
      if (res.ok) setData((await res.json()).data);
    } catch {
      toast.error(tc("toast.loadFailed") || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tc]);

  useEffect(() => {
    load();
  }, [load]);

  const monthLabel = (() => {
    if (!data?.month) return "";
    const d = new Date(`${data.month}-01T00:00:00`);
    return isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  })();

  const expected = data?.expectedThisMonth ?? 0;
  const paid = data?.paidThisMonth ?? 0;
  const paidPct = expected > 0 ? Math.min(100, Math.round((paid / expected) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")} {monthLabel && <span className="capitalize">{monthLabel}</span>}
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={<TrendingUp className="h-5 w-5 text-muted-foreground" />}
              label={t("expectedThisMonth")}
              value={eur(expected)}
              hint={t("expectedHint")}
            />
            <MetricCard
              icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
              label={t("paidThisMonth")}
              value={eur(paid)}
              valueClass="text-green-700 dark:text-green-400"
              hint={`${paidPct}% ${t("ofExpected")}`}
            />
            <MetricCard
              icon={<Clock className="h-5 w-5 text-blue-600" />}
              label={t("toCome")}
              value={eur(data?.toComeThisMonth ?? 0)}
              valueClass="text-blue-700 dark:text-blue-400"
              hint={t("toComeHint")}
            />
            <MetricCard
              icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
              label={t("overdue")}
              value={eur(data?.overdueTotal ?? 0)}
              valueClass={
                (data?.overdueTotal ?? 0) > 0 ? "text-red-700 dark:text-red-400" : ""
              }
              hint={
                (data?.overdueThisMonth ?? 0) > 0
                  ? t("overdueThisMonth", { amount: eur(data?.overdueThisMonth ?? 0) })
                  : t("overdueHint")
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Collection progress for the month */}
            <Card className="lg:col-span-2">
              <CardContent className="p-6">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("collected")}</span>
                  <span className="font-medium">
                    {eur(paid)} / {eur(expected)} ({paidPct}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-green-600 transition-all"
                    style={{ width: `${paidPct}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Total warranty / deposits held */}
            <MetricCard
              icon={<ShieldCheck className="h-5 w-5 text-muted-foreground" />}
              label={t("totalWarranty")}
              value={eur(data?.totalWarranty ?? 0)}
              hint={t("totalWarrantyHint")}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueClass = "",
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {icon}
        </div>
        <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
