"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, MapPin, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import BelgianCityInput from "@/components/BelgianCityInput";
import CountrySelect from "@/components/CountrySelect";
import RoleBadge from "@/components/RoleBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  userRole?: string;
}

export default function PropertiesPage() {
  const t = useTranslations("properties");
  const td = useTranslations("dashboard");
  const tt = useTranslations("toast");
  const tm = useTranslations("managers");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
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
      } else {
        toast.error(tt("loadFailed"));
      }
    } catch {
      toast.error(tt("networkError"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tt]);

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
    setDeleteTarget(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/properties/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setProperties((prev) => prev.filter((p) => p.id !== id));
        toast.success(tt("deleted"));
      } else {
        toast.error(tt("deleteFailed"));
      }
    } catch {
      toast.error(tt("deleteFailed"));
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
          toast.success(tt("updated"));
        } else {
          setProperties((prev) => [...prev, json.data]);
          toast.success(tt("created"));
        }
        closeModal();
      } else {
        const errJson = await res.json().catch(() => null);
        setError(errJson?.error || `Error ${res.status}`);
        toast.error(tt("saveFailed"));
      }
    } catch {
      setError(t("saveError"));
      toast.error(tt("saveFailed"));
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

  const ic = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {t("addProperty")}
        </Button>
      </div>

      {/* Loading skeletons */}
      {loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>EPC</TableHead>
                  <TableHead>{t("city")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-[180px]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-[80px] rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-[60px] rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden grid gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5 space-y-3">
                  <Skeleton className="h-5 w-[180px]" />
                  <div className="flex gap-2">
                    <Skeleton className="h-4 w-[80px]" />
                    <Skeleton className="h-4 w-[60px]" />
                  </div>
                  <Skeleton className="h-4 w-[220px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : properties.length === 0 ? (
        <Card className="p-8 text-center">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-semibold">{td("emptyPropertiesTitle")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{td("emptyPropertiesDesc")}</p>
          <Button className="mt-4" onClick={openAdd}>
            {td("addFirstProperty")}
          </Button>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>EPC</TableHead>
                  <TableHead>{t("city")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => openEdit(p)}
                  >
                    <TableCell>
                      <div>
                        <span className="font-medium">{p.name}</span>
                        {p.userRole && <span className="ml-2"><RoleBadge role={p.userRole} /></span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{typeLabels[p.type] || p.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.epcLabel ? (
                        <Badge
                          variant="outline"
                          className={
                            ["A++", "A+", "A"].includes(p.epcLabel) ? "bg-green-100 text-green-700 border-green-200" :
                            ["B", "C"].includes(p.epcLabel) ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                            "bg-red-100 text-red-700 border-red-200"
                          }
                        >
                          {p.epcLabel}
                        </Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>{p.street} {p.streetNumber}, {p.postalCode} {p.city}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(!p.userRole || ["owner", "co_owner", "manager"].includes(p.userRole)) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {(!p.userRole || ["owner", "co_owner"].includes(p.userRole)) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
                            disabled={deleting === p.id}
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {properties.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                onClick={() => openEdit(p)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium text-sm">{p.name}</span>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{typeLabels[p.type] || p.type}</Badge>
                        {p.heatingType && p.heatingType !== "none" && (
                          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                            {heatingLabels[p.heatingType] || p.heatingType}
                          </Badge>
                        )}
                        {p.userRole && <RoleBadge role={p.userRole} />}
                      </div>
                    </div>
                    {p.epcLabel && (
                      <Badge
                        variant="outline"
                        className={
                          ["A++", "A+", "A"].includes(p.epcLabel) ? "bg-green-100 text-green-700 border-green-200" :
                          ["B", "C"].includes(p.epcLabel) ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                          "bg-red-100 text-red-700 border-red-200"
                        }
                      >
                        EPC {p.epcLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{p.street} {p.streetNumber}{p.box ? ` / ${p.box}` : ""}, {p.postalCode} {p.city}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {(!p.userRole || ["owner", "co_owner", "manager"].includes(p.userRole)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {(!p.userRole || ["owner", "co_owner"].includes(p.userRole)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
                        disabled={deleting === p.id}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {(p.userRole === "owner" || p.userRole === "co_owner") && (
                      <a
                        href={`/properties/${p.id}/managers`}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto text-xs text-primary hover:underline self-center"
                      >
                        {tm("title")}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Delete confirmation AlertDialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{td("delete")}</AlertDialogTitle>
            <AlertDialogDescription>{td("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{td("keepItem")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              {td("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add/Edit property Dialog */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editPropertyTitle") : t("addPropertyTitle")}
            </DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
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
                <input name="epcScore" type="text" placeholder="kWh/m2" defaultValue={editing?.epcScore || ""} className={ic} />
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "..." : editing ? t("updateProperty") : t("saveProperty")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
