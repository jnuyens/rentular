"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { TrendingUp, Calculator, AlertTriangle, Check, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { epcBadgeClass } from "@/lib/epc";
import { formatDate } from "@/lib/dateLocale";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface Property {
  id: string;
  name: string;
  city: string;
  epcLabel?: string;
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
}

interface Lease {
  id: string;
  propertyId: string;
  tenantIds?: string[];
  type: string;
  region: string;
  status: string;
  startDate: string;
  monthlyRent: string;
  indexationEnabled?: boolean;
}

interface CalcResult {
  baseRent: number;
  baseIndex: number;
  currentIndex: number;
  newRent: number;
  unrestrictedNewRent: number;
  difference: number;
  effectiveDate: string;
  region: string;
  epcLabel?: string | null;
  epcRestricted?: boolean;
  correctionApplied?: boolean;
  formulaNote?: string;
  latestIndex: number;
  latestIndexMonth: string;
  newRentAtLatest: number;
  canApply: boolean;
  applicableFrom: string;
  nextAnniversary: string;
}

function getNextIndexationDate(startDate: string): Date {
  const start = new Date(startDate);
  const now = new Date();
  const anniversary = new Date(start);
  anniversary.setFullYear(now.getFullYear());
  if (anniversary <= now) {
    anniversary.setFullYear(now.getFullYear() + 1);
  }
  return anniversary;
}

function getLastIndexationDate(startDate: string): Date {
  const next = getNextIndexationDate(startDate);
  const last = new Date(next);
  last.setFullYear(last.getFullYear() - 1);
  return last;
}

// Whole calendar days between two dates, ignoring the time of day (so it doesn't
// shave a day off just because "now" is past midnight).
function wholeDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSinceLastIndexation(startDate: string): number {
  return wholeDaysBetween(getLastIndexationDate(startDate), new Date());
}

function daysUntilNextIndexation(startDate: string): number {
  return wholeDaysBetween(new Date(), getNextIndexationDate(startDate));
}

function getIndexationStatus(startDate: string): "overdue" | "due_soon" | "ok" {
  const daysUntil = daysUntilNextIndexation(startDate);
  const daysSince = daysSinceLastIndexation(startDate);
  if (daysSince > 365) return "overdue";
  if (daysUntil <= 30) return "due_soon";
  return "ok";
}

