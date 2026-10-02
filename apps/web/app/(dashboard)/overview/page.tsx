"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bell,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/dateLocale";

type ReminderLevel = "friendly" | "formal" | "final";

interface BucketItem {
  leaseId: string;
  propertyName: string;
  tenantName: string;
  rentDue: number;
  dueDate: string;
  recentPayments: Array<{ amount: number; date: string; status: string }>;
}

interface Overview {
  month: string; // YYYY-MM
  isCurrentMonth?: boolean;
  expectedThisMonth: number;
  paidThisMonth: number;
  toComeThisMonth: number;
  overdueThisMonth: number;
  overdueTotal: number;
  totalWarranty: number;
  overdueItems?: BucketItem[];
  toComeItems?: BucketItem[];
  paidItems?: BucketItem[];
  currency: string;
}

type Bucket = "paid" | "to-come" | "overdue";

const eur = (n: number) =>
  `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OverviewPage() {
  const t = useTranslations("overview");
  const tc = useTranslations("dashboard");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  // null = the live current month; otherwise "YYYY-MM".
  const [month, setMonth] = useState<string | null>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const load = useCallback(async () => {
    try {
      const q = month ? `?month=${month}` : "";
      const res = await fetch(`${apiUrl}/api/v1/payments/dashboard${q}`, {
        credentials: "include",
      });
      if (res.ok) setData((await res.json()).data);
    } catch {
      toast.error(tc("toast.loadFailed") || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tc, month]);

  useEffect(() => {
    load();
  }, [load]);

  // When a card is expanded, bring its breakdown into view so the change below
  // the fold is obvious (especially on a phone).
  useEffect(() => {
    if (openBucket && breakdownRef.current) {
      breakdownRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [openBucket]);

  const shiftMonth = (delta: number) => {
    const base = data?.month ?? new Date().toISOString().slice(0, 7);
    const [yy, mm] = base.split("-").map(Number);
    const d = new Date(yy, (mm - 1) + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const nowM = new Date().toISOString().slice(0, 7);
    setMonth(next === nowM ? null : next);
    setOpenBucket(null);
  };

  const markPaid = async (leaseId: string, method: "cash" | "bank_transfer" | "other") => {
    const periodMonth = data?.month ?? new Date().toISOString().slice(0, 7);
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/mark-month-paid`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, month: periodMonth, method }),
      });
      if (res.ok) {
        toast.success(t("markedPaid"));
        await load();
      } else {
        const err = (await res.json().catch(() => ({}))).error || tc("toast.saveFailed");
        toast.error(err);
      }
    } catch {
      toast.error(tc("toast.networkError"));
    }
  };

  const sendReminder = async (leaseId: string, level: ReminderLevel) => {
    const periodMonth = data?.month ?? new Date().toISOString().slice(0, 7);
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/send-reminder`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, month: periodMonth, level }),
      });
      if (res.ok) {
        const r = (await res.json()).data;
        toast.success(
          r?.testPhase
            ? t("reminderSentTest", { to: r.sentTo })
            : t("reminderSent", { to: r?.sentTo ?? "" }),
        );
      } else {
        const err = (await res.json().catch(() => ({}))).error || t("reminderFailed");
        toast.error(err);
      }
    } catch {
      toast.error(t("reminderFailed"));
    }
  };

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

  const toggle = (b: Bucket) => setOpenBucket((cur) => (cur === b ? null : b));

  const bucketConfig: Record<
    Bucket,
    { items: BucketItem[]; title: string; hint: string; showLastPayment: boolean }
  > = {
    paid: {
      items: data?.paidItems ?? [],
      title: t("paidBreakdown"),
      hint: t("paidBreakdownHint"),
      showLastPayment: true,
    },
    "to-come": {
      items: data?.toComeItems ?? [],
      title: t("toComeBreakdown"),
      hint: t("toComeBreakdownHint"),
      showLastPayment: false,
    },
    overdue: {
      items: data?.overdueItems ?? [],
      title: t("overdueBreakdown"),
      hint: t("overdueBreakdownHint"),
      showLastPayment: true,
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftMonth(-1)}
            aria-label={t("prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium capitalize">
            {monthLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftMonth(1)}
            aria-label={t("nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {month && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => { setMonth(null); setOpenBucket(null); }}>
              {t("thisMonth")}
            </Button>
          )}
        </div>
      </div>
      <p className="-mt-4 text-muted-foreground">
        {t("subtitle")} {monthLabel && <span className="capitalize">{monthLabel}</span>}
      </p>

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
              onClick={() => toggle("paid")}
              expanded={openBucket === "paid"}
              icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
              label={t("paidThisMonth")}
              value={eur(paid)}
              valueClass="text-green-700 dark:text-green-400"
              hint={`${paidPct}% ${t("ofExpected")}`}
            />
            <MetricCard
              onClick={() => toggle("to-come")}
              expanded={openBucket === "to-come"}
              icon={<Clock className="h-5 w-5 text-blue-600" />}
              label={t("toCome")}
              value={eur(data?.toComeThisMonth ?? 0)}
              valueClass="text-blue-700 dark:text-blue-400"
              hint={t("toComeHint")}
            />
            <MetricCard
              onClick={() => toggle("overdue")}
              expanded={openBucket === "overdue"}
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

          {/* Inline breakdown for the selected card: same figures as the card. */}
          {openBucket && (
            <div ref={breakdownRef} className="scroll-mt-4">
              <BucketBreakdown
                bucket={openBucket}
                config={bucketConfig[openBucket]}
                t={t}
                onRemind={sendReminder}
                onMarkPaid={markPaid}
              />
            </div>
          )}

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

function BucketBreakdown({
  bucket,
  config,
  t,
  onRemind,
  onMarkPaid,
}: {
  bucket: Bucket;
  config: { items: BucketItem[]; title: string; hint: string; showLastPayment: boolean };
  t: ReturnType<typeof useTranslations>;
  onRemind: (leaseId: string, level: ReminderLevel) => void;
  onMarkPaid: (leaseId: string, method: "cash" | "bank_transfer" | "other") => void;
}) {
  // Reminders and marking paid make sense for money still owed, not already-paid rent.
  const canAct = bucket !== "paid";
  const canRemind = canAct;
  const accent =
    bucket === "overdue"
      ? "text-red-600"
      : bucket === "paid"
        ? "text-green-600"
        : "text-blue-600";
  const amountColor =
    bucket === "overdue"
      ? "text-red-700 dark:text-red-400"
      : bucket === "paid"
        ? "text-green-700 dark:text-green-400"
        : "text-blue-700 dark:text-blue-400";
  const Icon =
    bucket === "overdue" ? AlertTriangle : bucket === "paid" ? CheckCircle2 : Clock;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <Icon className={`h-5 w-5 ${accent}`} />
          <h2 className="font-semibold">{config.title}</h2>
        </div>
        {config.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noItems")}</p>
        ) : (
          <div className="space-y-3">
            {config.items.map((item) => (
              <div
                key={item.leaseId}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{item.propertyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.tenantName} &middot; {t("dueLabel")} {formatDate(item.dueDate)}
                  </p>
                  {config.showLastPayment && (
                    <p className="mt-1 text-xs">
                      {item.recentPayments.length > 0
                        ? t("lastPayment", {
                            amount: eur(item.recentPayments[0].amount),
                            date: formatDate(item.recentPayments[0].date),
                          })
                        : t("noPaymentFound")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${amountColor}`}>{eur(item.rentDue)}</span>
                  {canAct && (
                    <MarkPaidButton leaseId={item.leaseId} t={t} onMarkPaid={onMarkPaid} />
                  )}
                  {canRemind && (
                    <ReminderButton leaseId={item.leaseId} t={t} onRemind={onRemind} />
                  )}
                  <Link
                    href={`/ledger/${item.leaseId}`}
                    className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
                  >
                    {t("reconcile")}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
        {config.items.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{config.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MarkPaidButton({
  leaseId,
  t,
  onMarkPaid,
}: {
  leaseId: string;
  t: ReturnType<typeof useTranslations>;
  onMarkPaid: (leaseId: string, method: "cash" | "bank_transfer" | "other") => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = async (method: "cash" | "bank_transfer" | "other") => {
    setOpen(false);
    setBusy(true);
    await onMarkPaid(leaseId, method);
    setBusy(false);
  };

  const methods: Array<{ method: "cash" | "bank_transfer" | "other"; label: string }> = [
    { method: "cash", label: t("markPaidCash") },
    { method: "bank_transfer", label: t("markPaidTransfer") },
    { method: "other", label: t("markPaidOther") },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-1 rounded-md border border-green-600/40 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("markPaid")}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border bg-popover shadow-md">
            {methods.map((m) => (
              <button
                key={m.method}
                type="button"
                onClick={() => pick(m.method)}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReminderButton({
  leaseId,
  t,
  onRemind,
}: {
  leaseId: string;
  t: ReturnType<typeof useTranslations>;
  onRemind: (leaseId: string, level: ReminderLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const pick = async (level: ReminderLevel) => {
    setOpen(false);
    setSending(true);
    await onRemind(leaseId, level);
    setSending(false);
  };

  const levels: Array<{ level: ReminderLevel; label: string }> = [
    { level: "friendly", label: t("reminderFriendly") },
    { level: "formal", label: t("reminderFormal") },
    { level: "final", label: t("reminderFinal") },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={sending}
        className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        <Bell className="h-3.5 w-3.5" />
        {t("sendReminder")}
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            type="button"
            aria-hidden
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border bg-popover shadow-md">
            {levels.map((l) => (
              <button
                key={l.level}
                type="button"
                onClick={() => pick(l.level)}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
              >
                {l.label}
              </button>
            ))}
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
  onClick,
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const inner = (
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
      {hint && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {hint}
          {onClick && (
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          )}
        </p>
      )}
    </CardContent>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        className="block w-full text-left"
      >
        <Card
          className={`transition-colors hover:bg-muted/50 ${expanded ? "ring-2 ring-ring" : ""}`}
        >
          {inner}
        </Card>
      </button>
    );
  }
  return <Card>{inner}</Card>;
}
