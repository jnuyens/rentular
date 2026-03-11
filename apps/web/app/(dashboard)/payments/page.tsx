"use client";

import { useState } from "react";
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
  X,
} from "lucide-react";

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

type ModalType = "payment" | "cost" | "rent-free" | "deduction" | "ignore" | null;

function StatusBadge({ status, isIgnored }: { status: string; isIgnored: boolean }) {
  if (isIgnored) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
        <EyeOff className="h-3 w-3" />
        Ignored
      </span>
    );
  }
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-600",
    refunded: "bg-purple-100 text-purple-700",
  };
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    processing: <AlertCircle className="h-3 w-3" />,
    paid: <CheckCircle2 className="h-3 w-3" />,
    failed: <XCircle className="h-3 w-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.pending}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-[hsl(var(--background))] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[hsl(var(--muted))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const t = useTranslations("payments");
  const [showIgnored, setShowIgnored] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [ignorePaymentId, setIgnorePaymentId] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  // Form states
  const [paymentForm, setPaymentForm] = useState({ leaseId: "", amount: "", date: "", method: "bank_transfer" as string, reference: "", notes: "" });
  const [costForm, setCostForm] = useState({ propertyId: "", category: "maintenance" as string, description: "", amount: "", date: "", rechargedToTenant: false, reference: "", notes: "" });
  const [freePeriodForm, setFreePeriodForm] = useState({ leaseId: "", startDate: "", endDate: "", reason: "", waiveCharges: false, notes: "" });
  const [deductionForm, setDeductionForm] = useState({ leaseId: "", type: "temporary" as string, amount: "", startDate: "", endDate: "", reason: "", notes: "" });

  const payments: Payment[] = [];
  const visiblePayments = showIgnored ? payments : payments.filter((p) => !p.isIgnored);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const closeModal = () => {
    setActiveModal(null);
    setIgnorePaymentId(null);
    setIgnoreReason("");
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${apiUrl}/api/v1/payments/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...paymentForm, amount: parseFloat(paymentForm.amount) }),
      credentials: "include",
    });
    setPaymentForm({ leaseId: "", amount: "", date: "", method: "bank_transfer", reference: "", notes: "" });
    closeModal();
  };

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${apiUrl}/api/v1/costs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...costForm, amount: parseFloat(costForm.amount) }),
      credentials: "include",
    });
    setCostForm({ propertyId: "", category: "maintenance", description: "", amount: "", date: "", rechargedToTenant: false, reference: "", notes: "" });
    closeModal();
  };

  const handleAddFreePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${apiUrl}/api/v1/rent-adjustments/free-periods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(freePeriodForm),
      credentials: "include",
    });
    setFreePeriodForm({ leaseId: "", startDate: "", endDate: "", reason: "", waiveCharges: false, notes: "" });
    closeModal();
  };

  const handleAddDeduction = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${apiUrl}/api/v1/rent-adjustments/deductions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...deductionForm, amount: parseFloat(deductionForm.amount) }),
      credentials: "include",
    });
    setDeductionForm({ leaseId: "", type: "temporary", amount: "", startDate: "", endDate: "", reason: "", notes: "" });
    closeModal();
  };

  const handleIgnore = async (paymentId: string) => {
    await fetch(`${apiUrl}/api/v1/payments/${paymentId}/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: ignoreReason }),
      credentials: "include",
    });
    closeModal();
  };

  const handleUnignore = async (paymentId: string) => {
    await fetch(`${apiUrl}/api/v1/payments/${paymentId}/unignore`, {
      method: "POST",
      credentials: "include",
    });
  };

  const inputClass = "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm";
  const labelClass = "mb-1 block text-sm font-medium";
  const btnPrimary = "rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50";
  const btnSecondary = "rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]";

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveModal("payment")} className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90">
            <Plus className="h-4 w-4" /> {t("addPayment")}
          </button>
          <button onClick={() => setActiveModal("cost")} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]">
            <Receipt className="h-4 w-4" /> {t("addCost")}
          </button>
          <button onClick={() => setActiveModal("rent-free")} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]">
            <CalendarOff className="h-4 w-4" /> {t("addRentFree")}
          </button>
          <button onClick={() => setActiveModal("deduction")} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]">
            <TrendingDown className="h-4 w-4" /> {t("addDeduction")}
          </button>
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${showIgnored ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"} hover:bg-[hsl(var(--muted))]`}
          >
            {showIgnored ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {t("showIgnored")}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("overdue")}</p>
          <p className="mt-1 text-2xl font-bold text-red-600">0</p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pending")}</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">0</p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("paid")}</p>
          <p className="mt-1 text-2xl font-bold text-green-600">0</p>
        </div>
      </div>

      {/* Payments table */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        {visiblePayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <CreditCard className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
            <h3 className="text-lg font-semibold">{t("emptyTitle")}</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("emptyDescription")}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("tenant")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("property")}</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("amountLabel")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("dueDate")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("statusLabel")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("remindersLabel")}</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visiblePayments.map((payment) => (
                <tr key={payment.id} className={`border-b border-[hsl(var(--border))] ${payment.isIgnored ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-sm">{payment.tenantName}</td>
                  <td className="px-4 py-3 text-sm">{payment.propertyName}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium">&euro;{payment.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{payment.dueDate}</td>
                  <td className="px-4 py-3"><StatusBadge status={payment.status} isIgnored={payment.isIgnored} /></td>
                  <td className="px-4 py-3 text-sm">{payment.reminders.length > 0 && <span className="text-xs text-[hsl(var(--muted-foreground))]">{payment.reminders.length} sent</span>}</td>
                  <td className="px-4 py-3 text-right">
                    {payment.isIgnored ? (
                      <button onClick={() => handleUnignore(payment.id)} className="text-xs text-[hsl(var(--primary))] hover:underline" title={payment.ignoreReason || ""}>{t("restore")}</button>
                    ) : (
                      <button onClick={() => { setIgnorePaymentId(payment.id); setActiveModal("ignore"); }} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">{t("markIgnored")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Record payment modal */}
      <Modal open={activeModal === "payment"} onClose={closeModal} title={t("addPaymentTitle")}>
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className={labelClass}>{t("leaseId")}</label>
            <input type="text" required value={paymentForm.leaseId} onChange={(e) => setPaymentForm({ ...paymentForm, leaseId: e.target.value })} placeholder={t("leaseIdPlaceholder")} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("amountLabel")}</label>
              <input type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("paymentDate")}</label>
              <input type="date" required value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("paymentMethod")}</label>
            <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} className={inputClass}>
              <option value="bank_transfer">{t("methodBankTransfer")}</option>
              <option value="cash">{t("methodCash")}</option>
              <option value="other">{t("methodOther")}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("reference")}</label>
            <input type="text" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="+++xxx/xxxx/xxxxx+++" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("notesLabel")}</label>
            <textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={2} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={btnSecondary}>{t("cancel")}</button>
            <button type="submit" className={btnPrimary}>{t("recordPayment")}</button>
          </div>
        </form>
      </Modal>

      {/* Add cost modal */}
      <Modal open={activeModal === "cost"} onClose={closeModal} title={t("addCostTitle")}>
        <form onSubmit={handleAddCost} className="space-y-4">
          <div>
            <label className={labelClass}>{t("costCategory")}</label>
            <select value={costForm.category} onChange={(e) => setCostForm({ ...costForm, category: e.target.value })} className={inputClass}>
              <option value="maintenance">{t("catMaintenance")}</option>
              <option value="repair">{t("catRepair")}</option>
              <option value="insurance">{t("catInsurance")}</option>
              <option value="tax">{t("catTax")}</option>
              <option value="management_fee">{t("catManagementFee")}</option>
              <option value="utility">{t("catUtility")}</option>
              <option value="legal">{t("catLegal")}</option>
              <option value="renovation">{t("catRenovation")}</option>
              <option value="other">{t("catOther")}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("costDescription")}</label>
            <input type="text" required value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("amountLabel")}</label>
              <input type="number" step="0.01" min="0.01" required value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("costDate")}</label>
              <input type="date" required value={costForm.date} onChange={(e) => setCostForm({ ...costForm, date: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("reference")}</label>
            <input type="text" value={costForm.reference} onChange={(e) => setCostForm({ ...costForm, reference: e.target.value })} placeholder={t("invoiceNumber")} className={inputClass} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="recharge" checked={costForm.rechargedToTenant} onChange={(e) => setCostForm({ ...costForm, rechargedToTenant: e.target.checked })} />
            <label htmlFor="recharge" className="text-sm">{t("rechargeToTenant")}</label>
          </div>
          <div>
            <label className={labelClass}>{t("notesLabel")}</label>
            <textarea value={costForm.notes} onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })} rows={2} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={btnSecondary}>{t("cancel")}</button>
            <button type="submit" className={btnPrimary}>{t("saveCost")}</button>
          </div>
        </form>
      </Modal>

      {/* Rent-free period modal */}
      <Modal open={activeModal === "rent-free"} onClose={closeModal} title={t("addRentFreeTitle")}>
        <form onSubmit={handleAddFreePeriod} className="space-y-4">
          <div>
            <label className={labelClass}>{t("leaseId")}</label>
            <input type="text" required value={freePeriodForm.leaseId} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, leaseId: e.target.value })} placeholder={t("leaseIdPlaceholder")} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("startDate")}</label>
              <input type="date" required value={freePeriodForm.startDate} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, startDate: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("endDate")}</label>
              <input type="date" required value={freePeriodForm.endDate} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, endDate: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("reason")}</label>
            <input type="text" required value={freePeriodForm.reason} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, reason: e.target.value })} placeholder={t("rentFreeReasonPlaceholder")} className={inputClass} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="waiveCharges" checked={freePeriodForm.waiveCharges} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, waiveCharges: e.target.checked })} />
            <label htmlFor="waiveCharges" className="text-sm">{t("waiveCharges")}</label>
          </div>
          <div>
            <label className={labelClass}>{t("notesLabel")}</label>
            <textarea value={freePeriodForm.notes} onChange={(e) => setFreePeriodForm({ ...freePeriodForm, notes: e.target.value })} rows={2} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={btnSecondary}>{t("cancel")}</button>
            <button type="submit" className={btnPrimary}>{t("saveRentFree")}</button>
          </div>
        </form>
      </Modal>

      {/* Rent deduction modal */}
      <Modal open={activeModal === "deduction"} onClose={closeModal} title={t("addDeductionTitle")}>
        <form onSubmit={handleAddDeduction} className="space-y-4">
          <div>
            <label className={labelClass}>{t("leaseId")}</label>
            <input type="text" required value={deductionForm.leaseId} onChange={(e) => setDeductionForm({ ...deductionForm, leaseId: e.target.value })} placeholder={t("leaseIdPlaceholder")} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("deductionType")}</label>
            <select value={deductionForm.type} onChange={(e) => setDeductionForm({ ...deductionForm, type: e.target.value })} className={inputClass}>
              <option value="temporary">{t("typeTemporary")}</option>
              <option value="permanent">{t("typePermanent")}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("deductionAmount")}</label>
              <input type="number" step="0.01" min="0.01" required value={deductionForm.amount} onChange={(e) => setDeductionForm({ ...deductionForm, amount: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("startDate")}</label>
              <input type="date" required value={deductionForm.startDate} onChange={(e) => setDeductionForm({ ...deductionForm, startDate: e.target.value })} className={inputClass} />
            </div>
          </div>
          {deductionForm.type === "temporary" && (
            <div>
              <label className={labelClass}>{t("endDate")}</label>
              <input type="date" required value={deductionForm.endDate} onChange={(e) => setDeductionForm({ ...deductionForm, endDate: e.target.value })} className={inputClass} />
            </div>
          )}
          <div>
            <label className={labelClass}>{t("reason")}</label>
            <input type="text" required value={deductionForm.reason} onChange={(e) => setDeductionForm({ ...deductionForm, reason: e.target.value })} placeholder={t("deductionReasonPlaceholder")} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("notesLabel")}</label>
            <textarea value={deductionForm.notes} onChange={(e) => setDeductionForm({ ...deductionForm, notes: e.target.value })} rows={2} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={btnSecondary}>{t("cancel")}</button>
            <button type="submit" className={btnPrimary}>{t("saveDeduction")}</button>
          </div>
        </form>
      </Modal>

      {/* Ignore modal */}
      <Modal open={activeModal === "ignore"} onClose={closeModal} title={t("ignoreTitle")}>
        <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{t("ignoreDescription")}</p>
        <textarea value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} placeholder={t("ignoreReasonPlaceholder")} rows={3} className={`mb-4 ${inputClass}`} />
        <div className="flex justify-end gap-2">
          <button onClick={closeModal} className={btnSecondary}>{t("cancel")}</button>
          <button onClick={() => ignorePaymentId && handleIgnore(ignorePaymentId)} disabled={!ignoreReason.trim()} className={btnPrimary}>{t("confirmIgnore")}</button>
        </div>
      </Modal>
    </div>
  );
}
