"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/dateLocale";
import { eur } from "@/components/overview/format";

interface PaidRow {
  id: string;
  amount: number;
  dueDate: string;
  paidDate: string | null;
  arrears: number;
  oddAmount: boolean;
  credit: boolean;
}

interface Balance {
  owed: number;
  credit: number;
  expected: number;
  received: number;
  arrearsRepaid: number;
  fromMonth: string | null;
  canEdit: boolean;
  paidRows: PaidRow[];
}

const SHOWN = 8;

function monthName(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  return isNaN(d.getTime()) ? month : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** What the tenant owes on the whole contract, or the credit, with the paid rows to mark older arrears. */
export function ContractBalanceCard({ leaseId }: { leaseId: string }) {
  const t = useTranslations("contractBalance");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [data, setData] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/leases/${leaseId}/balance`, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    setData(((await res.json()).data ?? null) as Balance | null);
  }, [apiUrl, leaseId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => toast.error(t("loadError")))
      .finally(() => setLoading(false));
  }, [load, t]);

  const startEdit = (row: PaidRow) => {
    setEditing(row.id);
    setValue((row.arrears > 0 ? row.arrears : row.amount).toFixed(2));
  };

  const save = async (row: PaidRow, amount: number) => {
    if (!(amount >= 0) || Math.round(amount * 100) > Math.round(row.amount * 100)) {
      toast.error(t("amountTooLarge"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/leases/${leaseId}/payments/${row.id}/arrears`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(amount * 100) / 100 }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("saved"));
      setEditing(null);
      await load();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (!data) return null;

  const rows = showAll ? data.paidRows : data.paidRows.slice(0, SHOWN);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wallet className="h-5 w-5" />
          {t("title")}
        </h2>
        <p
          className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
            data.owed > 0
              ? "bg-red-100 text-red-700"
              : data.credit > 0
                ? "bg-green-100 text-green-700"
                : "bg-muted text-foreground"
          }`}
        >
          {data.owed > 0
            ? t("owed", { amount: eur(data.owed) })
            : data.credit > 0
              ? t("credit", { amount: eur(data.credit) })
              : t("even")}
        </p>
        {data.fromMonth && (
          <p className="text-sm text-muted-foreground">
            {t("summary", {
              month: monthName(data.fromMonth),
              expected: eur(data.expected),
              received: eur(data.received),
            })}
            {data.arrearsRepaid > 0 && <> {t("arrearsNote", { amount: eur(data.arrearsRepaid) })}</>}
          </p>
        )}
        {data.fromMonth && <p className="text-xs text-muted-foreground">{t("windowNote")}</p>}

        <div>
          <h3 className="text-sm font-semibold">{t("paymentsTitle")}</h3>
          {data.canEdit && <p className="text-xs text-muted-foreground">{t("explain")}</p>}
        </div>
        {data.paidRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{eur(row.amount)}</span>
                    <span className="text-muted-foreground">{formatDate(row.paidDate ?? row.dueDate)}</span>
                    {row.oddAmount && (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                        title={t("oddAmountHint")}
                      >
                        {t("oddAmount")}
                      </span>
                    )}
                    {row.credit && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        {t("creditBadge")}
                      </span>
                    )}
                    {row.arrears > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {t("arrearsBadge", { amount: eur(row.arrears) })}
                      </span>
                    )}
                  </div>
                  {data.canEdit && editing !== row.id && (
                    <Button variant="outline" size="sm" onClick={() => startEdit(row)}>
                      {row.arrears > 0 ? t("editArrears") : t("markArrears")}
                    </Button>
                  )}
                </div>
                {editing === row.id && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-xs text-muted-foreground">
                      {t("amountLabel")}
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max={row.amount}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        className="mt-1 w-32 rounded-md border px-2 py-1 text-sm text-foreground"
                      />
                    </label>
                    <Button size="sm" disabled={saving} onClick={() => save(row, Number(value.replace(",", ".")))}>
                      {t("save")}
                    </Button>
                    {row.arrears > 0 && (
                      <Button variant="outline" size="sm" disabled={saving} onClick={() => save(row, 0)}>
                        {t("removeMark")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(null)}>
                      {t("cancel")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.paidRows.length > SHOWN && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? t("showLess") : t("showAll", { count: data.paidRows.length })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
