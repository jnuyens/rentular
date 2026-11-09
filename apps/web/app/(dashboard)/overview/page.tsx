"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Bell,
  Check,
  Coins,
  MoreHorizontal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, monthInZone } from "@/lib/dateLocale";
import { useDashboardUser } from "@/components/DashboardUserContext";
import KpiCard from "@/components/overview/KpiCard";
import ProgressRing from "@/components/overview/ProgressRing";
import RentHistoryChart, { type HistoryEntry } from "@/components/overview/RentHistoryChart";
import PortfolioCard, { type Portfolio } from "@/components/overview/PortfolioCard";
import TodoCard from "@/components/overview/TodoCard";
import QuickActions from "@/components/overview/QuickActions";
import BelgiumInfoCard from "@/components/overview/BelgiumInfoCard";
import { eur, pctOf } from "@/components/overview/format";
import {
  MuteBadge,
  MuteButton,
  ReminderMuteDialog,
  muteByLine,
  shortDate,
  type ReminderMuteInfo,
} from "@/components/leases/ReminderMute";

type ReminderLevel = "friendly" | "formal" | "final";

interface BucketItem {
  leaseId: string;
  propertyName: string;
  tenantName: string;
  rentDue: number;
  dueDate: string;
  recentPayments: Array<{ amount: number; date: string; status: string }>;
  /**
   * Only part of the rent came in. In the overdue and to-come lists rentDue is
   * what is still missing; in the paid list it is what was received.
   */
  shortfall?: boolean;
  expected?: number;
  received?: number;
  remaining?: number;
  /** The rent from before the indexation, when that is exactly what was paid. */
  oldRent?: number;
  /** What the whole contract still owes today. */
  contractOwed?: number;
  /** What the tenant paid more than was due over the whole contract. */
  contractCredit?: number;
  /** The contract's late-payment reminders are muted until a date. */
  mute?: ReminderMuteInfo;
  /** Due date of the lease's next rent. */
  nextDueDate?: string;
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
  history?: HistoryEntry[];
  portfolio?: Portfolio;
}

type Bucket = "paid" | "to-come" | "overdue";

/** How many still-to-come rows the collection card lists before linking to the breakdown. */
const COLLECTION_ROWS = 3;

/** Colour of an item's amount: partly paid rent is never shown as fully paid green. */
function amountColorFor(bucket: Bucket, item: BucketItem): string {
  // Still owed, but the tenant has until the agreed date: calm, not red.
  if (bucket !== "paid" && item.mute?.active) return "text-sky-800 dark:text-sky-300";
  if (bucket === "paid") {
    return item.shortfall
      ? "text-amber-700 dark:text-amber-400"
      : "text-green-700 dark:text-green-400";
  }
  return bucket === "overdue"
    ? "text-red-700 dark:text-red-400"
    : "text-blue-700 dark:text-blue-400";
}

interface IndexationRaiseItem {
  leaseId: string;
  canApply: boolean;
  raiseAmount: number;
  newRent: number;
  currentRent: number;
  propertyName: string;
  tenantNames: string;
}

/**
 * Contracts that can be indexed right now, fetched once for the page. Always
 * reflects today, so it does not follow the month navigator. Best effort:
 * empty on error.
 */
