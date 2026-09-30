"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { FileText, Plus, Search, Users, Pencil, Trash2, ChevronUp, ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { PaymentMethodRadioGroup } from "@/components/PaymentMethodRadioGroup";
import { MandateStatusBadge } from "@/components/MandateStatusBadge";
import { MandateSetupModal } from "@/components/MandateSetupModal";
import { CancelMandateDialog } from "@/components/CancelMandateDialog";

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
  signingDate: string;
  startDate: string;
  endDate?: string;
  monthlyRent: string;
  monthlyCharges: string;
  bankAccountId?: string;
  tenantIds?: string[];
  indexationEnabled?: boolean;
  paymentMethod?: string;
  gocardlessMandateId?: string;
}

interface BankAccountOption {
  id: string;
  label: string;
  iban: string;
}

export default function LeasesPage() {
  const t = useTranslations("leases");
  const td = useTranslations("dashboard");
  const tt = useTranslations("toast");
  const [showModal, setShowModal] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [indexationEnabled, setIndexationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [showMandateSetup, setShowMandateSetup] = useState(false);
  const [showCancelMandate, setShowCancelMandate] = useState(false);
  const [mandateStatus, setMandateStatus] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>("");
  const [selectedLeaseForMandate, setSelectedLeaseForMandate] = useState<Lease | null>(null);

  type SortColumn = "property" | "type" | "status" | "startDate" | "endDate" | "monthlyRent";
  type SortDirection = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>("property");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Format ISO date to Belgian dd/mm/yyyy
  const fmtDate = (d?: string | null) => {
    if (!d) return "";
    const iso = d.includes("T") ? d.split("T")[0] : d;
    const [y, m, dd] = iso.split("-");
    return y && m && dd ? `${dd}/${m}/${y}` : d;
  };

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const openAdd = () => {
    setEditingLease(null);
    setSelectedTenants([]);
    setIndexationEnabled(true);
    setPaymentMethod(
      typeof window !== "undefined"
        ? localStorage.getItem("rentular_default_payment_method") || "bank_transfer"
        : "bank_transfer"
    );
    setMandateStatus(null);
    setSelectedBankAccountId("");
    setError("");
    setShowModal(true);
  };

  const openEdit = (lease: Lease) => {
    setEditingLease(lease);
    setSelectedTenants(lease.tenantIds || []);
    setIndexationEnabled(lease.indexationEnabled !== false);
    setPaymentMethod(lease.paymentMethod || "bank_transfer");
    setSelectedBankAccountId(lease.bankAccountId || "");
    setError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingLease(null);
    setSelectedTenants([]);
    setError("");
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setDeleteTarget(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/leases/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setLeases((prev) => prev.filter((l) => l.id !== id));
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

  const fetchData = useCallback(async () => {
    try {
      const [leasesRes, propsRes, tenantsRes, bankRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/bank-accounts`, { credentials: "include" }),
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
      if (bankRes.ok) {
        const json = await bankRes.json();
        setBankAccounts(
          (json.data || []).map((b: { id: string; label: string; iban: string }) => ({
            id: b.id,
            label: b.label,
            iban: b.iban,
          }))
        );
      }
    } catch {
      toast.error(tt("networkError"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tt]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch mandate status when editing a lease with a mandateId
  useEffect(() => {
    if (editingLease?.gocardlessMandateId) {
      fetch(
        `${apiUrl}/api/v1/gocardless/mandates/${editingLease.gocardlessMandateId}`,
        { credentials: "include" }
      )
        .then((res) => res.json())
        .then((data) => setMandateStatus(data.data?.status || null))
        .catch(() => setMandateStatus(null));
    } else {
      setMandateStatus(null);
    }
  }, [editingLease?.gocardlessMandateId, apiUrl]);

  const toggleTenant = (tenantId: string) => {
    setSelectedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const body = {
      ...data,
      tenantIds: selectedTenants,
      indexationEnabled,
      paymentMethod,
      bankAccountId: paymentMethod === "bank_transfer" ? selectedBankAccountId : undefined,
    };
    try {
      const url = editingLease
        ? `${apiUrl}/api/v1/leases/${editingLease.id}`
        : `${apiUrl}/api/v1/leases`;
      const res = await fetch(url, {
        method: editingLease ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        if (editingLease) {
          setLeases((prev) =>
            prev.map((l) => (l.id === editingLease.id ? json.data : l))
          );
          toast.success(tt("updated"));
        } else {
          setLeases((prev) => [...prev, json.data]);
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
    residential_long: t("typeResidentialLong"),
    residential_short: t("typeResidentialShort"),
    residential_lifetime: t("typeLifetime"),
    student: t("typeStudent"),
    commercial: t("typeCommercial"),
  };

  const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "active": return "default";
      case "draft": return "secondary";
      case "terminated": return "destructive";
      case "expired": return "outline";
      default: return "secondary";
    }
  };

  const ic = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  // Sort indicator component for table headers
  const SortHeader = ({ column, label }: { column: SortColumn; label: string }) => (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground transition-colors text-left"
      onClick={(e) => { e.stopPropagation(); toggleSort(column); }}
    >
      {label}
      {sortColumn === column ? (
        sortDirection === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ChevronUp className="h-3.5 w-3.5 opacity-0 group-hover:opacity-30" />
      )}
    </button>
  );

  // Sort leases based on current sort column and direction
  const sortedLeases = [...leases].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "property": {
        const propA = properties.find((p) => p.id === a.propertyId)?.name || a.propertyId;
        const propB = properties.find((p) => p.id === b.propertyId)?.name || b.propertyId;
        return propA.localeCompare(propB) * dir;
      }
      case "type":
        return a.type.localeCompare(b.type) * dir;
      case "status":
        return a.status.localeCompare(b.status) * dir;
      case "startDate":
        return (a.startDate || "").localeCompare(b.startDate || "") * dir;
      case "endDate":
        return (a.endDate || "9999-12-31").localeCompare(b.endDate || "9999-12-31") * dir;
      case "monthlyRent":
        return (Number(a.monthlyRent) - Number(b.monthlyRent)) * dir;
      default:
        return 0;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {t("addLease")}
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
        <select className={`${ic} sm:w-auto`}>
          <option value="">{t("allStatuses")}</option>
          <option value="draft">{t("statusDraft")}</option>
          <option value="active">{t("statusActive")}</option>
          <option value="terminated">{t("statusTerminated")}</option>
          <option value="expired">{t("statusExpired")}</option>
        </select>
        <select className={`${ic} sm:w-auto`}>
          <option value="">{t("allRegions")}</option>
          <option value="flanders">{t("regionFlanders")}</option>
          <option value="wallonia">{t("regionWallonia")}</option>
          <option value="brussels">{t("regionBrussels")}</option>
        </select>
      </div>

      {/* Loading skeletons */}
      {loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("property")}</TableHead>
                  <TableHead>{t("leaseType")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("startDate")}</TableHead>
                  <TableHead>{t("endDate")}</TableHead>
                  <TableHead>{t("monthlyRent")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-[70px] rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
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
                  <div className="flex justify-between">
                    <Skeleton className="h-5 w-[150px]" />
                    <Skeleton className="h-5 w-[70px] rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-[200px]" />
                  <Skeleton className="h-4 w-[120px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : leases.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-semibold">{td("emptyLeasesTitle")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{td("emptyLeasesDesc")}</p>
          <Button className="mt-4" onClick={openAdd}>
            {t("addLease")}
          </Button>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortHeader column="property" label={t("property")} /></TableHead>
                  <TableHead><SortHeader column="type" label={t("leaseType")} /></TableHead>
                  <TableHead><SortHeader column="status" label={t("status")} /></TableHead>
                  <TableHead><SortHeader column="startDate" label={t("startDate")} /></TableHead>
                  <TableHead><SortHeader column="endDate" label={t("endDate")} /></TableHead>
                  <TableHead><SortHeader column="monthlyRent" label={t("monthlyRent")} /></TableHead>
                  <TableHead className="w-[100px]">{t("payment")}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLeases.map((lease) => {
                  const prop = properties.find((p) => p.id === lease.propertyId);
                  return (
                    <TableRow
                      key={lease.id}
                      className="cursor-pointer"
                      onClick={() => openEdit(lease)}
                    >
                      <TableCell className="font-medium">
                        {prop?.name || lease.propertyId}
                      </TableCell>
                      <TableCell>{typeLabels[lease.type] || lease.type}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(lease.status)}>
                          {t(`status${lease.status.charAt(0).toUpperCase()}${lease.status.slice(1)}`) || lease.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(lease.startDate)}</TableCell>
                      <TableCell>{lease.endDate ? fmtDate(lease.endDate) : "..."}</TableCell>
                      <TableCell>
                        <div>
                          <span className="font-semibold">&euro;{lease.monthlyRent}/m</span>
                          {Number(lease.monthlyCharges) > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">+ &euro;{lease.monthlyCharges}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {lease.paymentMethod === "gocardless" && lease.gocardlessMandateId ? (
                          <MandateStatusBadge status="active" />
                        ) : lease.paymentMethod === "gocardless" ? (
                          <Badge variant="outline">GoCardless</Badge>
                        ) : lease.paymentMethod === "manual" ? (
                          <Badge variant="secondary">{t("paymentMethodManual")}</Badge>
                        ) : (
                          <Badge variant="secondary">{t("paymentMethodBankTransfer")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(lease); }}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              {t("editLease")}
                            </DropdownMenuItem>
                            {lease.paymentMethod === "gocardless" && !lease.gocardlessMandateId && (
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLeaseForMandate(lease);
                                setShowMandateSetup(true);
                              }}>
                                {t("setupMandate")}
                              </DropdownMenuItem>
                            )}
                            {lease.gocardlessMandateId && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLeaseForMandate(lease);
                                  setShowCancelMandate(true);
                                }}
                              >
                                {t("cancelMandate")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={deleting === lease.id}
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(lease.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t("deleteLease")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {sortedLeases.map((lease) => {
              const prop = properties.find((p) => p.id === lease.propertyId);
              return (
                <Card
                  key={lease.id}
                  className="cursor-pointer transition-all hover:shadow-md"
                  onClick={() => openEdit(lease)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{prop?.name || lease.propertyId}</span>
                      <Badge variant={statusVariant(lease.status)}>
                        {t(`status${lease.status.charAt(0).toUpperCase()}${lease.status.slice(1)}`) || lease.status}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("leaseType")}</span>
                        <span>{typeLabels[lease.type] || lease.type}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("startDate")}</span>
                        <span>{fmtDate(lease.startDate)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("endDate")}</span>
                        <span>{lease.endDate ? fmtDate(lease.endDate) : "..."}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("monthlyRent")}</span>
                        <span className="font-semibold">
                          &euro;{lease.monthlyRent}/m
                          {Number(lease.monthlyCharges) > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">+ &euro;{lease.monthlyCharges}</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">{t("payment")}</span>
                        {lease.paymentMethod === "gocardless" && lease.gocardlessMandateId ? (
                          <MandateStatusBadge status="active" />
                        ) : lease.paymentMethod === "manual" ? (
                          <Badge variant="secondary">{t("paymentMethodManual")}</Badge>
                        ) : (
                          <Badge variant="secondary">{t("paymentMethodBankTransfer")}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); openEdit(lease); }}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        {t("editLease")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                        disabled={deleting === lease.id}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(lease.id); }}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        {t("deleteLease")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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

      {/* Mandate Setup Modal */}
      <MandateSetupModal
        open={showMandateSetup}
        onOpenChange={setShowMandateSetup}
        leaseId={editingLease?.id || selectedLeaseForMandate?.id}
        tenantId={editingLease?.tenantIds?.[0] || selectedLeaseForMandate?.tenantIds?.[0]}
        onSuccess={() => {
          fetchData();
          setShowMandateSetup(false);
        }}
      />

      {/* Cancel Mandate Dialog */}
      <CancelMandateDialog
        open={showCancelMandate}
        onOpenChange={setShowCancelMandate}
        mandateId={selectedLeaseForMandate?.gocardlessMandateId || editingLease?.gocardlessMandateId || ""}
        tenantName=""
        onSuccess={() => {
          fetchData();
          setShowCancelMandate(false);
          setSelectedLeaseForMandate(null);
        }}
      />

      {/* Add/Edit lease Dialog */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingLease ? t("editLeaseTitle") : t("addLeaseTitle")}
            </DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("property")}</label>
                <select
                  name="propertyId"
                  required
                  defaultValue={editingLease?.propertyId || ""}
                  className={ic}
                >
                  <option value="">{t("selectProperty")}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.city})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("leaseType")}</label>
                <select
                  name="leaseType"
                  required
                  defaultValue={editingLease?.type || "residential_long"}
                  className={ic}
                >
                  <option value="residential_long">{t("typeResidentialLong")}</option>
                  <option value="residential_short">{t("typeResidentialShort")}</option>
                  <option value="residential_lifetime">{t("typeLifetime")}</option>
                  <option value="student">{t("typeStudent")}</option>
                  <option value="commercial">{t("typeCommercial")}</option>
                </select>
              </div>
            </div>

            {/* Tenant selection */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                <Users className="mr-1 inline h-4 w-4" />
                {t("tenants")}
              </label>
              {tenants.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noTenantsYet")}</p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                  {tenants.map((tenant) => (
                    <label
                      key={tenant.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                        selectedTenants.includes(tenant.id)
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-muted"
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
                      <span className="text-xs text-muted-foreground">{tenant.email}</span>
                    </label>
                  ))}
                </div>
              )}
              {selectedTenants.length > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("coTenantsNote")}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("region")}</label>
                <select
                  name="region"
                  required
                  defaultValue={editingLease?.region || "flanders"}
                  className={ic}
                >
                  <option value="flanders">{t("regionFlanders")}</option>
                  <option value="wallonia">{t("regionWallonia")}</option>
                  <option value="brussels">{t("regionBrussels")}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("status")}</label>
                <select
                  name="status"
                  defaultValue={editingLease?.status || "active"}
                  className={ic}
                >
                  <option value="active">{t("statusActive")}</option>
                  <option value="draft">{t("statusDraft")}</option>
                  <option value="terminated">{t("statusTerminated")}</option>
                  <option value="expired">{t("statusExpired")}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("signingDate")}</label>
                <input
                  name="signingDate"
                  type="date"
                  required
                  defaultValue={editingLease?.signingDate || ""}
                  className={ic}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("startDate")}</label>
                <input
                  name="startDate"
                  type="date"
                  required
                  defaultValue={editingLease?.startDate || ""}
                  className={ic}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("endDate")}</label>
              <input
                name="endDate"
                type="date"
                defaultValue={editingLease?.endDate || ""}
                className={ic}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("monthlyRent")}</label>
                <input
                  name="monthlyRent"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={editingLease?.monthlyRent || ""}
                  className={ic}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("monthlyCharges")}</label>
                <input
                  name="monthlyCharges"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editingLease?.monthlyCharges || "0"}
                  className={ic}
                />
              </div>
            </div>
            {/* Payment Method */}
            <div className="space-y-2">
              <Label>{t("paymentMethod")}</Label>
              <PaymentMethodRadioGroup
                value={paymentMethod}
                onChange={setPaymentMethod}
                mandateStatus={mandateStatus || undefined}
                mandateId={editingLease?.gocardlessMandateId || undefined}
                bankAccounts={bankAccounts}
                selectedBankAccountId={selectedBankAccountId}
                onBankAccountChange={setSelectedBankAccountId}
                onSetupMandate={() => setShowMandateSetup(true)}
                leaseId={editingLease?.id}
                tenantId={editingLease?.tenantIds?.[0]}
              />
            </div>
            {/* Indexation toggle */}
            <div className="flex items-center justify-between rounded-lg border border-input px-4 py-3">
              <div>
                <p className="text-sm font-medium">{t("indexation")}</p>
                <p className="text-xs text-muted-foreground">{t("indexationDescription")}</p>
              </div>
              <button
                type="button"
                onClick={() => setIndexationEnabled(!indexationEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  indexationEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    indexationEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "..." : editingLease ? t("updateLease") : t("saveLease")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
