"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Plus, Search, X } from "lucide-react";

export default function LeasesPage() {
  const t = useTranslations("leases");
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

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
          onClick={() => setShowAddModal(true)}
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

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
        <FileText className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
        <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {t("emptyDescription")}
        </p>
      </div>

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
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                const form = e.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                try {
                  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
                  await fetch(`${apiUrl}/api/v1/leases`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                    credentials: "include",
                  });
                  setShowAddModal(false);
                  form.reset();
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
