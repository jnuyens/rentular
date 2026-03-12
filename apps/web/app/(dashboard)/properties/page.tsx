"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, X, MapPin, Pencil, Trash2 } from "lucide-react";
import BelgianCityInput from "@/components/BelgianCityInput";
import CountrySelect from "@/components/CountrySelect";

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
  heatingType?: string;
  cadastralReference?: string;
  epcLabel?: string;
  epcScore?: string;
  epcCertificateNumber?: string;
  epcExpiryDate?: string;
  notes?: string;
}

export default function PropertiesPage() {
  const t = useTranslations("properties");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchProperties = useCallback(async () => {
    try {
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
  }, [apiUrl]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const openAdd = () => {
    setEditing(null);
    setError("");
    setShowModal(true);
  };

  const openEdit = (p: Property) => {
    setEditing(p);
    setError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setError("");
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/properties/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setProperties((prev) => prev.filter((p) => p.id !== id));
      }
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const url = editing
        ? `${apiUrl}/api/v1/properties/${editing.id}`
        : `${apiUrl}/api/v1/properties`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        if (editing) {
          setProperties((prev) => prev.map((p) => (p.id === editing.id ? json.data : p)));
        } else {
          setProperties((prev) => [...prev, json.data]);
        }
        closeModal();
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

  const heatingLabels: Record<string, string> = {
    gas: t("heatingGas"),
    oil: t("heatingOil"),
    electric: t("heatingElectric"),
    heat_pump: t("heatingHeatPump"),
    wood: t("heatingWood"),
    pellet: t("heatingPellet"),
    none: t("heatingNone"),
  };

  const ic = "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{t("subtitle")}</p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t("addProperty")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : properties.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <Building2 className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => (
            <div
              key={p.id}
              onClick={() => openEdit(p)}
              className="cursor-pointer rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-sm transition-all hover:shadow-md hover:border-[hsl(var(--primary))]/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="inline-block rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {typeLabels[p.type] || p.type}
                    </span>
                    {p.heatingType && p.heatingType !== "none" && (
                      <span className="inline-block rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                        {heatingLabels[p.heatingType] || p.heatingType}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {p.epcLabel && (
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                      ["A++", "A+", "A"].includes(p.epcLabel) ? "bg-green-100 text-green-700" :
                      ["B", "C"].includes(p.epcLabel) ? "bg-yellow-100 text-yellow-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      EPC {p.epcLabel}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                    className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                    disabled={deleting === p.id}
                    className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-start gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{p.street} {p.streetNumber}{p.box ? ` / ${p.box}` : ""}, {p.postalCode} {p.city}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit property modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editing ? t("editPropertyTitle") : t("addPropertyTitle")}
              </h2>
              <button onClick={closeModal}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit} key={editing?.id || "new"}>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("name")}</label>
                <input name="name" type="text" required defaultValue={editing?.name || ""} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("type")}</label>
                <select name="type" required defaultValue={editing?.type || "apartment"} className={ic}>
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
                  <label className="mb-1 block text-sm font-medium">{t("street")}</label>
                  <input name="street" type="text" required defaultValue={editing?.street || ""} className={ic} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">{t("streetNumber")}</label>
                    <input name="streetNumber" type="text" required defaultValue={editing?.streetNumber || ""} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">{t("box")}</label>
                    <input name="box" type="text" defaultValue={editing?.box || ""} className={ic} />
                  </div>
                </div>
              </div>

              <BelgianCityInput
                postalCodeLabel={t("postalCode")}
                cityLabel={t("city")}
                required
                postalCodeValue={editing?.postalCode}
                cityValue={editing?.city}
              />

              <div>
                <label className="mb-1 block text-sm font-medium">{t("country")}</label>
                <CountrySelect name="country" defaultValue={editing?.country || "BE"} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("cadastralReference")}</label>
                  <input name="cadastralReference" type="text" defaultValue={editing?.cadastralReference || ""} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("heatingType")}</label>
                  <select name="heatingType" defaultValue={editing?.heatingType || ""} className={ic}>
                    <option value="">{t("selectHeatingType")}</option>
                    <option value="gas">{t("heatingGas")}</option>
                    <option value="oil">{t("heatingOil")}</option>
                    <option value="electric">{t("heatingElectric")}</option>
                    <option value="heat_pump">{t("heatingHeatPump")}</option>
                    <option value="wood">{t("heatingWood")}</option>
                    <option value="pellet">{t("heatingPellet")}</option>
                    <option value="none">{t("heatingNone")}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("epcLabel")}</label>
                  <select name="epcLabel" defaultValue={editing?.epcLabel || ""} className={ic}>
                    <option value="">{t("selectEpcLabel")}</option>
                    {["A++", "A+", "A", "B", "C", "D", "E", "F", "G"].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("epcScore")}</label>
                  <input name="epcScore" type="text" placeholder="kWh/m²" defaultValue={editing?.epcScore || ""} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("epcCertificateNumber")}</label>
                  <input name="epcCertificateNumber" type="text" defaultValue={editing?.epcCertificateNumber || ""} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("epcExpiryDate")}</label>
                  <input name="epcExpiryDate" type="date" defaultValue={editing?.epcExpiryDate || ""} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("notes")}</label>
                <textarea name="notes" rows={3} defaultValue={editing?.notes || ""} className={ic} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50">
                  {saving ? "..." : editing ? t("updateProperty") : t("saveProperty")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
