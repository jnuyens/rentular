"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dateLocale";

export interface ReauthConnection {
  id: string;
  institutionName: string | null;
  institutionId?: string | null;
  status: string;
  consentExpiresAt: string | null;
  needsRelogin?: boolean;
}

/** Days before expiry from which the banner shows. */
const BANNER_DAYS = 14;

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86_400_000);
}

/** Connections that need a re-login now or within 14 days. */
export function reauthCandidates(connections: ReauthConnection[]): Array<ReauthConnection & { expired: boolean }> {
  const out: Array<ReauthConnection & { expired: boolean }> = [];
  for (const c of connections) {
    if (c.status === "revoked" || c.status === "pending") continue;
    const days = daysUntil(c.consentExpiresAt);
    const expired = !!c.needsRelogin || c.status === "expired" || c.status === "error" || (days !== null && days < 0);
    if (expired || (days !== null && days <= BANNER_DAYS)) out.push({ ...c, expired });
  }
  return out;
}

/** Start a new bank login for a connection and go to the bank. */
export async function startRelogin(apiUrl: string, connectionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/bank-connections/${connectionId}/renew`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const link = (await res.json())?.data?.consentLink;
      if (link) {
        window.location.href = link;
        return true;
      }
    }
  } catch {
    // Reported by the caller.
  }
  return false;
}

/**
 * Banner for bank connections that expire within 14 days (amber) or have
 * expired (red), with a one-click re-login. Loads the connections itself
 * unless they are passed in.
 */
export function BankReauthBanner({ connections }: { connections?: ReauthConnection[] }) {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [loaded, setLoaded] = useState<ReauthConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections`, { credentials: "include" });
      if (res.ok) setLoaded((await res.json()).data || []);
    } catch {
      // No banner when the list cannot be loaded.
    }
  }, [apiUrl]);

  useEffect(() => {
    if (!connections) load();
  }, [connections, load]);

  const items = reauthCandidates(connections ?? loaded);
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((c) => {
        const bank = c.institutionName || c.institutionId || "";
        return (
          <div
            key={c.id}
            role="alert"
            className={
              c.expired
                ? "flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"
                : "flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            }
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              {c.expired
                ? t("relogin.bannerExpired", { bank })
                : t("relogin.bannerSoon", { bank, date: formatDate(c.consentExpiresAt) })}
            </p>
            <Button
              size="sm"
              variant={c.expired ? "destructive" : "default"}
              disabled={busy === c.id}
              onClick={async () => {
                setBusy(c.id);
                const ok = await startRelogin(apiUrl, c.id);
                if (!ok) {
                  toast.error(t("relogin.error"));
                  setBusy(null);
                }
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("relogin.button")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
