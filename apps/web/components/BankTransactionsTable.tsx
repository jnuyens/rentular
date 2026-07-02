"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface LinkedPayment {
  id: string;
  leaseId: string;
  amount: number;
  dueDate: string | null;
  leaseLabel: string;
}

export interface BankTransaction {
  id: string;
  bookingDate: string | null;
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  structuredCommunication: string | null;
  unstructuredCommunication: string | null;
  matchStatus: "unmatched" | "matched" | "mismatched_amount" | "ignored" | string;
  matchedPaymentId: string | null;
  matchedAt: string | null;
  linkedPayment: LinkedPayment | null;
  connection?: { id: string; institutionName: string | null; iban: string | null };
}

interface LeaseOption {
  id: string;
  label: string;
}

interface BankTransactionsTableProps {
  transactions: BankTransaction[];
  mode: "global" | "connection";
  onRefetch: () => void;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "---";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function fmtAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount).toLocaleString("nl-BE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = currency === "EUR" ? "€" : `${currency} `;
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}${symbol}${abs}`;
}

function maskIban(iban: string | null): string {
  if (!iban) return "";
  if (iban.length <= 4) return iban;
  return `•••• ${iban.slice(-4)}`;
}

export function BankTransactionsTable({
  transactions,
  mode,
  onRefetch,
}: BankTransactionsTableProps) {
  const t = useTranslations("reconciliation");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignStatementId, setAssignStatementId] = useState<string | null>(null);
  const [leaseOptions, setLeaseOptions] = useState<LeaseOption[]>([]);
  const [leasesLoaded, setLeasesLoaded] = useState(false);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string>("");

  const loadLeases = useCallback(async () => {
    if (leasesLoaded) return;
    try {
      const [leasesRes, propsRes, tenantsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
      ]);
      const leasesData = leasesRes.ok ? (await leasesRes.json()).data || [] : [];
      const propsData = propsRes.ok ? (await propsRes.json()).data || [] : [];
      const tenantsData = tenantsRes.ok ? (await tenantsRes.json()).data || [] : [];
      const propMap = new Map<string, string>(
        propsData.map((p: { id: string; name?: string; city?: string }) => [
          p.id,
          p.name || p.city || p.id,
        ]),
      );
      const tenantMap = new Map<string, string>(
        tenantsData.map((tn: { id: string; firstName: string; lastName: string }) => [
          tn.id,
          `${tn.firstName} ${tn.lastName}`.trim(),
        ]),
      );
      setLeaseOptions(
        leasesData.map(
          (l: { id: string; propertyId: string; tenantIds?: string[] }) => {
            const propertyName = propMap.get(l.propertyId) || l.propertyId;
            const tenantNames = (l.tenantIds || [])
              .map((id) => tenantMap.get(id) || id)
              .join(", ");
            return {
              id: l.id,
              label: tenantNames ? `${propertyName} — ${tenantNames}` : propertyName,
            };
          },
        ),
      );
      setLeasesLoaded(true);
    } catch {
      toast.error(t("loadError"));
    }
  }, [apiUrl, leasesLoaded, t]);

  useEffect(() => {
    if (assignOpen) loadLeases();
  }, [assignOpen, loadLeases]);

  async function runAction(
    statementId: string,
    action: "approve" | "ignore" | "undo",
  ) {
    setBusyId(statementId);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-transactions/${statementId}/${action}`,
        { method: "POST", credentials: "include" },
      );
      if (res.ok) {
        toast.success(
          action === "approve"
            ? t("toasts.approved")
            : action === "ignore"
              ? t("toasts.ignored")
              : t("toasts.undone"),
        );
        onRefetch();
      } else if (res.status === 409 && action === "approve") {
        toast.error(t("toasts.noMatch"));
      } else {
        toast.error(t("toasts.error"));
      }
    } catch {
      toast.error(t("toasts.error"));
    } finally {
      setBusyId(null);
    }
  }

  function openAssign(statementId: string) {
    setAssignStatementId(statementId);
    setSelectedLeaseId("");
    setAssignOpen(true);
  }

  async function submitAssign() {
    if (!assignStatementId || !selectedLeaseId) return;
    setBusyId(assignStatementId);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-transactions/${assignStatementId}/assign`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaseId: selectedLeaseId }),
        },
      );
      if (res.ok) {
        toast.success(t("toasts.assigned"));
        setAssignOpen(false);
        setAssignStatementId(null);
        onRefetch();
      } else if (res.status === 409) {
        toast.error(t("toasts.noPendingPayment"));
      } else {
        toast.error(t("toasts.error"));
      }
    } catch {
      toast.error(t("toasts.error"));
    } finally {
      setBusyId(null);
    }
  }

  function statusBadge(status: string) {
    const variant =
      status === "matched"
        ? "default"
        : status === "mismatched_amount"
          ? "destructive"
          : status === "ignored"
            ? "outline"
            : "secondary";
    const label =
      status === "matched"
        ? t("status.matched")
        : status === "mismatched_amount"
          ? t("status.mismatched_amount")
          : status === "ignored"
            ? t("status.ignored")
            : t("status.unmatched");
    return <Badge variant={variant}>{label}</Badge>;
  }

  function rowActions(tx: BankTransaction) {
    const isCredit = tx.amount > 0;
    const disabled = busyId === tx.id;
    if (!isCredit) return null;

    if (tx.matchStatus === "unmatched") {
      return (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => openAssign(tx.id)} disabled={disabled}>
            {t("actions.assign")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAction(tx.id, "ignore")}
            disabled={disabled}
          >
            {t("actions.ignore")}
          </Button>
        </div>
      );
    }

    if (tx.matchStatus === "mismatched_amount") {
      return (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            onClick={() => runAction(tx.id, "approve")}
            disabled={disabled}
          >
            {t("actions.approve")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openAssign(tx.id)}
            disabled={disabled}
          >
            {t("actions.assign")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAction(tx.id, "ignore")}
            disabled={disabled}
          >
            {t("actions.ignore")}
          </Button>
        </div>
      );
    }

    if (tx.matchStatus === "matched" || tx.matchStatus === "ignored") {
      return (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAction(tx.id, "undo")}
            disabled={disabled}
          >
            {t("actions.undo")}
          </Button>
        </div>
      );
    }

    return null;
  }

  const colSpan = mode === "global" ? 7 : 6;

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.date")}</TableHead>
              {mode === "global" && (
                <TableHead>{t("columns.connection")}</TableHead>
              )}
              <TableHead>{t("columns.counterparty")}</TableHead>
              <TableHead>{t("columns.communication")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
            {transactions.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell className="text-sm whitespace-nowrap">
                  {fmtDate(tx.bookingDate)}
                </TableCell>
                {mode === "global" && (
                  <TableCell className="text-sm">
                    <p className="font-medium">
                      {tx.connection?.institutionName || "---"}
                    </p>
                    {tx.connection?.iban && (
                      <p className="text-xs font-mono text-muted-foreground">
                        {maskIban(tx.connection.iban)}
                      </p>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-sm">
                  <p className="font-medium">
                    {tx.counterpartyName || t("noCounterparty")}
                  </p>
                  {tx.counterpartyIban && (
                    <p className="text-xs font-mono text-muted-foreground">
                      {tx.counterpartyIban}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm max-w-[220px]">
                  {tx.structuredCommunication && (
                    <p className="font-mono text-xs">
                      {tx.structuredCommunication}
                    </p>
                  )}
                  {tx.unstructuredCommunication && (
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.unstructuredCommunication}
                    </p>
                  )}
                  {!tx.structuredCommunication &&
                    !tx.unstructuredCommunication && (
                      <span className="text-muted-foreground">---</span>
                    )}
                </TableCell>
                <TableCell
                  className={`text-right text-sm font-medium whitespace-nowrap ${
                    tx.amount > 0 ? "text-green-600" : "text-muted-foreground"
                  }`}
                >
                  {fmtAmount(tx.amount, tx.currency)}
                </TableCell>
                <TableCell>
                  {statusBadge(tx.matchStatus)}
                  {tx.linkedPayment && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("matchedTo", { label: tx.linkedPayment.leaseLabel })}
                    </p>
                  )}
                </TableCell>
                <TableCell>{rowActions(tx)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("assignDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("assignDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("assignDialog.leaseLabel")}
            </label>
            {leaseOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("assignDialog.noLeases")}
              </p>
            ) : (
              <Select value={selectedLeaseId} onValueChange={setSelectedLeaseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("assignDialog.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {leaseOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              {t("assignDialog.cancel")}
            </Button>
            <Button
              onClick={submitAssign}
              disabled={!selectedLeaseId || busyId === assignStatementId}
            >
              {t("assignDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
