"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
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
  institutionName: string | null;
  iban: string | null;
  status: string;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  externalAccountId: string | null;
}

function maskIban(iban: string | null): string {
  if (!iban) return "---";
  const trimmed = iban.replace(/\s+/g, "");
  if (trimmed.length <= 4) return trimmed;
  return `**** ${trimmed.slice(-4)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "---";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "---";
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const now = Date.now();
  return Math.round((target - now) / (24 * 60 * 60 * 1000));
}

function formatDate(iso: string | null): string {
  if (!iso) return "---";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "---";
  return d.toLocaleDateString();
}

export default function BankConnectionDetailPage() {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [conn, setConn] = useState<BankConnection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [renewing, setRenewing] = useState<boolean>(false);
  const [revoking, setRevoking] = useState<boolean>(false);

  const fetchConnection = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections/${id}`, {
        credentials: "include",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setConn(data.data || null);
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

  const consentDays = useMemo(
    () => (conn ? daysBetween(conn.consentExpiresAt) : null),
    [conn],
  );

  const showRenew = useMemo(() => {
    if (!conn) return false;
    if (conn.status === "expired") return true;
    if (consentDays === null) return false;
    return consentDays <= 7;
  }, [conn, consentDays]);

  const handleSync = async () => {
    if (!conn) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/${conn.id}/sync`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (res.status === 429) {
        toast.warning(
          t("toasts.syncRateLimited", {
            defaultMessage:
              "Sync is rate-limited. Please wait a minute and try again.",
          }),
        );
      } else if (res.ok) {
        toast.success(
          t("toasts.syncStarted", { defaultMessage: "Sync started" }),
        );
        fetchConnection();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(
          body.error ||
            t("toasts.syncFailed", { defaultMessage: "Sync failed" }),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleRenew = async () => {
    if (!conn) return;
    setRenewing(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/${conn.id}/renew`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Status ${res.status}`);
      }
      const body = await res.json();
      const consentLink: string | undefined = body?.data?.consentLink;
      if (!consentLink) {
        throw new Error("Provider did not return a consent link.");
      }
      window.location.href = consentLink;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setRenewing(false);
    }
  };

  const handleRevoke = async () => {
    if (!conn) return;
    setRevoking(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/${conn.id}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Status ${res.status}`);
      }
      toast.success(
        t("toasts.revokeSuccess", {
          defaultMessage: "Bank connection revoked",
        }),
      );
      router.push("/bank-connections");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setRevoking(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (notFound || !conn) {
    return (
      <div className="max-w-xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => router.push("/bank-connections")}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("backToList", { defaultMessage: "Back to bank connections" })}
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              {t("notFound", {
                defaultMessage: "Connection not found.",
              })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4"
        onClick={() => router.push("/bank-connections")}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {t("backToList", { defaultMessage: "Back to bank connections" })}
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {conn.institutionName || conn.institutionId}
          </h1>
          <BankConnectionStatusBadge status={conn.status} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("detail.connectionDetails", {
                defaultMessage: "Connection details",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.iban", { defaultMessage: "IBAN" })}
              </span>
              <span className="font-mono">{maskIban(conn.iban)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.institution", { defaultMessage: "Institution" })}
              </span>
              <span>{conn.institutionId}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.country", { defaultMessage: "Country" })}
              </span>
              <span>{conn.country || "BE"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.createdAt", { defaultMessage: "Connected on" })}
              </span>
              <span>{formatDate(conn.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("detail.syncStatus", { defaultMessage: "Sync status" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.lastSyncedAt", {
                  defaultMessage: "Last synced",
                })}
              </span>
              <span>{formatRelative(conn.lastSyncAt)}</span>
            </div>
            {conn.errorMessage && (
              <p className="text-xs text-destructive mt-2">
                {conn.errorMessage}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("detail.consent", { defaultMessage: "Consent" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {t("detail.expiresOn", { defaultMessage: "Expires on" })}
              </span>
              <span>{formatDate(conn.consentExpiresAt)}</span>
            </div>
            <div
              className={
                consentDays !== null && consentDays < 0
                  ? "text-destructive font-medium"
                  : ""
              }
            >
              {consentDays === null
                ? "---"
                : consentDays >= 0
                  ? t("detail.expiresInDays", {
                      defaultMessage: "Expires in {days} days",
                      days: consentDays,
                    })
                  : t("detail.expiredDaysAgo", {
                      defaultMessage: "Expired {days} days ago",
                      days: Math.abs(consentDays),
                    })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSync} disabled={syncing}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("actions.syncNow", { defaultMessage: "Sync now" })}
        </Button>
        {showRenew && (
          <Button
            variant="secondary"
            onClick={handleRenew}
            disabled={renewing}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("actions.renewConsent", {
              defaultMessage: "Renew consent",
            })}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={revoking}>
              <Trash2 className="h-4 w-4 mr-2" />
              {t("actions.revoke", { defaultMessage: "Revoke" })}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("dialogs.revokeTitle", {
                  defaultMessage: "Revoke bank connection?",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("dialogs.revokeBody", {
                  defaultMessage:
                    "Your historical bank statements will be retained for tax purposes (7 years).",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("dialogs.cancel", { defaultMessage: "Cancel" })}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevoke}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("dialogs.confirm", { defaultMessage: "Revoke" })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
