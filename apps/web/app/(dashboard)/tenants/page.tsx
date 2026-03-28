"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Users, Plus, Search, Mail, Phone, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PhoneInput from "@/components/PhoneInput";
import IbanInput from "@/components/IbanInput";
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

// Avatar options: diverse set of people + abstract icons
const AVATARS = [
  { id: "ym1", label: "Young man", svg: "\u{1F468}" },
  { id: "yw1", label: "Young woman", svg: "\u{1F469}" },
  { id: "ym2", label: "Young man (dark)", svg: "\u{1F468}\u{1F3FE}" },
  { id: "yw2", label: "Young woman (dark)", svg: "\u{1F469}\u{1F3FE}" },
  { id: "ym3", label: "Young man (Asian)", svg: "\u{1F468}\u{1F3FB}" },
  { id: "yw3", label: "Young woman (Asian)", svg: "\u{1F469}\u{1F3FB}" },
  { id: "mm1", label: "Man", svg: "\u{1F9D4}" },
  { id: "mw1", label: "Woman", svg: "\u{1F469}\u{200D}\u{1F9B0}" },
  { id: "mm2", label: "Man (dark)", svg: "\u{1F9D4}\u{1F3FE}" },
  { id: "mw2", label: "Woman (dark)", svg: "\u{1F469}\u{1F3FE}\u{200D}\u{1F9B1}" },
  { id: "mm3", label: "Man (olive)", svg: "\u{1F9D4}\u{1F3FD}" },
  { id: "mw3", label: "Woman (olive)", svg: "\u{1F469}\u{1F3FD}" },
  { id: "om1", label: "Older man", svg: "\u{1F474}" },
  { id: "ow1", label: "Older woman", svg: "\u{1F475}" },
  { id: "om2", label: "Older man (dark)", svg: "\u{1F474}\u{1F3FE}" },
  { id: "ow2", label: "Older woman (dark)", svg: "\u{1F475}\u{1F3FE}" },
  { id: "abs1", label: "Person", svg: "\u{1F9D1}" },
  { id: "abs2", label: "Person (dark)", svg: "\u{1F9D1}\u{1F3FE}" },
  { id: "abs3", label: "Silhouette", svg: "\u{1F464}" },
  { id: "abs4", label: "People", svg: "\u{1F465}" },
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
  const td = useTranslations("dashboard");
  const tt = useTranslations("toast");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAvatar, setSelectedAvatar] = useState("abs1");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setTenants(json.data || []);
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
    fetchTenants();
  }, [fetchTenants]);

  const openAdd = () => {
    setEditing(null);
    setSelectedAvatar("abs1");
    setError("");
    setShowModal(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditing(tenant);
    setSelectedAvatar(tenant.avatar || "abs1");
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
      const res = await fetch(`${apiUrl}/api/v1/tenants/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setTenants((prev) => prev.filter((t) => t.id !== id));
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
    const formData = new FormData(form);
    formData.set("avatar", selectedAvatar);
    const data = Object.fromEntries(formData);
    try {
      const url = editing
        ? `${apiUrl}/api/v1/tenants/${editing.id}`
        : `${apiUrl}/api/v1/tenants`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        if (editing) {
          setTenants((prev) => prev.map((t) => (t.id === editing.id ? json.data : t)));
          toast.success(tt("updated"));
        } else {
          setTenants((prev) => [...prev, json.data]);
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

  const filteredTenants = tenants.filter((tenant) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      tenant.firstName.toLowerCase().includes(s) ||
      tenant.lastName.toLowerCase().includes(s) ||
      tenant.email?.toLowerCase().includes(s) ||
      tenant.phone?.includes(s)
    );
  });

  const getAvatar = (avatarId?: string) => {
    const av = AVATARS.find((a) => a.id === avatarId);
    return av?.svg || "\u{1F9D1}";
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
          {t("addTenant")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-4 text-sm"
        />
      </div>

      {/* Loading skeletons */}
      {loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>{t("firstName")}</TableHead>
                  <TableHead>{t("lastName")}</TableHead>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("phone")}</TableHead>
                  <TableHead>{t("language")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[180px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[40px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-[150px]" />
                      <Skeleton className="h-3 w-[100px]" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-[200px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : filteredTenants.length === 0 && !search ? (
        <Card className="p-8 text-center">
          <Users className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-semibold">{td("emptyTenantsTitle")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{td("emptyTenantsDesc")}</p>
          <Button className="mt-4" onClick={openAdd}>
            {t("addTenant")}
          </Button>
        </Card>
      ) : filteredTenants.length === 0 ? (
        <Card className="p-8 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{t("noResults")}</p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>{t("firstName")}</TableHead>
                  <TableHead>{t("lastName")}</TableHead>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("phone")}</TableHead>
                  <TableHead>{t("language")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow
                    key={tenant.id}
                    className="cursor-pointer"
                    onClick={() => openEdit(tenant)}
                  >
                    <TableCell>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-lg">
                        {getAvatar(tenant.avatar)}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{tenant.firstName}</TableCell>
                    <TableCell>{tenant.lastName}</TableCell>
                    <TableCell>{tenant.email}</TableCell>
                    <TableCell>{tenant.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="uppercase text-xs">
                        {tenant.language}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); openEdit(tenant); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
                          disabled={deleting === tenant.id}
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(tenant.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredTenants.map((tenant) => (
              <Card
                key={tenant.id}
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() => openEdit(tenant)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xl">
                        {getAvatar(tenant.avatar)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{tenant.firstName} {tenant.lastName}</p>
                        <Badge variant="secondary" className="uppercase text-xs">
                          {tenant.language}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); openEdit(tenant); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
                        disabled={deleting === tenant.id}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(tenant.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
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

      {/* Add/Edit tenant Dialog */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editTenantTitle") : t("addTenantTitle")}
            </DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit} key={editing?.id || "new"}>
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
                        ? "ring-2 ring-primary ring-offset-2 bg-muted"
                        : "hover:bg-muted"
                    }`}
                  >
                    {av.svg}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("firstName")}</label>
                <input name="firstName" type="text" required defaultValue={editing?.firstName || ""} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("lastName")}</label>
                <input name="lastName" type="text" required defaultValue={editing?.lastName || ""} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                <Mail className="mr-1 inline h-4 w-4" />
                {t("email")}
              </label>
              <input name="email" type="email" required defaultValue={editing?.email || ""} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                <Phone className="mr-1 inline h-4 w-4" />
                {t("phone")}
              </label>
              <PhoneInput name="phone" defaultCountry="BE" value={editing?.phone} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("language")}</label>
              <select name="language" defaultValue={editing?.language || "nl"} className={ic}>
                <option value="nl">{t("langNl")}</option>
                <option value="fr">{t("langFr")}</option>
                <option value="en">{t("langEn")}</option>
                <option value="de">{t("langDe")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("nationalRegister")}</label>
              <input
                name="nationalRegister"
                type="text"
                placeholder={t("nationalRegisterPlaceholder")}
                defaultValue={editing?.nationalRegister || ""}
                className={ic}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("iban")}</label>
              <IbanInput name="bankAccount" value={editing?.bankAccount || ""} />
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
                {saving ? "..." : editing ? t("updateTenant") : t("saveTenant")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
