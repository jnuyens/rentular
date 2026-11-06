"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FileText,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/dateLocale";
import { eur } from "@/components/overview/format";

const PAGE_SIZE = 100;

interface PastItem {
  id: string;
  audience: "tenant" | "landlord";
  channel: string;
  type: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  cc: string[];
  subject: string | null;
  body: string;
  status: string;
  errorMessage: string | null;
  trigger: string | null;
  triggeredByName: string | null;
  paymentId: string | null;
  kind: string | null;
  testPhase: boolean;
  sentAt: string | null;
  createdAt: string | null;
}

interface ScheduledItem {
  plannedAt: string;
  date: string;
  time: string;
  kind: string;
  audience: "tenant" | "landlord";
  channel: string;
  amount: number | null;
  dueDate: string | null;
  to: string | null;
  cc: string[];
  condition: string;
}

interface HistoryData {
  lease: { id: string; propertyName: string; tenantName: string };
  past: PastItem[];
  scheduled: ScheduledItem[];
  total: number;
  lastSevenDays: number;
}

function ChannelIcon({ channel }: { channel: string }) {
  const cls = "h-4 w-4";
  if (channel === "email") return <Mail className={cls} />;
  if (channel === "sms") return <MessageSquare className={cls} />;
  if (channel === "whatsapp") return <MessageCircle className={`${cls} text-green-600`} />;
  if (channel === "signal") return <Send className={`${cls} text-blue-600`} />;
  return <FileText className={cls} />;
}

const STATUS_CLASS: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-700",
  delivered: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  bounced: "bg-red-100 text-red-700",
};

