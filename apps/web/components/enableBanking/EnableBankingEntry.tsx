"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Landmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardUser } from "@/components/DashboardUserContext";

const WIZARD_PATH = "/bank-connections/enable-banking";

function dismissKey(userId: string | null): string {
  return `rentular.ebBanner.dismissed.${userId || "anon"}`;
}

function isDismissed(userId: string | null): boolean {
  try {
    return window.localStorage.getItem(dismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(userId: string | null): void {
  try {
    window.localStorage.setItem(dismissKey(userId), "1");
  } catch {
    // Storage blocked: the banner just comes back on the next visit.
  }
}

/**
 * True when this landlord may use Enable Banking (free plan or self-hosted)
 * and has no bank connection yet. Pass the connections when the page already
 * loaded them.
 */
function useShowEntry(connectionCount?: number): boolean {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [offered, setOffered] = useState(false);
  const [count, setCount] = useState<number | null>(connectionCount ?? null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/bank-connections/options`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled) setOffered(Array.isArray(b?.data?.providers) && b.data.providers.includes("enable_banking"));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  useEffect(() => {
    if (connectionCount !== undefined) {
      setCount(connectionCount);
      return;
    }
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/bank-connections`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled || !b) return;
        const list: Array<{ status: string }> = b.data || [];
        setCount(list.filter((c) => c.status !== "revoked").length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl, connectionCount]);

  return offered && count === 0;
}

/** Card on the bank connections page that opens the step by step setup. */
export function EnableBankingEntryCard({ connectionCount }: { connectionCount: number }) {
  const t = useTranslations("ebWizard");
  const show = useShowEntry(connectionCount);
  if (!show) return null;
  return (
    <div className="mb-4 flex flex-col gap-4 rounded-xl border border-green-300 bg-green-50 p-5 sm:flex-row sm:items-center">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100">
        <Landmark className="h-5 w-5 text-green-700" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-green-900">{t("entry.title")}</p>
        <p className="text-sm text-green-900/80">{t("entry.body")}</p>
      </div>
      <Button asChild>
        <Link href={WIZARD_PATH}>{t("entry.cta")}</Link>
      </Button>
    </div>
  );
}

/** Small dismissible banner on the overview for landlords without a bank connection. */
export function EnableBankingEntryBanner() {
  const t = useTranslations("ebWizard");
  const { userId } = useDashboardUser();
  const show = useShowEntry();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(isDismissed(userId));
  }, [userId]);

  if (!show || dismissed) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
      <Landmark className="h-4 w-4 shrink-0" />
      <Link href={WIZARD_PATH} className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline">
        {t("entry.title")}
      </Link>
      <button
        type="button"
        onClick={() => {
          rememberDismissed(userId);
          setDismissed(true);
        }}
        aria-label={t("entry.dismiss")}
        title={t("entry.dismiss")}
        className="rounded p-1 hover:bg-green-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
