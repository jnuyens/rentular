"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  CreditCard,
  EyeOff,
  Eye,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Receipt,
  CalendarOff,
  TrendingDown,
  Search,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
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
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface Payment {
  id: string;
  tenantName: string;
  propertyName: string;
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded";
  isIgnored: boolean;
  ignoreReason: string | null;
  reminders: Array<{ type: string; sentAt: string }>;
}

interface LeaseOption {
  id: string;
  propertyName: string;
  tenantNames: string;
  monthlyRent: string;
  type: string;
}

function LeaseSelect({
  value,
  onChange,
  leases,
  placeholder,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  leases: LeaseOption[];
  placeholder: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = leases.find((l) => l.id === value);
  const filtered = leases.filter((l) => {
    const q = query.toLowerCase();
    return (
      l.propertyName.toLowerCase().includes(q) ||
      l.tenantNames.toLowerCase().includes(q) ||
      l.type.toLowerCase().includes(q)
    );
  });

  return (
    <div ref={ref} className="relative">
      <Label>{label}</Label>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(!open)}
        className="mt-1 w-full justify-between text-left font-normal"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected
            ? `${selected.propertyName} -- ${selected.tenantNames || "?"} (${selected.monthlyRent}/m)`
            : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-hidden rounded-lg border bg-background shadow-lg">
          <div className="flex items-center border-b px-3 py-2">
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No contracts found
              </div>
            ) : (
              filtered.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    onChange(l.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full flex-col px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    l.id === value ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="font-medium">{l.propertyName}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.tenantNames || "--"} . {l.monthlyRent}/m . {l.type}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type ModalType = "payment" | "cost" | "rent-free" | "deduction" | "ignore" | null;

function StatusBadge({ status, isIgnored }: { status: string; isIgnored: boolean }) {
  if (isIgnored) {
    return (
      <Badge variant="outline" className="gap-1">
        <EyeOff className="h-3 w-3" />
        Ignored
      </Badge>
    );
  }
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    pending: { variant: "secondary", className: "bg-yellow-100 text-yellow-700 border-transparent" },
    processing: { variant: "secondary", className: "bg-blue-100 text-blue-700 border-transparent" },
    paid: { variant: "default", className: "bg-green-100 text-green-700 border-transparent" },
    failed: { variant: "destructive", className: "" },
    cancelled: { variant: "outline", className: "" },
    refunded: { variant: "secondary", className: "bg-purple-100 text-purple-700 border-transparent" },
  };
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    processing: <AlertCircle className="h-3 w-3" />,
    paid: <CheckCircle2 className="h-3 w-3" />,
    failed: <XCircle className="h-3 w-3" />,
  };
  const config = variants[status] || variants.pending;
  return (
    <Badge variant={config.variant} className={`gap-1 ${config.className}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export default function PaymentsPage() {
  const t = useTranslations("payments");
  const tc = useTranslations("dashboard");
  const [showIgnored, setShowIgnored] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [ignorePaymentId, setIgnorePaymentId] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [paymentForm, setPaymentForm] = useState({ leaseId: "", amount: "", date: "", method: "bank_transfer" as string, reference: "", notes: "" });
  const [costForm, setCostForm] = useState({ propertyId: "", category: "maintenance" as string, description: "", amount: "", date: "", rechargedToTenant: false, reference: "", notes: "" });
  const [freePeriodForm, setFreePeriodForm] = useState({ leaseId: "", startDate: "", endDate: "", reason: "", waiveCharges: false, notes: "" });
  const [deductionForm, setDeductionForm] = useState({ leaseId: "", type: "temporary" as string, amount: "", startDate: "", endDate: "", reason: "", notes: "" });

  const [leaseOptions, setLeaseOptions] = useState<LeaseOption[]>([]);

  const payments: Payment[] = [];
  const visiblePayments = showIgnored ? payments : payments.filter((p) => !p.isIgnored);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchLeases = useCallback(async () => {
    try {
      const [leasesRes, propsRes, tenantsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
      ]);
      const leasesData = leasesRes.ok ? (await leasesRes.json()).data || [] : [];
      const propsData = propsRes.ok ? (await propsRes.json()).data || [] : [];
      const tenantsData = tenantsRes.ok ? (await tenantsRes.json()).data || [] : [];
      const propMap = new Map(propsData.map((p: any) => [p.id, p.name || p.city || p.id]));
      const tenantMap = new Map(tenantsData.map((t: any) => [t.id, `${t.firstName} ${t.lastName}`]));
      setLeaseOptions(
        leasesData.map((l: any) => ({
          id: l.id,
          propertyName: propMap.get(l.propertyId) || l.propertyId,
          tenantNames: (l.tenantIds || []).map((id: string) => tenantMap.get(id) || id).join(", "),
          monthlyRent: l.monthlyRent,
          type: l.type,
        }))
      );
    } catch {
      toast.error(t("loadError") || "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, t]);

  useEffect(() => {
    fetchLeases();
  }, [fetchLeases]);

  const closeModal = () => {
    setActiveModal(null);
    setIgnorePaymentId(null);
    setIgnoreReason("");
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...paymentForm, amount: parseFloat(paymentForm.amount) }),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.created") || "Payment recorded");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to record payment");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    setPaymentForm({ leaseId: "", amount: "", date: "", method: "bank_transfer", reference: "", notes: "" });
    closeModal();
  };

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/v1/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...costForm, amount: parseFloat(costForm.amount) }),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.created") || "Cost recorded");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to record cost");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    setCostForm({ propertyId: "", category: "maintenance", description: "", amount: "", date: "", rechargedToTenant: false, reference: "", notes: "" });
    closeModal();
  };

  const handleAddFreePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/v1/rent-adjustments/free-periods`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(freePeriodForm),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.created") || "Rent-free period added");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to add rent-free period");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    setFreePeriodForm({ leaseId: "", startDate: "", endDate: "", reason: "", waiveCharges: false, notes: "" });
    closeModal();
  };

  const handleAddDeduction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/v1/rent-adjustments/deductions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...deductionForm, amount: parseFloat(deductionForm.amount) }),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.created") || "Deduction added");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to add deduction");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    setDeductionForm({ leaseId: "", type: "temporary", amount: "", startDate: "", endDate: "", reason: "", notes: "" });
    closeModal();
  };

  const handleIgnore = async (paymentId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/${paymentId}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: ignoreReason }),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.updated") || "Payment ignored");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to ignore payment");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    closeModal();
  };

  const handleUnignore = async (paymentId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/${paymentId}/unignore`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.updated") || "Payment restored");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to restore payment");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setActiveModal("payment")} size="sm">
            <Plus className="mr-1 h-4 w-4" /> {t("addPayment")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveModal("cost")}>
            <Receipt className="mr-1 h-4 w-4" /> {t("addCost")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveModal("rent-free")}>
            <CalendarOff className="mr-1 h-4 w-4" /> {t("addRentFree")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveModal("deduction")}>
            <TrendingDown className="mr-1 h-4 w-4" /> {t("addDeduction")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIgnored(!showIgnored)}
            className={showIgnored ? "border-primary text-primary" : "text-muted-foreground"}
          >
            {showIgnored ? <Eye className="mr-1 h-4 w-4" /> : <EyeOff className="mr-1 h-4 w-4" />}
            {t("showIgnored")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("overdue")}</p>
            <p className="mt-1 text-2xl font-bold text-red-600">0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("pending")}</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("paid")}</p>
            <p className="mt-1 text-2xl font-bold text-green-600">0</p>
          </CardContent>
        </Card>
      </div>

      {/* Skeleton loading */}
      {isLoading && (
        <Card>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </Card>
      )}

      {/* Payments table / empty state */}
      {!isLoading && (
        <Card>
          {visiblePayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <CreditCard className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">{tc("emptyPaymentsTitle")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{tc("emptyPaymentsDesc")}</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs uppercase">{t("tenant")}</TableHead>
                      <TableHead className="text-xs uppercase">{t("property")}</TableHead>
                      <TableHead className="text-right text-xs uppercase">{t("amountLabel")}</TableHead>
                      <TableHead className="text-xs uppercase">{t("dueDate")}</TableHead>
                      <TableHead className="text-xs uppercase">{t("statusLabel")}</TableHead>
                      <TableHead className="text-xs uppercase">{t("remindersLabel")}</TableHead>
                      <TableHead className="text-right text-xs uppercase">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePayments.map((payment) => (
                      <TableRow key={payment.id} className={payment.isIgnored ? "opacity-50" : ""}>
                        <TableCell className="text-sm">{payment.tenantName}</TableCell>
                        <TableCell className="text-sm">{payment.propertyName}</TableCell>
                        <TableCell className="text-right text-sm font-medium">&euro;{payment.amount.toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{payment.dueDate}</TableCell>
                        <TableCell><StatusBadge status={payment.status} isIgnored={payment.isIgnored} /></TableCell>
                        <TableCell className="text-sm">{payment.reminders.length > 0 && <span className="text-xs text-muted-foreground">{payment.reminders.length} sent</span>}</TableCell>
                        <TableCell className="text-right">
                          {payment.isIgnored ? (
                            <Button variant="link" size="sm" onClick={() => handleUnignore(payment.id)} title={payment.ignoreReason || ""}>{t("restore")}</Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setIgnorePaymentId(payment.id); setActiveModal("ignore"); }}>{t("markIgnored")}</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3 p-4">
                {visiblePayments.map((payment) => (
                  <Card key={payment.id} className={payment.isIgnored ? "opacity-50" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{payment.tenantName}</p>
                          <p className="text-sm text-muted-foreground">{payment.propertyName}</p>
                        </div>
                        <StatusBadge status={payment.status} isIgnored={payment.isIgnored} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">{t("amountLabel")}:</span>
                          <span className="ml-1 font-medium">&euro;{payment.amount.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("dueDate")}:</span>
                          <span className="ml-1">{payment.dueDate}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end">
                        {payment.isIgnored ? (
                          <Button variant="link" size="sm" onClick={() => handleUnignore(payment.id)}>{t("restore")}</Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setIgnorePaymentId(payment.id); setActiveModal("ignore"); }}>{t("markIgnored")}</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* Record payment dialog */}
      <Dialog open={activeModal === "payment"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addPaymentTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <LeaseSelect
              value={paymentForm.leaseId}
              onChange={(id) => setPaymentForm({ ...paymentForm, leaseId: id })}
              leases={leaseOptions}
              placeholder={t("leaseIdPlaceholder")}
              label={t("leaseId")}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("amountLabel")}</Label>
                <Input type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>{t("paymentDate")}</Label>
                <Input type="date" required value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>{t("paymentMethod")}</Label>
              <Select value={paymentForm.method} onValueChange={(val) => setPaymentForm({ ...paymentForm, method: val })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">{t("methodBankTransfer")}</SelectItem>
                  <SelectItem value="cash">{t("methodCash")}</SelectItem>
                  <SelectItem value="other">{t("methodOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("reference")}</Label>
              <Input type="text" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="+++xxx/xxxx/xxxxx+++" className="mt-1" />
            </div>
            <div>
              <Label>{t("notesLabel")}</Label>
              <textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={2} className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>{t("cancel")}</Button>
              <Button type="submit">{t("recordPayment")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add cost dialog */}
      <Dialog open={activeModal === "cost"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addCostTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddCost} className="space-y-4">
            <div>
              <Label>{t("costCategory")}</Label>
              <Select value={costForm.category} onValueChange={(val) => setCostForm({ ...costForm, category: val })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maintenance">{t("catMaintenance")}</SelectItem>
                  <SelectItem value="repair">{t("catRepair")}</SelectItem>
                  <SelectItem value="insurance">{t("catInsurance")}</SelectItem>
                  <SelectItem value="tax">{t("catTax")}</SelectItem>
                  <SelectItem value="management_fee">{t("catManagementFee")}</SelectItem>
                  <SelectItem value="utility">{t("catUtility")}</SelectItem>
                  <SelectItem value="legal">{t("catLegal")}</SelectItem>
                  <SelectItem value="renovation">{t("catRenovation")}</SelectItem>
                  <SelectItem value="other">{t("catOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("costDescription")}</Label>
              <Input type="text" required value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("amountLabel")}</Label>
                <Input type="number" step="0.01" min="0.01" required value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>{t("costDate")}</Label>
                <Input type="date" required value={costForm.date} onChange={(e) => setCostForm({ ...costForm, date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>{t("reference")}</Label>
              <Input type="text" value={costForm.reference} onChange={(e) => setCostForm({ ...costForm, reference: e.target.value })} placeholder={t("invoiceNumber")} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="recharge" checked={costForm.rechargedToTenant} onChange={(e) => setCostForm({ ...costForm, rechargedToTenant: e.target.checked })} />
              <label htmlFor="recharge" className="text-sm">{t("rechargeToTenant")}</label>
            </div>
            <div>
              <Label>{t("notesLabel")}</Label>
              <textarea value={costForm.notes} onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })} rows={2} className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>{t("cancel")}</Button>
              <Button type="submit">{t("saveCost")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rent-free period dialog */}
      <Dialog open={activeModal === "rent-free"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addRentFreeTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddFreePeriod} className="space-y-4">
            <LeaseSelect
              value={freePeriodForm.leaseId}
              onChange={(id) => setFreePeriodForm({ ...freePeriodForm, leaseId: id })}
              leases={leaseOptions}
              placeholder={t("leaseIdPlaceholder")}
              label={t("leaseId")}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("startDate")}</Label>
                <Input type="date" required value={freePeriodForm.startDate} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, startDate: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>{t("endDate")}</Label>
                <Input type="date" required value={freePeriodForm.endDate} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, endDate: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>{t("reason")}</Label>
              <Input type="text" required value={freePeriodForm.reason} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, reason: e.target.value })} placeholder={t("rentFreeReasonPlaceholder")} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="waiveCharges" checked={freePeriodForm.waiveCharges} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, waiveCharges: e.target.checked })} />
              <label htmlFor="waiveCharges" className="text-sm">{t("waiveCharges")}</label>
            </div>
            <div>
              <Label>{t("notesLabel")}</Label>
              <textarea value={freePeriodForm.notes} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, notes: e.target.value })} rows={2} className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>{t("cancel")}</Button>
              <Button type="submit">{t("saveRentFree")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rent deduction dialog */}
      <Dialog open={activeModal === "deduction"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addDeductionTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddDeduction} className="space-y-4">
            <LeaseSelect
              value={deductionForm.leaseId}
              onChange={(id) => setDeductionForm({ ...deductionForm, leaseId: id })}
              leases={leaseOptions}
              placeholder={t("leaseIdPlaceholder")}
              label={t("leaseId")}
            />
            <div>
              <Label>{t("deductionType")}</Label>
              <Select value={deductionForm.type} onValueChange={(val) => setDeductionForm({ ...deductionForm, type: val })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="temporary">{t("typeTemporary")}</SelectItem>
                  <SelectItem value="permanent">{t("typePermanent")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("deductionAmount")}</Label>
                <Input type="number" step="0.01" min="0.01" required value={deductionForm.amount} onChange={(e) => setDeductionForm({ ...deductionForm, amount: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>{t("startDate")}</Label>
                <Input type="date" required value={deductionForm.startDate} onChange={(e) => setDeductionForm({ ...deductionForm, startDate: e.target.value })} className="mt-1" />
              </div>
            </div>
            {deductionForm.type === "temporary" && (
              <div>
                <Label>{t("endDate")}</Label>
                <Input type="date" required value={deductionForm.endDate} onChange={(e) => setDeductionForm({ ...deductionForm, endDate: e.target.value })} className="mt-1" />
              </div>
            )}
            <div>
              <Label>{t("reason")}</Label>
              <Input type="text" required value={deductionForm.reason} onChange={(e) => setDeductionForm({ ...deductionForm, reason: e.target.value })} placeholder={t("deductionReasonPlaceholder")} className="mt-1" />
            </div>
            <div>
              <Label>{t("notesLabel")}</Label>
              <textarea value={deductionForm.notes} onChange={(e) => setDeductionForm({ ...deductionForm, notes: e.target.value })} rows={2} className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>{t("cancel")}</Button>
              <Button type="submit">{t("saveDeduction")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog using AlertDialog */}
      <AlertDialog open={activeModal === "ignore"} onOpenChange={(open) => !open && closeModal()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ignoreTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("ignoreDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={ignoreReason}
            onChange={(e) => setIgnoreReason(e.target.value)}
            placeholder={t("ignoreReasonPlaceholder")}
            rows={3}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeModal}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => ignorePaymentId && handleIgnore(ignorePaymentId)}
              disabled={!ignoreReason.trim()}
            >
              {t("confirmIgnore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
