"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BankConnectionStatusBadge } from "@/components/BankConnectionStatusBadge";

interface BankConnection {
  id: string;
  provider: string;
  institutionId: string;
  institutionName: string;
  iban: string | null;
  status: string;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
  country: string | null;
  createdAt: string | null;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "---";
  try {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function BankConnectionDetailPage() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [connection, setConnection] = useState<BankConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchConnection = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections/${id}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setConnection(data.data);
      } else if (res.status === 404) {
        setNotFound(true);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, id]);

  useEffect(() => {
    fetchConnection();
  }, [fetchConnection]);

  const handleSync = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/${id}/sync`,
        { method: "POST", credentials: "include" }
      );
      if (res.ok) {
        toast.success(t("toasts.syncStarted"));
        fetchConnection();
      } else if (res.status === 429) {
        toast.error(t("toasts.syncRateLimited"));
      } else {
        toast.error(t("toasts.syncError"));
      }
    } catch {
      toast.error(t("toasts.syncError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRenew = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/${id}/renew`,
        { method: "POST", credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        const consentLink = data?.data?.consentLink;
        if (consentLink) {
          window.location.href = consentLink;
          return;
        }
      }
      toast.error(t("toasts.renewError"));
    } catch {
      toast.error(t("toasts.renewError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(t("toasts.revokeSuccess"));
        router.push("/dashboard/bank-connections");
        return;
      }
      toast.error(t("toasts.syncError"));
    } catch {
      toast.error(t("toasts.syncError"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (notFound || !connection) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/bank-connections">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </div>
    );
  }

  const expiryDays = daysUntil(connection.consentExpiresAt);
  const showRenew =
    connection.status === "expired" ||
    (expiryDays !== null && expiryDays <= 7);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button asChild variant="ghost" size="icon">
          <Link href="/dashboard/bank-connections">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{connection.institutionName}</h1>
        <BankConnectionStatusBadge status={connection.status} />
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("detail.connectionDetails")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("detail.iban")}</span>
              <span className="font-mono">{connection.iban || "---"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("detail.institutionId")}
              </span>
              <span className="font-mono">{connection.institutionId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("detail.country")}
              </span>
              <span>{connection.country || "---"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("detail.createdAt")}
              </span>
              <span>{fmtDate(connection.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("detail.syncStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {connection.lastSyncAt
                ? t("detail.lastSyncedAt", {
                    time: fmtDate(connection.lastSyncAt),
                  })
                : t("detail.neverSynced")}
            </p>
            {connection.errorMessage && (
              <p className="text-destructive">
                {t("detail.errorLabel")}: {connection.errorMessage}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("detail.consent")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {expiryDays === null ? (
              <span>---</span>
            ) : expiryDays >= 0 ? (
              <span>{t("detail.expiresInDays", { days: expiryDays })}</span>
            ) : (
              <span className="text-destructive">
                {t("detail.expiredDaysAgo", { days: Math.abs(expiryDays) })}
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSync} disabled={busy}>
          {t("actions.syncNow")}
        </Button>
        {showRenew && (
          <Button variant="secondary" onClick={handleRenew} disabled={busy}>
            {t("actions.renewConsent")}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={busy}
              className="text-destructive hover:text-destructive"
            >
              {t("actions.revoke")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("dialogs.revokeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("dialogs.revokeBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("dialogs.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevoke}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("dialogs.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
