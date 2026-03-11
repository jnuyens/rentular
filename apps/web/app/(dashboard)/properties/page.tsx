"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, X, MapPin, Trash2 } from "lucide-react";
import BelgianCityInput from "@/components/BelgianCityInput";

interface Property {
  id: string;
  name: string;
  type: string;
  street: string;
  streetNumber: string;
  box?: string;
  postalCode: string;
  city: string;
  country: string;
  epcLabel?: string;
  epcScore?: string;
}

export default function PropertiesPage() {
  const t = useTranslations("properties");
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProperties = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setProperties(json.data || []);
      }
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/v1/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setProperties((prev) => [...prev, json.data]);
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
  };

  const typeLabels: Record<string, string> = {
    apartment: t("typeApartment"),
    house: t("typeHouse"),
    studio: t("typeStudio"),
    commercial: t("typeCommercial"),
    garage: t("typeGarage"),
    other: t("typeOther"),
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
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t("addProperty")}
        </button>
      </div>

      {/* Property list or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : properties.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <Building2 className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <span className="mt-0.5 inline-block rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {typeLabels[p.type] || p.type}
                  </span>
                </div>
                {p.epcLabel && (
                  <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                    ["A++", "A+", "A"].includes(p.epcLabel) ? "bg-green-100 text-green-700" :
                    ["B", "C"].includes(p.epcLabel) ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    EPC {p.epcLabel}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-start gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {p.street} {p.streetNumber}{p.box ? ` / ${p.box}` : ""}, {p.postalCode} {p.city}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add property modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("addPropertyTitle")}</h2>
              <button onClick={() => { setShowAddModal(false); setError(""); }}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("name")}
                </label>
                <input
                  name="name"
                  type="text"
                  required
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("type")}
                </label>
                <select
                  name="type"
                  required
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                >
                  <option value="apartment">{t("typeApartment")}</option>
                  <option value="house">{t("typeHouse")}</option>
                  <option value="studio">{t("typeStudio")}</option>
                  <option value="commercial">{t("typeCommercial")}</option>
                  <option value="garage">{t("typeGarage")}</option>
                  <option value="other">{t("typeOther")}</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("street")}
                  </label>
                  <input
                    name="street"
                    type="text"
                    required
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("streetNumber")}
                    </label>
                    <input
                      name="streetNumber"
                      type="text"
                      required
                      className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("box")}
                    </label>
                    <input
                      name="box"
                      type="text"
                      className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Belgian city autocomplete */}
              <BelgianCityInput
                postalCodeLabel={t("postalCode")}
                cityLabel={t("city")}
                required
              />

              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("country")}
                </label>
                <input
                  name="country"
                  type="text"
                  defaultValue="BE"
                  maxLength={2}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("cadastralReference")}
                </label>
                <input
                  name="cadastralReference"
                  type="text"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("epcLabel")}
                  </label>
                  <select
                    name="epcLabel"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  >
                    <option value="">{t("selectEpcLabel")}</option>
                    <option value="A++">A++</option>
                    <option value="A+">A+</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                    <option value="E">E</option>
                    <option value="F">F</option>
                    <option value="G">G</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("epcScore")}
                  </label>
                  <input
                    name="epcScore"
                    type="text"
                    placeholder="kWh/m²"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("epcCertificateNumber")}
                  </label>
                  <input
                    name="epcCertificateNumber"
                    type="text"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("epcExpiryDate")}
                  </label>
                  <input
                    name="epcExpiryDate"
                    type="date"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
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
                  onClick={() => { setShowAddModal(false); setError(""); }}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "..." : t("saveProperty")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
