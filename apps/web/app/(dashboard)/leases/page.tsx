"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { FileText, Plus, Search, X, Users, UserPlus } from "lucide-react";

interface Property {
  id: string;
  name: string;
  city: string;
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string;
}

interface Lease {
  id: string;
  propertyId: string;
  type: string;
  region: string;
  status: string;
  startDate: string;
  endDate?: string;
  monthlyRent: string;
  monthlyCharges: string;
  tenantIds?: string[];
}

export default function LeasesPage() {
  const t = useTranslations("leases");
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
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

  const toggleTenant = (tenantId: string) => {
    setSelectedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const typeLabels: Record<string, string> = {
    residential_long: t("typeResidentialLong"),
    residential_short: t("typeResidentialShort"),
    residential_lifetime: t("typeLifetime"),
    student: t("typeStudent"),
    commercial: t("typeCommercial"),
  };

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    active: "bg-green-100 text-green-700",
    terminated: "bg-red-100 text-red-700",
    expired: "bg-yellow-100 text-yellow-700",
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
        <button
          onClick={() => { setShowAddModal(true); setError(""); setSelectedTenants([]); }}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t("addLease")}
        </button>
      </div>

      {/* Search and filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
        <select className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm">
          <option value="">{t("allStatuses")}</option>
          <option value="draft">{t("statusDraft")}</option>
          <option value="active">{t("statusActive")}</option>
          <option value="terminated">{t("statusTerminated")}</option>
          <option value="expired">{t("statusExpired")}</option>
        </select>
        <select className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm">
          <option value="">{t("allRegions")}</option>
          <option value="flanders">{t("regionFlanders")}</option>
          <option value="wallonia">{t("regionWallonia")}</option>
          <option value="brussels">{t("regionBrussels")}</option>
        </select>
      </div>

      {/* Lease list or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : leases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <FileText className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leases.map((lease) => {
            const prop = properties.find((p) => p.id === lease.propertyId);
            return (
              <div
                key={lease.id}
                className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{prop?.name || lease.propertyId}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[lease.status] || ""}`}>
                      {lease.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    {typeLabels[lease.type] || lease.type} &middot; {lease.startDate} - {lease.endDate || "..."}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">&euro;{lease.monthlyRent}/m</p>
                  {Number(lease.monthlyCharges) > 0 && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">+ &euro;{lease.monthlyCharges}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add lease modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("addLeaseTitle")}</h2>
              <button onClick={() => setShowAddModal(false)}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setError("");
                const form = e.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                try {
                  const res = await fetch(`${apiUrl}/api/v1/leases`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...data, tenantIds: selectedTenants }),
                    credentials: "include",
                  });
                  if (res.ok) {
                    const json = await res.json();
                    setLeases((prev) => [...prev, json.data]);
                    setShowAddModal(false);
                    form.reset();
                    setSelectedTenants([]);
                  } else {
                    const errJson = await res.json().catch(() => null);
                    setError(errJson?.error || `Error ${res.status}`);
                  }
                } catch {
                  setError(t("saveError"));
                } finally {
                  setSaving(false);
                }
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("property")}
                  </label>
                  <select
                    name="propertyId"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  >
                    <option value="">{t("selectProperty")}</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.city})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("leaseType")}
                  </label>
                  <select
                    name="leaseType"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  >
                    <option value="residential_long">{t("typeResidentialLong")}</option>
                    <option value="residential_short">{t("typeResidentialShort")}</option>
                    <option value="residential_lifetime">{t("typeLifetime")}</option>
                    <option value="student">{t("typeStudent")}</option>
                    <option value="commercial">{t("typeCommercial")}</option>
                  </select>
                </div>
              </div>

              {/* Tenant selection - supports multiple tenants (couples) */}
              <div>
                <label className="mb-2 block text-sm font-medium">
                  <Users className="mr-1 inline h-4 w-4" />
                  {t("tenants")}
                </label>
                {tenants.length === 0 ? (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("noTenantsYet")}</p>
                ) : (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
                    {tenants.map((tenant) => (
                      <label
                        key={tenant.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                          selectedTenants.includes(tenant.id)
                            ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]"
                            : "hover:bg-[hsl(var(--muted))]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTenants.includes(tenant.id)}
                          onChange={() => toggleTenant(tenant.id)}
                          className="rounded"
                        />
                        <span className="text-sm font-medium">
                          {tenant.firstName} {tenant.lastName}
                        </span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">{tenant.email}</span>
                      </label>
                    ))}
                  </div>
                )}
                {selectedTenants.length > 1 && (
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {t("coTenantsNote")}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("region")}
                </label>
                <select
                  name="region"
                  required
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                >
                  <option value="flanders">{t("regionFlanders")}</option>
                  <option value="wallonia">{t("regionWallonia")}</option>
                  <option value="brussels">{t("regionBrussels")}</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("signingDate")}
                  </label>
                  <input
                    name="signingDate"
                    type="date"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("startDate")}
                  </label>
                  <input
                    name="startDate"
                    type="date"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("endDate")}
                </label>
                <input
                  name="endDate"
                  type="date"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("monthlyRent")}
                  </label>
                  <input
                    name="monthlyRent"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("monthlyCharges")}
                  </label>
                  <input
                    name="monthlyCharges"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("bankAccount")}
                </label>
                <select name="bankAccountId" className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm">
                  <option value="">{t("selectBankAccount")}</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "..." : t("saveLease")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