export default function IndexationPage() {
  const t = useTranslations("indexation");
  const tc = useTranslations("dashboard");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLease, setPreviewLease] = useState<Lease | null>(null);
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [raiseByLease, setRaiseByLease] = useState<
    Record<string, { canApply: boolean; raiseAmount: number }>
  >({});

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    try {
      const [leasesRes, propsRes, tenantsRes, raiseRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/indexation/raise-summary`, { credentials: "include" }),
      ]);
      if (leasesRes.ok) {
        const json = await leasesRes.json();
        setLeases(json.data || []);
      }
      if (propsRes.ok) {
        const json = await propsRes.json();
        setProperties(json.data || []);
      }
      if (tenantsRes.ok) {
        const json = await tenantsRes.json();
        setTenants(json.data || []);
      }
      if (raiseRes.ok) {
        const json = await raiseRes.json();
        const map: Record<string, { canApply: boolean; raiseAmount: number }> = {};
        for (const r of json.data || []) {
          map[r.leaseId] = { canApply: r.canApply, raiseAmount: r.raiseAmount };
        }
        setRaiseByLease(map);
      }
    } catch {
      toast.error(tc("toast.loadFailed") || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tc]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch the calculated (possible) rent whenever a lease preview is opened.
  useEffect(() => {
    if (!previewLease) {
      setCalc(null);
      setCalcError(null);
      return;
    }
    let cancelled = false;
    setCalc(null);
    setCalcError(null);
    setCalcLoading(true);
    fetch(`${apiUrl}/api/v1/indexation/calculate/${previewLease.id}`, {
      credentials: "include",
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setCalc(json as CalcResult);
        else setCalcError(json?.error || "Failed to calculate");
      })
      .catch(() => {
        if (!cancelled) setCalcError("Network error");
      })
      .finally(() => {
        if (!cancelled) setCalcLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewLease, apiUrl]);

  // Filter active leases with indexation enabled
  const activeLeases = leases.filter(
    (l) => l.status === "active" && l.indexationEnabled !== false
  );

  // Sort: most overdue first, then by next due date ascending
  const sortedLeases = [...activeLeases].sort((a, b) => {
    const statusA = getIndexationStatus(a.startDate);
    const statusB = getIndexationStatus(b.startDate);
    const order = { overdue: 0, due_soon: 1, ok: 2 };
    if (order[statusA] !== order[statusB]) return order[statusA] - order[statusB];
    return daysUntilNextIndexation(a.startDate) - daysUntilNextIndexation(b.startDate);
  });

  // Disabled indexation leases
  const disabledLeases = leases.filter(
    (l) => l.status === "active" && l.indexationEnabled === false
  );

  // Stats
  const overdueCount = activeLeases.filter((l) => getIndexationStatus(l.startDate) === "overdue").length;
  const dueSoonCount = activeLeases.filter((l) => getIndexationStatus(l.startDate) === "due_soon").length;
  const epcRestrictedCount = activeLeases.filter((l) => {
    const prop = properties.find((p) => p.id === l.propertyId);
    return prop?.epcLabel && ["E", "F", "G"].includes(prop.epcLabel) && ["flanders", "brussels"].includes(l.region);
  }).length;

  const getProp = (id: string) => properties.find((p) => p.id === id);
  const getTenantNames = (ids?: string[]) => {
    if (!ids || ids.length === 0) return "-";
    return ids
      .map((id) => {
        const tenant = tenants.find((tn) => tn.id === id);
        return tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      })
      .filter(Boolean)
      .join(", ") || "-";
  };

  const statusBadgeConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string; label: string }> = {
    overdue: { variant: "destructive", className: "", label: t("statusOverdue") },
    due_soon: { variant: "secondary", className: "bg-yellow-100 text-yellow-700 border-transparent", label: t("statusDueSoon") },
    ok: { variant: "default", className: "bg-green-100 text-green-700 border-transparent", label: t("statusOk") },
  };

  const handleApplyIndexation = async (leaseId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/indexation/${leaseId}/apply`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.updated") || "Indexation applied");
        setPreviewLease(null);
        fetchData();
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to apply indexation");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
  };

  // When indexation can't be applied yet (first year / less than a year since the
  // last one), show the rent at the LATEST published index -- how much it has
  // already risen -- instead of the anniversary figure.
  const shownNewRent = calc ? (calc.canApply ? calc.newRent : calc.newRentAtLatest) : 0;
  const shownIncrease =
    calc && previewLease ? shownNewRent - Number(previewLease.monthlyRent) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button>
          <Calculator className="mr-1 h-4 w-4" />
          {t("calculate")}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">{t("overdueIndexations")}</p>
            <p className={`mt-2 text-3xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>{overdueCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("leasesOverdue")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">{t("nextIndexation")}</p>
            <p className={`mt-2 text-3xl font-bold ${dueSoonCount > 0 ? "text-yellow-600" : ""}`}>{dueSoonCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("leasesUpcoming")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">{t("epcRestrictions")}</p>
            <p className="mt-2 text-3xl font-bold">{epcRestrictedCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("leasesRestricted")}</p>
          </CardContent>
        </Card>
      </div>

      {/* EPC warning */}
      {epcRestrictedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600" />
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              {t("epcWarningTitle")}
            </p>
            <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
              {t("epcWarningDescription")}
            </p>
          </div>
        </div>
      )}

      {/* Skeleton loading */}
      {loading && (
        <>
          <div className="hidden md:block">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
          <div className="md:hidden space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        </>
      )}

      {/* Lease list */}
      {!loading && sortedLeases.length === 0 && disabledLeases.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <TrendingUp className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("emptyDescription")}
          </p>
        </div>
      )}

      {!loading && (sortedLeases.length > 0 || disabledLeases.length > 0) && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase">{t("property") || "Property"}</TableHead>
                    <TableHead className="text-xs uppercase">{t("tenantLabel") || "Tenant"}</TableHead>
                    <TableHead className="text-right text-xs uppercase">{t("rent") || "Rent"}</TableHead>
                    <TableHead className="text-right text-xs uppercase">{t("raiseColumn")}</TableHead>
                    <TableHead className="text-xs uppercase">{t("nextDue")}</TableHead>
                    <TableHead className="text-xs uppercase">{t("statusLabel") || "Status"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedLeases.map((lease) => {
                    const prop = getProp(lease.propertyId);
                    const status = getIndexationStatus(lease.startDate);
                    const daysUntil = daysUntilNextIndexation(lease.startDate);
                    const nextDate = getNextIndexationDate(lease.startDate);
                    const epcRestricted = prop?.epcLabel && ["E", "F", "G"].includes(prop.epcLabel) && ["flanders", "brussels"].includes(lease.region);

                    return (
                      <TableRow
                        key={lease.id}
                        className={`cursor-pointer ${status === "overdue" ? "bg-red-50/30" : ""}`}
                        onClick={() => setPreviewLease(lease)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{prop?.name || lease.propertyId}</span>
                            {prop?.epcLabel && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${epcBadgeClass(prop.epcLabel)}${epcRestricted ? " ring-1 ring-orange-400" : ""}`}
                              >
                                EPC {prop.epcLabel}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{prop?.city || ""}</p>
                        </TableCell>
                        <TableCell className="text-sm">{getTenantNames(lease.tenantIds)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">&euro;{lease.monthlyRent}/m</TableCell>
                        <TableCell className="text-right text-sm">
                          {(() => {
                            const r = raiseByLease[lease.id];
                            if (!r || r.raiseAmount <= 0.005)
                              return <span className="text-muted-foreground">-</span>;
                            return (
                              <span
                                className={`font-medium ${r.canApply ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}
                                title={r.canApply ? undefined : t("raiseNotYet")}
                              >
                                +&euro;{r.raiseAmount.toFixed(2)}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>
                            <span>{formatDate(nextDate)}</span>
                            {status === "overdue" ? (
                              <p className="text-xs font-medium text-red-600">
                                {t("daysOverdue", { days: Math.abs(daysUntil) })}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {t("daysUntil", { days: daysUntil })}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusBadgeConfig[status]?.variant || "outline"}
                            className={statusBadgeConfig[status]?.className || ""}
                          >
                            {statusBadgeConfig[status]?.label || status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {disabledLeases.map((lease) => {
                    const prop = getProp(lease.propertyId);
                    return (
                      <TableRow key={lease.id} className="opacity-60">
                        <TableCell>
                          <span className="font-medium">{prop?.name || lease.propertyId}</span>
                        </TableCell>
                        <TableCell className="text-sm">{getTenantNames(lease.tenantIds)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">&euro;{lease.monthlyRent}/m</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">-</TableCell>
                        <TableCell className="text-sm">-</TableCell>
                        <TableCell>
                          <Badge variant="outline">{t("indexationOff")}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {sortedLeases.map((lease) => {
              const prop = getProp(lease.propertyId);
              const status = getIndexationStatus(lease.startDate);
              const daysUntil = daysUntilNextIndexation(lease.startDate);
              const nextDate = getNextIndexationDate(lease.startDate);
              const epcRestricted = prop?.epcLabel && ["E", "F", "G"].includes(prop.epcLabel) && ["flanders", "brussels"].includes(lease.region);

              return (
                <Card
                  key={lease.id}
                  className={`cursor-pointer ${status === "overdue" ? "border-red-300 bg-red-50/30" : ""}`}
                  onClick={() => setPreviewLease(lease)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{prop?.name || lease.propertyId}</h3>
                          <Badge
                            variant={statusBadgeConfig[status]?.variant || "outline"}
                            className={statusBadgeConfig[status]?.className || ""}
                          >
                            {statusBadgeConfig[status]?.label || status}
                          </Badge>
                          {prop?.epcLabel && (
                            <Badge
                              variant="outline"
                              className={`${epcBadgeClass(prop.epcLabel)}${epcRestricted ? " ring-1 ring-orange-400" : ""}`}
                            >
                              EPC {prop.epcLabel}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {getTenantNames(lease.tenantIds)} &middot; {prop?.city || ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">&euro;{lease.monthlyRent}/m</p>
                        {(() => {
                          const r = raiseByLease[lease.id];
                          if (!r || r.raiseAmount <= 0.005) return null;
                          return (
                            <p
                              className={`text-xs font-medium ${r.canApply ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}
                            >
                              {t("raiseColumn")}: +&euro;{r.raiseAmount.toFixed(2)}
                            </p>
                          );
                        })()}
                        <p className="text-xs text-muted-foreground">
                          {t("nextDue")}: {formatDate(nextDate)}
                        </p>
                        {status === "overdue" ? (
                          <p className="text-xs font-medium text-red-600">
                            {t("daysOverdue", { days: Math.abs(daysUntil) })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {t("daysUntil", { days: daysUntil })}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Disabled indexation leases */}
            {disabledLeases.length > 0 && (
              <>
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <XIcon className="h-4 w-4" />
                  <span>{t("indexationDisabled")} ({disabledLeases.length})</span>
                </div>
                {disabledLeases.map((lease) => {
                  const prop = getProp(lease.propertyId);
                  return (
                    <Card key={lease.id} className="opacity-60">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{prop?.name || lease.propertyId}</h3>
                              <Badge variant="outline">{t("indexationOff")}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {getTenantNames(lease.tenantIds)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">&euro;{lease.monthlyRent}/m</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {/* Indexation preview dialog */}
      <Dialog open={!!previewLease} onOpenChange={(open) => !open && setPreviewLease(null)}>
        {previewLease && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("previewTitle") || "Indexation Preview"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("property")}:</span>
                  <p className="font-medium">{getProp(previewLease.propertyId)?.name || previewLease.propertyId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("tenantLabel")}:</span>
                  <p className="font-medium">{getTenantNames(previewLease.tenantIds)}</p>
                </div>
              </div>

              {calcLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              )}

              {!calcLoading && calcError && (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">{t("calcErrorTitle")}</p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">{calcError}</p>
                    <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">{t("calcErrorHint")}</p>
                  </div>
                </div>
              )}

              {!calcLoading && calc && (
                <>
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("currentRent")}</p>
                        <p className="text-lg font-medium">&euro;{Number(previewLease.monthlyRent).toFixed(2)}</p>
                      </div>
                      <TrendingUp className="mb-1 h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {calc.canApply ? t("possibleRent") : t("risenSoFar")}
                        </p>
                        <p className="text-2xl font-bold text-green-700 dark:text-green-400">&euro;{shownNewRent.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                      <span className="text-muted-foreground">{t("increaseVsCurrent")}</span>
                      <span className={`font-medium ${shownIncrease > 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                        {shownIncrease >= 0 ? "+" : ""}
                        &euro;{shownIncrease.toFixed(2)}/m
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("effectiveDateLabel")}</span>
                      <span className="font-medium">{formatDate(calc.effectiveDate)}</span>
                    </div>
                    {!calc.canApply && (
                      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                        {t("notApplicableUntil", { date: formatDate(calc.applicableFrom) })}
                      </p>
                    )}
                    {(() => {
                      const days = wholeDaysBetween(
                        new Date(),
                        new Date(`${calc.nextAnniversary}T00:00:00`)
                      );
                      const forecast = calc.newRentAtLatest;
                      if (
                        days < 0 ||
                        days > 90 ||
                        forecast - Number(previewLease.monthlyRent) <= 0.005 ||
                        Math.abs(forecast - shownNewRent) <= 0.005
                      )
                        return null;
                      return (
                        <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
                          {t("anniversaryForecast", {
                            amount: `€${forecast.toFixed(2)}`,
                            date: formatDate(calc.nextAnniversary),
                            days,
                          })}
                        </p>
                      );
                    })()}
                  </div>

                  {["flanders", "brussels"].includes(calc.region) && !calc.epcLabel && (
                    <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
                      <div>
                        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t("epcNeededTitle")}</p>
                        <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">{t("epcNeededDesc")}</p>
                      </div>
                    </div>
                  )}

                  {calc.epcLabel && calc.epcRestricted && (
                    <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                      <div>
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                          {t("epcRestrictedTitle")} (EPC {calc.epcLabel})
                        </p>
                        <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">{t("epcRestrictedDesc")}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewLease(null)}>
                {t("cancel")}
              </Button>
              <Button
                onClick={() => handleApplyIndexation(previewLease.id)}
                disabled={!calc || calcLoading || (!!calc && !calc.canApply)}
              >
                {calc && calc.canApply
                  ? `${t("applyIndexation")} (€${calc.newRent.toFixed(2)})`
                  : t("applyIndexation")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
