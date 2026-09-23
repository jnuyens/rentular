"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BankTransactionsTable,
  type BankTransaction,
} from "@/components/BankTransactionsTable";

type StatusFilter = "all" | "unmatched" | "matched" | "ignored";

const FILTERS: StatusFilter[] = ["all", "unmatched", "matched", "ignored"];

export default function ReconciliationPage() {
  const t = useTranslations("reconciliation");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [status, setStatus] = useState<StatusFilter>("all");
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rematching, setRematching] = useState(false);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-transactions?status=${status}`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.data || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, status]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleRematch = useCallback(async () => {
    setRematching(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-transactions/rematch`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        const count = json.data?.assigned ?? 0;
        toast.success(count > 0 ? t("rematchDone", { count }) : t("rematchNone"));
        if (count > 0) await fetchTransactions();
      } else {
        toast.error(t("loadError"));
      }
    } catch {
      toast.error(t("loadError"));
    } finally {
      setRematching(false);
    }
  }, [apiUrl, t, fetchTransactions]);

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRematch}
          disabled={rematching}
        >
          <RefreshCw
            className={`mr-1.5 h-4 w-4 ${rematching ? "animate-spin" : ""}`}
          />
          {t("rematch")}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatus(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              status === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive text-center">
              {t("loadError")}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && (
        <Card>
          <CardContent className="pt-6">
            <BankTransactionsTable
              transactions={transactions}
              mode="global"
              onRefetch={fetchTransactions}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
