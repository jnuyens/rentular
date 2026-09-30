"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote, Plus, ChevronRight } from "lucide-react";
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

interface BankConnectionRow {
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
}

function maskIban(iban: string | null): string {
  if (!iban) return "---";
  const trimmed = iban.replace(/\s+/g, "");
  if (trimmed.length <= 4) return trimmed;
  return `**** ${trimmed.slice(-4)}`;
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const now = Date.now();
  return Math.round((target - now) / (24 * 60 * 60 * 1000));
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

export default function BankConnectionsPage() {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const router = useRouter();

  const [connections, setConnections] = useState<BankConnectionRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("title", { defaultMessage: "Bank Connections" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", {
              defaultMessage:
                "Connect your bank account so Rentular can automatically import and match incoming rent transfers.",
            })}
          </p>
        </div>
        <Button asChild>
          <Link href="/bank-connections/connect">
            <Plus className="mr-2 h-4 w-4" />
            {t("connectBank", { defaultMessage: "Connect bank account" })}
          </Link>
        </Button>
      </div>

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

      {!loading && error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive text-center">
              {t("loadError", {
                defaultMessage:
                  "Unable to load bank connections. Please check your connection and try again.",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && connections.length === 0 && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center text-center">
            <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t("emptyTitle", { defaultMessage: "No bank connections yet" })}
            </h3>
            <p className="text-sm text-muted-foreground mb-3 max-w-md">
              {t("pricingDisclosure", {
                defaultMessage:
                  "Connecting a bank account costs up to €4 per account per month, billed directly to you by Ibanity. Rentular receives no portion of this fee.",
              })}
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              {t("tosNotice", {
                defaultMessage:
                  "By connecting a bank, you agree to a separate service agreement with Ibanity SA/NV. Rentular is not party to that agreement.",
              })}
            </p>
            <Link
              href="/terms"
              className="text-sm text-primary underline mb-6"
            >
              {t("viewTerms", { defaultMessage: "View Terms of Service" })}
            </Link>
            <Button asChild>
              <Link href="/bank-connections/connect">
                <Plus className="mr-2 h-4 w-4" />
                {t("connectBank", { defaultMessage: "Connect bank account" })}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && connections.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("table.bank", { defaultMessage: "Bank" })}
                  </TableHead>
                  <TableHead>
                    {t("table.iban", { defaultMessage: "IBAN" })}
                  </TableHead>
                  <TableHead className="w-[120px]">
                    {t("table.status", { defaultMessage: "Status" })}
                  </TableHead>
                  <TableHead className="w-[140px]">
                    {t("table.lastSync", { defaultMessage: "Last synced" })}
                  </TableHead>
                  <TableHead className="w-[160px]">
                    {t("table.expiresIn", { defaultMessage: "Consent expires" })}
                  </TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => {
                  const days = daysBetween(c.consentExpiresAt);
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() =>
                        router.push(`/bank-connections/${c.id}`)
                      }
                    >
                      <TableCell>
                        <p className="font-medium text-sm">
                          {c.institutionName || c.institutionId}
                        </p>
                        {c.errorMessage && (
                          <p className="text-xs text-destructive mt-1">
                            {c.errorMessage}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {maskIban(c.iban)}
                      </TableCell>
                      <TableCell>
                        <BankConnectionStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatRelative(c.lastSyncAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {days === null
                          ? "---"
                          : days >= 0
                            ? t("expiresIn", {
                                defaultMessage: "Expires in {days} days",
                                days,
                              })
                            : t("expiredDaysAgo", {
                                defaultMessage: "Expired {days} days ago",
                                days: Math.abs(days),
                              })}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden">
            {connections.map((c) => {
              const days = daysBetween(c.consentExpiresAt);
              return (
                <Card
                  key={c.id}
                  className="mb-3 cursor-pointer"
                  onClick={() => router.push(`/bank-connections/${c.id}`)}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">
                        {c.institutionName || c.institutionId}
                      </span>
                      <BankConnectionStatusBadge status={c.status} />
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {maskIban(c.iban)}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatRelative(c.lastSyncAt)}</span>
                      <span>
                        {days === null
                          ? ""
                          : days >= 0
                            ? t("expiresIn", {
                                defaultMessage: "Expires in {days} days",
                                days,
                              })
                            : t("expiredDaysAgo", {
                                defaultMessage: "Expired {days} days ago",
                                days: Math.abs(days),
                              })}
                      </span>
                    </div>
                    {c.errorMessage && (
                      <p className="text-xs text-destructive mt-2">
                        {c.errorMessage}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
