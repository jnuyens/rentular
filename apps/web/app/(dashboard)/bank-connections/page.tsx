"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Banknote, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BankConnectionStatusBadge } from "@/components/BankConnectionStatusBadge";

interface BankConnection {
  id: string;
  provider: string;
  institutionName: string;
  iban: string | null;
  status: string;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
}

function maskIban(iban: string | null): string {
  if (!iban) return "---";
  const last4 = iban.slice(-4);
  return `•••• ${last4}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / (24 * 60 * 60 * 1000));
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

export default function BankConnectionsPage() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setConnections(data.data || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  function expiryLabel(c: BankConnection): string {
    const days = daysUntil(c.consentExpiresAt);
    if (days === null) return "---";
    return t("expiresIn", { days });
  }

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button asChild>
          <Link href="/bank-connections/connect">
            <Plus className="mr-2 h-4 w-4" />
            {t("connectBank")}
          </Link>
        </Button>
      </div>

      {/* Loading State */}
      {loading && (
        <>
          <div className="hidden md:block space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          <div className="md:hidden space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive text-center">
              {t("loadError")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && connections.length === 0 && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center text-center">
            <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground mb-3 max-w-md">
              {t("pricingDisclosure")}
            </p>
            <p className="text-sm text-muted-foreground mb-3 max-w-md">
              {t("tosNotice")}
            </p>
            <Link
              href="/terms"
              className="text-sm text-primary underline underline-offset-4 mb-4"
            >
              {t("viewTerms")}
            </Link>
            <Button asChild>
              <Link href="/bank-connections/connect">
                <Plus className="mr-2 h-4 w-4" />
                {t("connectBank")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Data Table / Cards */}
      {!loading && !error && connections.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("institution")}</TableHead>
                  <TableHead>{t("account")}</TableHead>
                  <TableHead className="w-[100px]">{t("statusLabel")}</TableHead>
                  <TableHead className="w-[120px]">{t("lastSync")}</TableHead>
                  <TableHead className="w-[140px]">{t("expiry")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/bank-connections/${c.id}`)
                    }
                  >
                    <TableCell>
                      <p className="font-medium text-sm">{c.institutionName}</p>
                      {c.errorMessage && (
                        <p className="text-xs text-destructive">
                          {c.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {maskIban(c.iban)}
                    </TableCell>
                    <TableCell>
                      <BankConnectionStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.lastSyncAt
                        ? relativeTime(c.lastSyncAt)
                        : t("neverSynced")}
                    </TableCell>
                    <TableCell className="text-sm">{expiryLabel(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden">
            {connections.map((c) => (
              <Card
                key={c.id}
                className="mb-3 cursor-pointer"
                onClick={() =>
                  router.push(`/bank-connections/${c.id}`)
                }
              >
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">
                      {c.institutionName}
                    </span>
                    <BankConnectionStatusBadge status={c.status} />
                  </div>
                  <p className="text-sm font-mono text-muted-foreground mb-2">
                    {maskIban(c.iban)}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {c.lastSyncAt
                        ? relativeTime(c.lastSyncAt)
                        : t("neverSynced")}
                    </span>
                    <span>{expiryLabel(c)}</span>
                  </div>
                  {c.errorMessage && (
                    <p className="text-xs text-destructive mt-1">
                      {c.errorMessage}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
