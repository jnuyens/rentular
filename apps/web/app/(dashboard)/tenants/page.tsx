"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Users, Plus, Search, Mail, Phone, X, UserPlus } from "lucide-react";
import PhoneInput from "@/components/PhoneInput";

// Avatar options: diverse set of people + abstract icons
const AVATARS = [
  // Young
  { id: "ym1", label: "Young man", svg: "👨" },
  { id: "yw1", label: "Young woman", svg: "👩" },
  { id: "ym2", label: "Young man (dark)", svg: "👨🏾" },
  { id: "yw2", label: "Young woman (dark)", svg: "👩🏾" },
  { id: "ym3", label: "Young man (Asian)", svg: "👨🏻" },
  { id: "yw3", label: "Young woman (Asian)", svg: "👩🏻" },
  // Middle-aged
  { id: "mm1", label: "Man", svg: "🧔" },
  { id: "mw1", label: "Woman", svg: "👩‍🦰" },
  { id: "mm2", label: "Man (dark)", svg: "🧔🏾" },
  { id: "mw2", label: "Woman (dark)", svg: "👩🏾‍🦱" },
  { id: "mm3", label: "Man (olive)", svg: "🧔🏽" },
  { id: "mw3", label: "Woman (olive)", svg: "👩🏽" },
  // Older
  { id: "om1", label: "Older man", svg: "👴" },
  { id: "ow1", label: "Older woman", svg: "👵" },
  { id: "om2", label: "Older man (dark)", svg: "👴🏾" },
  { id: "ow2", label: "Older woman (dark)", svg: "👵🏾" },
  // Abstract
  { id: "abs1", label: "Person", svg: "🧑" },
  { id: "abs2", label: "Person (dark)", svg: "🧑🏾" },
  { id: "abs3", label: "Silhouette", svg: "👤" },
  { id: "abs4", label: "People", svg: "👥" },
];

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  language: string;
  avatar?: string;
  nationalRegister?: string;
  bankAccount?: string;
  notes?: string;
}

export default function TenantsPage() {
  const t = useTranslations("tenants");
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAvatar, setSelectedAvatar] = useState("abs1");

  const fetchTenants = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setTenants(json.data || []);
      }
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const filteredTenants = tenants.filter((t) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.firstName.toLowerCase().includes(s) ||
      t.lastName.toLowerCase().includes(s) ||
      t.email?.toLowerCase().includes(s) ||
      t.phone?.includes(s)
    );
  });

  const getAvatar = (avatarId?: string) => {
    const av = AVATARS.find((a) => a.id === avatarId);
    return av?.svg || "🧑";
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
          onClick={() => { setShowAddModal(true); setError(""); setSelectedAvatar("abs1"); }}
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

      {/* Tenant list or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : filteredTenants.length === 0 && !search ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <Users className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
        </div>
      ) : filteredTenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-12">
          <Search className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{t("noResults")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTenants.map((tenant) => (
            <div
              key={tenant.id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-xl">
                  {getAvatar(tenant.avatar)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{tenant.firstName} {tenant.lastName}</h3>
                  <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="uppercase">{tenant.language}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                {tenant.email && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tenant.email}</span>
                  </div>
                )}
                {tenant.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span>{tenant.phone}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add tenant modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("addTenantTitle")}</h2>
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
                const formData = new FormData(form);
                formData.set("avatar", selectedAvatar);
                const data = Object.fromEntries(formData);
                try {
                  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
                  const res = await fetch(`${apiUrl}/api/v1/tenants`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                    credentials: "include",
                  });
                  if (res.ok) {
                    const json = await res.json();
                    setTenants((prev) => [...prev, json.data]);
                    setShowAddModal(false);
                    form.reset();
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
              {/* Avatar selection */}
              <div>
                <label className="mb-2 block text-sm font-medium">Avatar</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setSelectedAvatar(av.id)}
                      title={av.label}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition-all ${
                        selectedAvatar === av.id
                          ? "ring-2 ring-[hsl(var(--primary))] ring-offset-2 bg-[hsl(var(--muted))]"
                          : "hover:bg-[hsl(var(--muted))]"
                      }`}
                    >
                      {av.svg}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("firstName")}
                  </label>
                  <input
                    name="firstName"
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
                    name="lastName"
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
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  <Phone className="mr-1 inline h-4 w-4" />
                  {t("phone")}
                </label>
                <PhoneInput name="phone" defaultCountry="BE" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("language")}
                </label>
                <select name="language" className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm">
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
                  name="nationalRegister"
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
                  name="bankAccount"
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
                  name="notes"
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
                  disabled={saving}
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "..." : t("saveTenant")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
