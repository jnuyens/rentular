"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { TrendingUp, Calculator, AlertTriangle, Check, X as XIcon } from "lucide-react";

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

function daysSinceLastIndexation(startDate: string): number {
  const last = getLastIndexationDate(startDate);
  const now = new Date();
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntilNextIndexation(startDate: string): number {
  const next = getNextIndexationDate(startDate);
  const now = new Date();
  return Math.floor((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getIndexationStatus(startDate: string): "overdue" | "due_soon" | "ok" {
  const daysUntil = daysUntilNextIndexation(startDate);
  // If the anniversary date has passed and we haven't indexed yet this year
  const daysSince = daysSinceLastIndexation(startDate);
  if (daysSince > 365) return "overdue";
  if (daysUntil <= 30) return "due_soon";
  return "ok";
}

export default function IndexationPage() {
  const t = useTranslations("indexation");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    try {
      const [leasesRes, propsRes, tenantsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
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
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter active leases with indexation enabled
  const activeLeases = leases.filter(
    (l) => l.status === "active" && l.indexationEnabled !== false
  );

  // Sort: most overdue first (highest daysSinceLastIndexation), then by next due date ascending
  const sortedLeases = [...activeLeases].sort((a, b) => {
    const statusA = getIndexationStatus(a.startDate);
    const statusB = getIndexationStatus(b.startDate);
    const order = { overdue: 0, due_soon: 1, ok: 2 };
    if (order[statusA] !== order[statusB]) return order[statusA] - order[statusB];
    // Within same status, sort by days until next (ascending = soonest first)
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
        const tenant = tenants.find((t) => t.id === id);
        return tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      })
      .filter(Boolean)
      .join(", ") || "-";
  };

  const statusColors: Record<string, string> = {
    overdue: "bg-red-100 text-red-700",
    due_soon: "bg-yellow-100 text-yellow-700",
    ok: "bg-green-100 text-green-700",
  };

  const statusLabels: Record<string, string> = {
    overdue: t("statusOverdue"),
    due_soon: t("statusDueSoon"),
    ok: t("statusOk"),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {t("subtitle")}
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90">
          <Calculator className="h-4 w-4" />
          {t("calculate")}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("overdueIndexations")}
          </p>
          <p className={`mt-2 text-3xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>{overdueCount}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("leasesOverdue")}
          </p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("nextIndexation")}
          </p>
          <p className={`mt-2 text-3xl font-bold ${dueSoonCount > 0 ? "text-yellow-600" : ""}`}>{dueSoonCount}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("leasesUpcoming")}
          </p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("epcRestrictions")}
          </p>
          <p className="mt-2 text-3xl font-bold">{epcRestrictedCount}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("leasesRestricted")}
          </p>
        </div>
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

      {/* Lease list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : sortedLeases.length === 0 && disabledLeases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <TrendingUp className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedLeases.map((lease) => {
            const prop = getProp(lease.propertyId);
            const status = getIndexationStatus(lease.startDate);
            const daysUntil = daysUntilNextIndexation(lease.startDate);
            const nextDate = getNextIndexationDate(lease.startDate);
            const epcRestricted = prop?.epcLabel && ["E", "F", "G"].includes(prop.epcLabel) && ["flanders", "brussels"].includes(lease.region);

            return (
              <div
                key={lease.id}
                className={`rounded-xl border bg-[hsl(var(--background))] p-5 shadow-sm ${
                  status === "overdue" ? "border-red-300 bg-red-50/30" : "border-[hsl(var(--border))]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{prop?.name || lease.propertyId}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status] || ""}`}>
                        {statusLabels[status] || status}
                      </span>
                      {epcRestricted && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          EPC {prop?.epcLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      {getTenantNames(lease.tenantIds)} &middot; {prop?.city || ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">&euro;{lease.monthlyRent}/m</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {t("nextDue")}: {nextDate.toLocaleDateString()}
                    </p>
                    {status === "overdue" ? (
                      <p className="text-xs font-medium text-red-600">
                        {t("daysOverdue", { days: Math.abs(daysUntil) })}
                      </p>
                    ) : (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {t("daysUntil", { days: daysUntil })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Disabled indexation leases */}
          {disabledLeases.length > 0 && (
            <>
              <div className="mt-6 flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <XIcon className="h-4 w-4" />
                <span>{t("indexationDisabled")} ({disabledLeases.length})</span>
              </div>
              {disabledLeases.map((lease) => {
                const prop = getProp(lease.propertyId);
                return (
                  <div
                    key={lease.id}
                    className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 opacity-60"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{prop?.name || lease.propertyId}</h3>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                            {t("indexationOff")}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                          {getTenantNames(lease.tenantIds)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">&euro;{lease.monthlyRent}/m</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
