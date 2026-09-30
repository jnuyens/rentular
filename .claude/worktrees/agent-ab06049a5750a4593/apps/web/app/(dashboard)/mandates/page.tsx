"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { FileSignature, Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MandateStatusBadge } from "@/components/MandateStatusBadge";
import { MandateSetupModal } from "@/components/MandateSetupModal";
import { CancelMandateDialog } from "@/components/CancelMandateDialog";

interface MandateRow {
  mandateId: string;
  leaseId: string;
  tenantId: string | null;
  tenantName: string;
  tenantEmail: string;
  propertyId: string;
  propertyAddress: string;
  leaseRef: string;
  status: string;
  createdAt: string;
  nextChargeDate: string;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "---";
  try {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

export default function MandatesPage() {
  const t = useTranslations("mandates");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [mandates, setMandates] = useState<MandateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<MandateRow | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const fetchMandates = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(
        `${apiUrl}/api/v1/gocardless/mandates?${params.toString()}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setMandates(data.data || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchMandates();
  }, [fetchMandates]);

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setShowSetupModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("newMandate")}
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-2 mb-4 items-start md:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder={t("filterByStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("status.all")}</SelectItem>
            <SelectItem value="active">{t("status.active")}</SelectItem>
            <SelectItem value="pending">{t("status.pending")}</SelectItem>
            <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
            <SelectItem value="failed">{t("status.failed")}</SelectItem>
            <SelectItem value="expired">{t("status.expired")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive text-center">
              {t("loadError")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && mandates.length === 0 && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center text-center">
            <FileSignature className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              {t("emptyDescription")}
            </p>
            <Button onClick={() => setShowSetupModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("newMandate")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Data Table / Cards */}
      {!loading && !error && mandates.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenant")}</TableHead>
                  <TableHead>{t("property")}</TableHead>
                  <TableHead>{t("lease")}</TableHead>
                  <TableHead className="w-[100px]">{t("statusLabel")}</TableHead>
                  <TableHead className="w-[100px]">{t("created")}</TableHead>
                  <TableHead className="w-[100px]">{t("nextCharge")}</TableHead>
                  <TableHead className="w-[80px]">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mandates.map((m) => (
                  <TableRow key={m.mandateId}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{m.tenantName}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.tenantEmail}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {m.propertyAddress}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.leaseRef}
                    </TableCell>
                    <TableCell>
                      <MandateStatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtDate(m.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtDate(m.nextChargeDate)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>{t("viewDetails")}</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setCancelTarget(m)}
                          >
                            {t("cancelMandate")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden">
            {mandates.map((m) => (
              <Card key={m.mandateId} className="mb-3">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">
                      {m.tenantName}
                    </span>
                    <MandateStatusBadge status={m.status} />
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {m.propertyAddress}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t("created")}: {fmtDate(m.createdAt)}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>{t("viewDetails")}</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setCancelTarget(m)}
                        >
                          {t("cancelMandate")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Setup Modal */}
      <MandateSetupModal
        open={showSetupModal}
        onOpenChange={setShowSetupModal}
        onSuccess={() => {
          fetchMandates();
          setShowSetupModal(false);
        }}
      />

      {/* Cancel Dialog */}
      <CancelMandateDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        mandateId={cancelTarget?.mandateId || ""}
        tenantName={cancelTarget?.tenantName || ""}
        onSuccess={() => {
          fetchMandates();
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