function useIndexationRaises(apiUrl: string): IndexationRaiseItem[] {
  const [items, setItems] = useState<IndexationRaiseItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/indexation/raise-summary`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: IndexationRaiseItem[] };
        const list = (json.data ?? [])
          .filter((i) => i.canApply && i.raiseAmount > 0.005)
          .sort((a, b) => b.raiseAmount - a.raiseAmount);
        if (!cancelled) setItems(list);
      } catch {
        // Optional data: leave it empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);
  return items;
}

/** Morning before 12:00, afternoon until 18:00, evening after. Null until mounted. */
function useDayPart(): "morning" | "afternoon" | "evening" | null {
  const [part, setPart] = useState<"morning" | "afternoon" | "evening" | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
  }, []);
  return part;
}

export default function OverviewPage() {
  const t = useTranslations("overview");
  const tc = useTranslations("dashboard");
  const tm = useTranslations("reminderMute");
  const { firstName } = useDashboardUser();
  const dayPart = useDayPart();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  // null = the live current month; otherwise "YYYY-MM".
  const [month, setMonth] = useState<string | null>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const raises = useIndexationRaises(apiUrl);

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

  // When a card is expanded, scroll the breakdown to the top so the change
  // below the fold is obvious. Scroll the actual <main> scroll container (not the
  // window) and account for the mobile header, so it lands reliably in the app.
  useEffect(() => {
    if (!openBucket) return;
    const el = breakdownRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const scroller = el.closest("main");
      const headerOffset = window.innerWidth < 768 ? 64 : 16;
      if (scroller instanceof HTMLElement) {
        const delta =
          el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollBy({ top: delta - headerOffset, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [openBucket]);

  const shiftMonth = (delta: number) => {
    const base = data?.month ?? monthInZone();
    const [yy, mm] = base.split("-").map(Number);
    const d = new Date(yy, (mm - 1) + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const nowM = monthInZone();
    setMonth(next === nowM ? null : next);
    setOpenBucket(null);
  };

  const markPaid = async (
    leaseId: string,
    method: "cash" | "bank_transfer" | "other",
    month?: string,
  ) => {
    const periodMonth = month ?? data?.month ?? monthInZone();
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

  const sendReminder = async (leaseId: string, level: ReminderLevel, month?: string) => {
    // A manual reminder stays possible on a muted contract, after a check.
    const mute = [...(data?.overdueItems ?? []), ...(data?.toComeItems ?? [])].find(
      (i) => i.leaseId === leaseId && i.mute?.active,
    )?.mute;
    if (mute && !window.confirm(tm("remindConfirm", { date: shortDate(mute.until) }))) return;
    const periodMonth = month ?? data?.month ?? monthInZone();
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
        if (r?.waitingTransfer) {
          toast.warning(
            t("reminderTransferWaiting", {
              amount: eur(Number(r.waitingTransfer.amount)),
              date: formatDate(String(r.waitingTransfer.bookingDate)),
            }),
            { duration: 15000 },
          );
        }
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.code === "nothing_owed" ? t("reminderNothingOwed") : body.error || t("reminderFailed"));
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
  const toCome = data?.toComeThisMonth ?? 0;
  const overdueTotal = data?.overdueTotal ?? 0;
  const overdueThisMonth = data?.overdueThisMonth ?? 0;
  const paidPct = pctOf(paid, expected);
  const toComePct = pctOf(toCome, expected);

  const toggle = (b: Bucket) => setOpenBucket((cur) => (cur === b ? null : b));
  const openToCome = () => setOpenBucket("to-come");

  const greeting = (() => {
    if (!dayPart) return firstName ?? t("title");
    const key = { morning: "greetingMorning", afternoon: "greetingAfternoon", evening: "greetingEvening" }[dayPart];
    return firstName ? t(key, { name: firstName }) : t(`${key}Plain`);
  })();

  // Overdue status badge: green check when nothing is overdue, amber when only
  // this month's rent is late, red when older months are still open too.
  const overdueOnlyThisMonth = overdueTotal > 0.005 && Math.abs(overdueTotal - overdueThisMonth) < 0.01;
  const overdueBadge =
    overdueTotal <= 0.005 ? (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-pill text-white shadow-md">
        <Check className="h-6 w-6" strokeWidth={3} />
      </span>
    ) : (
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md ${
          overdueOnlyThisMonth ? "bg-amber-500" : "bg-red-600"
        }`}
      >
        <AlertTriangle className="h-5 w-5" />
      </span>
    );

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

  const raiseTotal = Number(raises.reduce((sum, i) => sum + i.raiseAmount, 0).toFixed(2));

  return (
    <div className="space-y-6">
      {/* Header: greeting, tagline and the month switcher over a skyline banner */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-8 hidden h-44 w-[58%] select-none md:block lg:-right-8"
          style={{ maskImage: "linear-gradient(to right, transparent 0%, black 40%)", WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 40%)" }}
        >
          <Image
            src="/brand/skyline-banner.webp"
            alt=""
            fill
            priority
            sizes="60vw"
            className="object-cover object-right"
            style={{ maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)" }}
          />
        </div>
        <div className="relative flex flex-wrap items-end justify-between gap-4 pt-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-navy sm:text-3xl">{greeting}</h1>
            <p className="mt-1 text-sm text-navy/75 sm:text-base">{t("tagline")}</p>
          </div>
          <div className="flex items-center gap-2">
            {month && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 bg-white/90"
                onClick={() => {
                  setMonth(null);
                  setOpenBucket(null);
                }}
              >
                {t("thisMonth")}
              </Button>
            )}
            <div className="flex items-center rounded-full bg-navy p-1 text-white shadow-lg">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label={t("prevMonth")}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[9.5rem] px-2 text-center text-sm font-semibold capitalize">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label={t("nextMonth")}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              kind="expected"
              icon={Coins}
              title={t("expectedThisMonth")}
              value={eur(expected)}
              subline={t("expectedHint")}
            />
            <KpiCard
              kind="received"
              icon={CheckCircle2}
              title={t("paidThisMonth")}
              value={eur(paid)}
              subline={`${paidPct}% ${t("ofExpected")}`}
              aside={<ProgressRing pct={paidPct} color="#3FAE2A" />}
              onClick={() => toggle("paid")}
              expanded={openBucket === "paid"}
            />
            <KpiCard
              kind="toCome"
              icon={Clock}
              title={t("toCome")}
              value={eur(toCome)}
              subline={t("toComeHint")}
              aside={<ProgressRing pct={toComePct} color="#F97316" />}
              onClick={() => toggle("to-come")}
              expanded={openBucket === "to-come"}
            />
            <KpiCard
              kind="overdue"
              icon={AlertTriangle}
              title={t("overdue")}
              value={eur(overdueTotal)}
              valueClass={overdueTotal > 0 ? "!text-red-700" : ""}
              subline={
                overdueThisMonth > 0
                  ? t("overdueThisMonth", { amount: eur(overdueThisMonth) })
                  : overdueTotal > 0
                    ? undefined
                    : t("overdueHint")
              }
              aside={overdueBadge}
              onClick={() => toggle("overdue")}
              expanded={openBucket === "overdue"}
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
                onReload={load}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CollectionCard
                t={t}
                paid={paid}
                expected={expected}
                paidPct={paidPct}
                items={data?.toComeItems ?? []}
                onOpenBreakdown={openToCome}
                onRemind={sendReminder}
                onMarkPaid={markPaid}
              />
            </div>
            <RentHistoryChart history={data?.history ?? []} selectedMonth={data?.month ?? ""} />
          </div>

          <div className={`grid grid-cols-1 gap-4 ${raises.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
            {raises.length > 0 && <IndexationTodayCard items={raises} total={raiseTotal} t={t} />}
            <PortfolioCard
              portfolio={data?.portfolio ?? { properties: 0, tenants: 0, activeLeases: 0 }}
              totalWarranty={data?.totalWarranty ?? 0}
            />
            <TodoCard
              toComeCount={data?.toComeItems?.length ?? 0}
              toComeAmount={toCome}
              onOpenToCome={openToCome}
              indexCount={raises.length}
              indexGainPerMonth={raiseTotal}
              overdueCount={data?.overdueItems?.length ?? 0}
              overdueAmount={overdueTotal}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <QuickActions />
            </div>
            <BelgiumInfoCard />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * This month's collection: the progress bar over what came in, and the rent
 * still to come with the same mark-paid and reminder actions as the breakdown.
 */
function CollectionCard({
  t,
  paid,
  expected,
  paidPct,
  items,
  onOpenBreakdown,
  onRemind,
  onMarkPaid,
}: {
  t: ReturnType<typeof useTranslations>;
  paid: number;
  expected: number;
  paidPct: number;
  items: BucketItem[];
  onOpenBreakdown: () => void;
  onRemind: (leaseId: string, level: ReminderLevel, month?: string) => void;
  onMarkPaid: (leaseId: string, method: "cash" | "bank_transfer" | "other", month?: string) => void;
}) {
  const shown = items.slice(0, COLLECTION_ROWS);
  const more = items.length - shown.length;
  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-navy">{t("collectionTitle")}</h2>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("collected")}</span>
          <span className="font-semibold text-navy">
            {eur(paid)} / {eur(expected)} ({paidPct}%)
          </span>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-green-pill transition-all" style={{ width: `${paidPct}%` }} />
        </div>

        {items.length === 0 ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-icon-green" />
            {t("collectionNothingLeft")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/70">
            {shown.map((item) => {
              const forMonth = item.dueDate.slice(0, 7);
              return (
                <li
                  key={`${item.leaseId}-${item.dueDate}`}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Image src="/brand/house-tile.svg" alt="" width={40} height={40} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold text-navy">
                        {item.propertyName}
                        {item.shortfall && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {t("partlyPaid")}
                          </span>
                        )}
                        {item.contractCredit != null && item.contractCredit > 0 && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            {t("contractCredit", { amount: eur(item.contractCredit) })}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.tenantName} &middot; {t("dueLabel")} {formatDate(item.dueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold ${amountColorFor("to-come", item)}`}>{eur(item.rentDue)}</span>
                    <MarkPaidButton
                      leaseId={item.leaseId}
                      t={t}
                      onMarkPaid={(leaseId, method) => onMarkPaid(leaseId, method, forMonth)}
                    />
                    <ReminderButton
                      leaseId={item.leaseId}
                      t={t}
                      onRemind={(leaseId, level) => onRemind(leaseId, level, forMonth)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("moreActions")}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-input bg-white text-navy hover:bg-muted"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={onOpenBreakdown}>{t("openBreakdown")}</DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/ledger/${item.leaseId}`}>{t("reconcile")}</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/leases/${item.leaseId}`}>{t("communication")}</Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {more > 0 && (
          <button
            type="button"
            onClick={onOpenBreakdown}
            className="mt-1 text-sm font-medium text-royal hover:underline"
          >
            {t("collectionMore", { count: more })}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// Contracts that can be indexed right now, with the gain per month.
function IndexationTodayCard({
  items,
  total,
  t,
}: {
  items: IndexationRaiseItem[];
  total: number;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-icon-green" />
              <h2 className="font-bold text-navy">{t("indexationToday")}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("indexationTodayHint")}</p>
          </div>
          <span className="shrink-0 rounded-full bg-tint-green px-3 py-1 text-sm font-bold text-green-dark">
            +{eur(total)}
            {t("perMonth")}
          </span>
        </div>
        <ul className="mt-3 divide-y divide-border/70">
          {items.map((item) => (
            <li key={item.leaseId}>
              <Link
                href={`/indexation?lease=${item.leaseId}`}
                className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60"
              >
                <Image src="/brand/house-tile.svg" alt="" width={36} height={36} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy">{item.propertyName}</p>
                  {item.tenantNames && (
                    <p className="truncate text-xs text-muted-foreground">{item.tenantNames}</p>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="text-muted-foreground">
                    {eur(item.currentRent)} → {eur(item.newRent)}
                  </p>
                  <p className="font-semibold text-green-dark">
                    +{eur(item.raiseAmount)}
                    {t("perMonthShort")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BucketBreakdown({
  bucket,
  config,
  t,
  onRemind,
  onMarkPaid,
  onReload,
}: {
  bucket: Bucket;
  config: { items: BucketItem[]; title: string; hint: string; showLastPayment: boolean };
  t: ReturnType<typeof useTranslations>;
  onRemind: (leaseId: string, level: ReminderLevel, month?: string) => void;
  onMarkPaid: (
    leaseId: string,
    method: "cash" | "bank_transfer" | "other",
    month?: string,
  ) => void;
  onReload: () => void | Promise<void>;
}) {
  const ta = useTranslations("reminderMute");
  const [muteFor, setMuteFor] = useState<BucketItem | null>(null);
  // Reminders and marking paid make sense for money still owed, not already-paid rent.
  const canAct = bucket !== "paid";
  const canRemind = canAct;
  // Muting is offered on the late payments: the tenant asked for more time.
  const canMute = bucket === "overdue";
  const accent =
    bucket === "overdue"
      ? "text-red-600"
      : bucket === "paid"
        ? "text-green-600"
        : "text-blue-600";
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
                key={`${item.leaseId}-${item.dueDate}`}
                className="flex flex-col gap-1 rounded-xl border bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {item.propertyName}
                    {item.shortfall && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        {t("partlyPaid")}
                      </span>
                    )}
                    {item.contractCredit != null && item.contractCredit > 0 && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                        {t("contractCredit", { amount: eur(item.contractCredit) })}
                      </span>
                    )}
                    {canAct && item.mute?.active && <MuteBadge mute={item.mute} />}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.tenantName} &middot; {t("dueLabel")} {formatDate(item.dueDate)}
                  </p>
                  {canAct && item.mute?.active && (
                    <p className="text-xs text-sky-800 dark:text-sky-300">
                      {item.mute.note ? <>&ldquo;{item.mute.note}&rdquo; &middot; </> : null}
                      {muteByLine(ta, item.mute)}
                    </p>
                  )}
                  {item.shortfall && (
                    <p className="text-xs text-muted-foreground">
                      {bucket === "paid"
                        ? t("shortfallRemaining", { remaining: eur(item.remaining ?? 0) })
                        : t("shortfallPaidOf", {
                            received: eur(item.received ?? 0),
                            expected: eur(item.expected ?? 0),
                            remaining: eur(item.rentDue),
                          })}
                    </p>
                  )}
                  {item.shortfall && item.oldRent != null && (
                    <p className="text-xs text-muted-foreground">{t("shortfallOldRent")}</p>
                  )}
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
                  <span className={`font-semibold ${amountColorFor(bucket, item)}`}>
                    {eur(item.rentDue)}
                  </span>
                  {canAct && (
                    <MarkPaidButton
                      leaseId={item.leaseId}
                      t={t}
                      onMarkPaid={(leaseId, method) =>
                        onMarkPaid(leaseId, method, item.dueDate.slice(0, 7))
                      }
                    />
                  )}
                  {canRemind && (
                    <ReminderButton
                      leaseId={item.leaseId}
                      t={t}
                      onRemind={(leaseId, level) =>
                        onRemind(leaseId, level, item.dueDate.slice(0, 7))
                      }
                    />
                  )}
                  {canMute && (
                    <MuteButton muted={!!item.mute?.active} onClick={() => setMuteFor(item)} />
                  )}
                  <Link
                    href={`/ledger/${item.leaseId}`}
                    className="rounded-lg border border-input bg-white px-2 py-1 text-xs font-medium text-navy hover:bg-muted"
                  >
                    {t("reconcile")}
                  </Link>
                  <Link
                    href={`/leases/${item.leaseId}`}
                    className="rounded-lg border border-input bg-white px-2 py-1 text-xs font-medium text-navy hover:bg-muted"
                  >
                    {t("communication")}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
        {config.items.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{config.hint}</p>
        )}
        {muteFor && (
          <ReminderMuteDialog
            open={!!muteFor}
            onOpenChange={(o) => !o && setMuteFor(null)}
            leaseId={muteFor.leaseId}
            label={`${muteFor.propertyName} · ${muteFor.tenantName}`}
            nextDueDate={muteFor.nextDueDate}
            mute={muteFor.mute?.active ? muteFor.mute : null}
            onChanged={onReload}
          />
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
        className="flex items-center gap-1 rounded-lg border border-green-600/30 bg-tint-green px-2 py-1 text-xs font-medium text-green-dark hover:brightness-95 disabled:opacity-50"
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
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border bg-popover shadow-md">
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
        className="flex items-center gap-1 rounded-lg border border-input bg-white px-2 py-1 text-xs font-medium text-navy hover:bg-muted disabled:opacity-50"
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
          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border bg-popover shadow-md">
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
