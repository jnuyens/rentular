"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Users, Plus, Search, Mail, Phone, X } from "lucide-react";

export default function TenantsPage() {
  const t = useTranslations("tenants");
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState("");

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
          {t("addTenant")}
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-2.5 pl-10 pr-4 text-sm"
        />
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
        <Users className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
        <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {t("emptyDescription")}
        </p>
      </div>

      {/* Add tenant modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("addTenantTitle")}</h2>
              <button onClick={() => setShowAddModal(false)}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                // TODO: API call
                setShowAddModal(false);
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("firstName")}
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("lastName")}
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  <Mail className="mr-1 inline h-4 w-4" />
                  {t("email")}
                </label>
                <input
                  type="email"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  <Phone className="mr-1 inline h-4 w-4" />
                  {t("phone")}
                </label>
                <input
                  type="tel"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("language")}
                </label>
                <select className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm">
                  <option value="nl">{t("langNl")}</option>
                  <option value="fr">{t("langFr")}</option>
                  <option value="en">{t("langEn")}</option>
                  <option value="de">{t("langDe")}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("nationalRegister")}
                </label>
                <input
                  type="text"
                  placeholder={t("nationalRegisterPlaceholder")}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("iban")}
                </label>
                <input
                  type="text"
                  placeholder="BE68 5390 0754 7034"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("notes")}
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
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
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
                >
                  {t("saveTenant")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
