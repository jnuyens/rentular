"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Wand2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/dateLocale";

interface Allocation {
  id: string;
  paymentId: string;
  amount: number;
  paidDate: string | null;
  auto: boolean;
}
interface Period {
  month: string;
  dueDate: string;
  rentDue: number;
  allocated: number;
  balance: number;
  status: "paid" | "partial" | "open" | "overpaid";
  allocations: Allocation[];
}
interface LedgerPayment {
  id: string;
  amount: number;
  paidDate: string | null;
  dueDate: string;
  status: string;
  method: string;
  notes: string | null;
  allocated: number;
  unallocated: number;
}
interface Ledger {
  lease: {
    id: string;
    propertyName: string;
    tenantName: string;
    monthlyRent: number;
    charges: number;
    rentDue: number;
    paymentDay: number;
    startDate: string | null;
    currency: string;
  };
  periods: Period[];
  payments: LedgerPayment[];
  summary: {
    totalCharged: number;
    totalAllocated: number;
    totalReceived: number;
    totalUnallocated: number;
    openBalance: number;
  };
}

const eur = (n: number) =>
  `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (month: string) => {
  const d = new Date(`${month}-01T00:00:00`);
  return isNaN(d.getTime())
    ? month
    : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

export default function LedgerPage() {
  const t = useTranslations("ledger");
  const params = useParams();
  const router = useRouter();
  const leaseId = String(params.leaseId);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null); // period month

  const load = useCallback(async () => {
    try {
      const q = showAll ? "?months=0" : "";
      const res = await fetch(`${apiUrl}/api/v1/ledger/${leaseId}${q}`, {
        credentials: "include",
      });
      if (res.ok) setData((await res.json()).data);
      else toast.error(t("loadError"));
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, leaseId, showAll, t]);

  useEffect(() => {
    load();
  }, [load]);

  const autoAssign = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/ledger/${leaseId}/auto`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const created = (await res.json()).data?.created ?? 0;
        toast.success(created > 0 ? t("autoAssignDone", { count: created }) : t("autoAssignNone"));
        await load();
      } else toast.error(t("loadError"));
    } finally {
      setBusy(false);
    }
  };

  const allocate = async (periodMonth: string, paymentId: string, amount: number) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/ledger/${leaseId}/allocations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, periodMonth, amount }),
      });
      if (res.ok) {
        toast.success(t("saved"));
        setAssigning(null);
        await load();
      } else {
        const err = (await res.json().catch(() => ({}))).error || t("loadError");
        toast.error(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeAllocation = async (allocationId: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/ledger/${leaseId}/allocations/${allocationId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (res.ok) {
        toast.success(t("removed"));
        await load();
      } else toast.error(t("loadError"));
    } finally {
      setBusy(false);
    }
  };

  const availablePayments = (data?.payments ?? []).filter(
    (p) => p.status === "paid" && p.unallocated > 0.005,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </button>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          {data && (
            <p className="text-muted-foreground">
              {data.lease.propertyName} &middot; {data.lease.tenantName} &middot;{" "}
              {eur(data.lease.rentDue)}/m
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={autoAssign} disabled={busy || loading}>
          <Wand2 className="mr-1.5 h-4 w-4" />
          {t("autoAssign")}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : !data ? (
        <p className="text-sm text-destructive">{t("loadError")}</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Summary label={t("totalCharged")} value={eur(data.summary.totalCharged)} />
            <Summary label={t("totalReceived")} value={eur(data.summary.totalReceived)} />
            <Summary
              label={t("unallocated")}
              value={eur(data.summary.totalUnallocated)}
              accent={data.summary.totalUnallocated > 0.005 ? "text-amber-600" : ""}
            />
            <Summary
              label={t("openBalance")}
              value={eur(data.summary.openBalance)}
              accent={data.summary.openBalance > 0.005 ? "text-red-600" : "text-green-600"}
            />
          </div>

          <p className="text-xs text-muted-foreground">{t("assignHint")}</p>

          {/* Periods */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 font-semibold">{t("periods")}</h2>
              <div className="space-y-2">
                {data.periods.map((p) => (
                  <div key={p.month} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium capitalize">{monthLabel(p.month)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("due")} {formatDate(p.dueDate)} &middot; {t("rentDue")}{" "}
                          {eur(p.rentDue)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={p.status} label={t(statusKey(p.status))} />
                        <div className="text-right text-sm">
                          <div>
                            {t("allocated")}: {eur(p.allocated)}
                          </div>
                          {p.balance > 0.005 && (
                            <div className="text-red-600">
                              {t("balance")}: {eur(p.balance)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Existing allocations */}
                    {p.allocations.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {p.allocations.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs"
                          >
                            <span>
                              {eur(a.amount)}
                              {a.paidDate && ` (${t("paidOn", { date: formatDate(a.paidDate) })})`}
                              {a.auto && " · auto"}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeAllocation(a.id)}
                              disabled={busy}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={t("remove")}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Assign control */}
                    {p.balance > 0.005 && (
                      <div className="mt-2">
                        {assigning === p.month ? (
                          <AssignPanel
                            payments={availablePayments}
                            suggested={p.balance}
                            busy={busy}
                            t={t}
                            onCancel={() => setAssigning(null)}
                            onAssign={(paymentId, amount) => allocate(p.month, paymentId, amount)}
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setAssigning(p.month)}
                            disabled={busy}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            {t("assign")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Button variant="link" size="sm" className="px-0" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? t("showRecent") : t("showAll")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Payments received */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 font-semibold">{t("paymentsReceived")}</h2>
              <div className="space-y-2">
                {data.payments
                  .filter((p) => p.status === "paid")
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {eur(p.amount)}
                          {p.paidDate && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t("paidOn", { date: formatDate(p.paidDate) })}
                            </span>
                          )}
                        </p>
                        {p.notes && (
                          <p className="text-xs text-muted-foreground">{p.notes}</p>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        {p.unallocated > 0.005 ? (
                          <span className="font-medium text-amber-600">
                            {t("freeAmount", { amount: eur(p.unallocated) })}
                          </span>
                        ) : (
                          <span className="text-green-600">{t("fullyAllocated")}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function statusKey(s: Period["status"]) {
  return s === "paid"
    ? "statusPaid"
    : s === "partial"
      ? "statusPartial"
      : s === "overpaid"
        ? "statusOverpaid"
        : "statusOpen";
}

function StatusBadge({ status, label }: { status: Period["status"]; label: string }) {
  const cls =
    status === "paid"
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : status === "partial"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : status === "overpaid"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function Summary({ label, value, accent = "" }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function AssignPanel({
  payments,
  suggested,
  busy,
  t,
  onAssign,
  onCancel,
}: {
  payments: LedgerPayment[];
  suggested: number;
  busy: boolean;
  t: ReturnType<typeof useTranslations>;
  onAssign: (paymentId: string, amount: number) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string>(payments[0]?.id ?? "");
  const sel = payments.find((p) => p.id === selected);
  const defaultAmount = sel ? Math.min(sel.unallocated, suggested) : 0;
  const [amount, setAmount] = useState<string>(defaultAmount.toFixed(2));

  useEffect(() => {
    const s = payments.find((p) => p.id === selected);
    if (s) setAmount(Math.min(s.unallocated, suggested).toFixed(2));
  }, [selected, suggested, payments]);

  if (payments.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noPaymentsToAssign")}</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">
            {t("paymentsReceived")}
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {payments.map((p) => (
              <option key={p.id} value={p.id}>
                {eur(p.amount)}
                {p.paidDate ? ` · ${formatDate(p.paidDate)}` : ""} ·{" "}
                {t("freeAmount", { amount: eur(p.unallocated) })}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs text-muted-foreground">{t("amount")}</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={busy || !sel || !(Number(amount) > 0)}
          onClick={() => sel && onAssign(sel.id, Number(amount))}
        >
          {t("confirm")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