export default function LeaseCommunicationPage() {
  const t = useTranslations("contractComms");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const leaseId = params.id;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [channel, setChannel] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fetchPage = useCallback(
    async (offset: number): Promise<HistoryData | null> => {
      const res = await fetch(
        `${apiUrl}/api/v1/leases/${leaseId}/communications?limit=${PAGE_SIZE}&offset=${offset}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()).data ?? null) as HistoryData | null;
    },
    [apiUrl, leaseId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPage(0)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => toast.error(t("loadError")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, t]);

  const loadMore = async () => {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await fetchPage(data.past.length);
      if (next) setData({ ...data, past: [...data.past, ...next.past] });
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoadingMore(false);
    }
  };

  const kindLabel = (type: string, landlordKind?: string | null): string => {
    if (type === "landlord_notification" && landlordKind && t.has(`landlordKind.${landlordKind}`)) {
      return t(`landlordKind.${landlordKind}`);
    }
    return t.has(`kind.${type}`) ? t(`kind.${type}`) : type;
  };
  const channelLabel = (c: string) => (t.has(`channel.${c}`) ? t(`channel.${c}`) : c);
  const statusLabel = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);

  const triggerLabel = (item: PastItem): string | null => {
    if (item.trigger === "schedule") return t("trigger.schedule");
    if (item.trigger === "magic_link") return t("trigger.magic_link");
    if (item.trigger === "manual")
      return item.triggeredByName ? t("trigger.manualBy", { name: item.triggeredByName }) : t("trigger.manual");
    if (item.trigger === "api")
      return item.triggeredByName ? t("trigger.apiBy", { name: item.triggeredByName }) : t("trigger.api");
    return null;
  };

  const past = useMemo(() => data?.past ?? [], [data]);
  const channels = useMemo(() => [...new Set(past.map((p) => p.channel))].sort(), [past]);
  const kinds = useMemo(() => [...new Set(past.map((p) => p.type))].sort(), [past]);
  const matches = (p: PastItem) => (!channel || p.channel === channel) && (!kind || p.type === kind);
  const tenantItems = past.filter((p) => p.audience === "tenant" && matches(p));
  const landlordItems = past.filter((p) => p.audience === "landlord" && matches(p));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderPast = (item: PastItem) => {
    const isOpen = open.has(item.id);
    const recipient = item.recipientEmail || item.recipientPhone || item.recipientName;
    const trigger = triggerLabel(item);
    return (
      <li key={item.id} className="rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 text-muted-foreground" title={channelLabel(item.channel)}>
              <ChannelIcon channel={item.channel} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {kindLabel(item.type, item.kind)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {formatDateTime(item.sentAt || item.createdAt)}
                </span>
              </p>
              {item.subject && <p className="truncate text-sm">{item.subject}</p>}
              <p className="text-xs text-muted-foreground">
                {t("to")}: {recipient}
                {item.cc.length > 0 && (
                  <>
                    {" "}
                    &middot; {t("cc")}: {item.cc.join(", ")}
                  </>
                )}
              </p>
              {trigger && <p className="text-xs text-muted-foreground">{trigger}</p>}
              {item.testPhase && <p className="text-xs text-amber-700">{t("testPhase")}</p>}
              {(item.status === "failed" || item.status === "bounced") && item.errorMessage && (
                <p className="mt-1 break-words text-xs text-red-700">{item.errorMessage}</p>
              )}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status] ?? "bg-muted"}`}
          >
            {statusLabel(item.status)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => toggle(item.id)}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-navy hover:underline"
        >
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {isOpen ? t("hideBody") : t("showBody")}
        </button>
        {isOpen && (
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">
            {item.body}
          </pre>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
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
            {data.lease.propertyName}
            {data.lease.tenantName ? <> &middot; {data.lease.tenantName}</> : null}
          </p>
        )}
        {data && (
          <p
            className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${
              data.lastSevenDays >= 3 ? "bg-amber-100 text-amber-800" : "bg-muted text-foreground"
            }`}
          >
            {t("lastSevenDays", { count: data.lastSevenDays })}
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : !data ? null : (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <CalendarClock className="h-5 w-5" />
                  {t("scheduledTitle")}
                </h2>
                <span className="text-xs text-muted-foreground">{t("timeNote")}</span>
              </div>
              {data.scheduled.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("scheduledEmpty")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.scheduled.map((s, i) => (
                    <li
                      key={`${s.plannedAt}-${s.kind}-${i}`}
                      className={`rounded-lg border p-3 ${s.audience === "landlord" ? "bg-muted/40" : "bg-white"}`}
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="mt-0.5 text-muted-foreground" title={channelLabel(s.channel)}>
                          <ChannelIcon channel={s.channel} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {formatDate(s.date)} {s.time}
                            <span className="ml-2">{kindLabel(s.kind)}</span>
                            {s.audience === "landlord" && (
                              <span className="ml-2 font-normal text-muted-foreground">({t("toLandlord")})</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.amount != null && <>{eur(s.amount)} &middot; </>}
                            {s.dueDate && <>{t("forDue", { date: formatDate(s.dueDate) })} &middot; </>}
                            {channelLabel(s.channel)}
                            {s.to && (
                              <>
                                {" "}
                                &middot; {t("to")}: {s.to}
                              </>
                            )}
                            {s.cc.length > 0 && (
                              <>
                                {" "}
                                &middot; {t("cc")}: {s.cc.join(", ")}
                              </>
                            )}
                          </p>
                          <p
                            className={`text-xs ${
                              s.condition === "on_hold_transfer_review" ? "text-amber-700" : "text-muted-foreground"
                            }`}
                          >
                            {s.condition === "on_hold_transfer_review" ? (
                              <Link href="/reconciliation" className="underline">
                                {t(`condition.${s.condition}`)}
                              </Link>
                            ) : (
                              t.has(`condition.${s.condition}`) && t(`condition.${s.condition}`)
                            )}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-9 rounded-md border border-input bg-white px-2 text-sm"
              aria-label={t("allChannels")}
            >
              <option value="">{t("allChannels")}</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-9 rounded-md border border-input bg-white px-2 text-sm"
              aria-label={t("allKinds")}
            >
              <option value="">{t("allKinds")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">{t("sentTitle")}</h2>
              {tenantItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("sentEmpty")}</p>
              ) : (
                <ul className="space-y-2">{tenantItems.map(renderPast)}</ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">{t("landlordTitle")}</h2>
              {landlordItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("landlordEmpty")}</p>
              ) : (
                <ul className="space-y-2">{landlordItems.map(renderPast)}</ul>
              )}
            </CardContent>
          </Card>

          {data.past.length < data.total && (
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {t("loadMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
