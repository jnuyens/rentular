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
} from "lucide-react";

// Placeholder type for payments list
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
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.pending}`}
    >
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function PaymentsPage() {
  const t = useTranslations("payments");
  const [showIgnored, setShowIgnored] = useState(false);
  const [ignoreModalPaymentId, setIgnoreModalPaymentId] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  // TODO: Fetch payments from API
  const payments: Payment[] = [];

  const visiblePayments = showIgnored
    ? payments
    : payments.filter((p) => !p.isIgnored);

  const handleIgnore = async (paymentId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    await fetch(`${apiUrl}/api/v1/payments/${paymentId}/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: ignoreReason }),
      credentials: "include",
    });
    setIgnoreModalPaymentId(null);
    setIgnoreReason("");
    // TODO: Refresh payments list
  };

  const handleUnignore = async (paymentId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    await fetch(`${apiUrl}/api/v1/payments/${paymentId}/unignore`, {
      method: "POST",
      credentials: "include",
    });
    // TODO: Refresh payments list
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              showIgnored
                ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            } hover:bg-[hsl(var(--muted))]`}
          >
            {showIgnored ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
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
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {t("emptyDescription")}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("tenant")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("property")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("amountLabel")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("dueDate")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("statusLabel")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("remindersLabel")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
                  {t("actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visiblePayments.map((payment) => (
                <tr
                  key={payment.id}
                  className={`border-b border-[hsl(var(--border))] ${payment.isIgnored ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 text-sm">{payment.tenantName}</td>
                  <td className="px-4 py-3 text-sm">{payment.propertyName}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium">
                    &euro;{payment.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm">{payment.dueDate}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={payment.status}
                      isIgnored={payment.isIgnored}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {payment.reminders.length > 0 && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {payment.reminders.length} sent
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {payment.isIgnored ? (
                      <button
                        onClick={() => handleUnignore(payment.id)}
                        className="text-xs text-[hsl(var(--primary))] hover:underline"
                        title={payment.ignoreReason || ""}
                      >
                        {t("restore")}
                      </button>
                    ) : (
                      <button
                        onClick={() => setIgnoreModalPaymentId(payment.id)}
                        className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                      >
                        {t("markIgnored")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Ignore modal */}
      {ignoreModalPaymentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-[hsl(var(--background))] p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold">{t("ignoreTitle")}</h3>
            <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
              {t("ignoreDescription")}
            </p>
            <textarea
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder={t("ignoreReasonPlaceholder")}
              rows={3}
              className="mb-4 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIgnoreModalPaymentId(null);
                  setIgnoreReason("");
                }}
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => handleIgnore(ignoreModalPaymentId)}
                disabled={!ignoreReason.trim()}
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
              >
                {t("confirmIgnore")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
